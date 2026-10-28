import { stateGoal, wrapInstruction } from '../prompt';
import { getAction, getAvailableActions } from '../stateMachine';
import { handleUpdateState, mergeModelData, mergeOverrides, UpdateStateOutcome } from '../updateState';
import { AnyScenario, CallData, CallState, DecisionEffects } from '../types';
import { DecisionQuestion, DecisionRequest, DecisionResult } from './types';
import { DetailsMode, extractionEffects, extractionQuestions, withExtraction } from './extraction';
import type { MarkerVariant } from '../observer/settings';

// ----------------------------------------------------------------------------- //
// Decision check                                                                //
// ----------------------------------------------------------------------------- //
// Before applying an updateState action, ask a decision model whether the       //
// conversation supports it. The model returns a probability per option in one  //
// pass, so the check is fast and its confidence is explicit:                    //
//   p(proposed) >= accept, or it's the top option and >= floor                  //
//                                 -> apply it, filling fields from the answers  //
//   another option >= accept      -> reject; tell the agent what the caller     //
//                                    seems to have meant                        //
//   otherwise                     -> reject; ask one clarifying question        //
// If the decision call fails or is slow, apply the action anyway (fail open):   //
// the decision model must never stall a live call.                              //
// ----------------------------------------------------------------------------- //

export interface DecisionConfig {
  enabled: boolean;
  acceptThreshold: number;
  floor: number;
  timeoutMs: number;
}

export const DEFAULT_DECISION_CONFIG: DecisionConfig = {
  enabled: true,
  acceptThreshold: 0.8,
  floor: 0.5,
  // Jev answers within 400 ms about 96% of the time and within 600 ms about 99%; slower checks fail open.
  timeoutMs: 600,
};

export const OUTCOME_QUESTION_ID = 'outcome';

/** A line of the conversation, from Ultravox's conversation history. */
export interface TranscriptLine {
  speaker: string;
  text: string;
}

/**
 * Instructions sent as user text messages (e.g. the debugger's Wrap Up) come
 * back as user transcripts. They aren't the caller speaking.
 */
export function isInstruction(text: string): boolean {
  return text.trimStart().startsWith('<instruction>');
}

export type Verdict =
  // updateState checks
  | 'accepted'
  | 'overridden'
  | 'rejected'
  | 'fail_open'
  | 'skipped'
  // The observer (and the extraction thread)
  | 'applied'
  | 'nudged'
  | 'no_change'
  | 'failed';

export interface DecisionLog {
  /** What made the decision: updateState's check, the observer, or the extraction thread. */
  source: 'updateState' | 'observer' | 'extract';
  at: string;
  state: string;
  proposed: string;
  verdict: Verdict;
  /** The option the decision model preferred for "outcome". */
  winner?: string;
  /** Outcome probabilities, highest first (top 4). */
  outcome?: [string, number][];
  /** Best answer and its probability for each scenario question. */
  extras?: Record<string, [string, number]>;
  latencyMs: number;
  provider?: string;
  error?: string;
  note?: string;
  /** Exactly what was sent to the decision model, for the debugger. */
  request?: DecisionRequest;
  /** Billed input tokens for this check, when the provider reports them. */
  inputTokens?: number;
  /** For observer decisions: how it ran, and how long after the caller's turn it took effect. */
  observer?: { variant: MarkerVariant; delayMs?: number };
}

export type DecideFn = (
  request: DecisionRequest,
  signal: AbortSignal
) => Promise<{ provider: string; answers: DecisionResult; inputTokens?: number }>;

/** The engine's "outcome" question: which action, if any, the conversation supports. */
export function buildOutcomeQuestion(scenario: AnyScenario, callState: CallState): DecisionQuestion {
  const { actions, decisionModel } = scenario.prompts;
  const optionDescriptions: Record<string, string> = {};
  for (const action of getAvailableActions(scenario, callState.currentState)) optionDescriptions[action] = actions[action];
  Object.assign(optionDescriptions, decisionModel.outcomeOptions);
  return {
    id: OUTCOME_QUESTION_ID,
    prompt: decisionModel.outcome({ state: callState.currentState }),
    options: Object.keys(optionDescriptions),
    optionDescriptions,
    hints: { opt_out: ['stop calling', "don't call", 'not interested', 'goodbye'] },
    fallback: 'not_yet',
  };
}

/**
 * The outcome question, the scenario's questions, and ("jev" details mode) one question per field still missing
 * from `detailsFrom` (the call state with the agent's latest data, so Jev isn't asked about what the agent just sent).
 */
export function buildQuestions(
  scenario: AnyScenario,
  callState: CallState,
  detailsMode?: DetailsMode,
  detailsFrom: CallState = callState
): DecisionQuestion[] {
  return [
    buildOutcomeQuestion(scenario, callState),
    ...(scenario.decisionQuestions?.(callState.currentState, callState.callData, scenario.context) ?? []),
    ...extractionQuestions(scenario, detailsFrom, detailsMode),
  ];
}

/** Call data worth showing the decision model: what tools found, not engine bookkeeping. */
function knownFacts(callData: CallData): Record<string, unknown> {
  return Object.fromEntries(Object.entries(callData).filter(([key, value]) => key !== 'stateHistory' && value !== undefined));
}

/** The context the decision model judges: the current goal, known facts, and the last few turns. */
export function buildContext(scenario: AnyScenario, callState: CallState, transcripts: TranscriptLine[], turns = 6): string {
  const conversation = transcripts
    .filter((line) => line.text.trim() && !isInstruction(line.text))
    .slice(-turns)
    .map((line) => ({ speaker: line.speaker === 'user' ? ('caller' as const) : ('agent' as const), text: line.text.trim() }));
  return scenario.prompts.decisionModel.context({
    state: callState.currentState,
    goal: scenario.prompts.goal(stateGoal(scenario, callState)),
    facts: knownFacts(callState.callData),
    conversation,
  });
}

const sortedProbabilities = (p: Record<string, number>) =>
  Object.entries(p).sort(([, a], [, b]) => b - a);

/** What to tell the agent when the conversation points somewhere other than its proposal. */
function overrideMessage(scenario: AnyScenario, proposed: string, winner: string): string {
  const { notApplied } = scenario.prompts.feedback;
  if (winner === 'caller_question') return notApplied.callerQuestion({ proposed });
  if (winner === 'not_yet') return notApplied.notYet;
  if (winner === 'off_topic') return notApplied.offTopic;
  if (winner === 'opt_out') return notApplied.optOut;
  return notApplied.meansOther({ proposed, winner, description: scenario.prompts.actions[winner] ?? winner });
}

function withTimeout<T>(promise: (signal: AbortSignal) => Promise<T>, ms: number): Promise<T> {
  const controller = new AbortController();
  let timer: ReturnType<typeof setTimeout> | undefined;
  const timeout = new Promise<never>((_, reject) => {
    timer = setTimeout(() => {
      // Reject first so the race reports the timeout, then cancel the request.
      reject(new Error(`decision model timed out after ${ms} ms`));
      controller.abort();
    }, ms);
  });
  return Promise.race([promise(controller.signal), timeout]).finally(() => clearTimeout(timer));
}

/**
 * Asks the decision model the outcome question plus the scenario's questions
 * for the current state. Throws on error or timeout.
 */
export async function askDecisionModel(
  scenario: AnyScenario,
  callState: CallState,
  transcripts: TranscriptLine[],
  decide: DecideFn,
  options: {
    timeoutMs: number;
    outcomeFallback?: string;
    onRequest?: (request: DecisionRequest) => void;
    detailsMode?: DetailsMode;
    detailsFrom?: CallState;
  }
): Promise<{ answers: DecisionResult; provider: string; inputTokens?: number }> {
  const [outcomeQuestion, ...scenarioQuestions] = buildQuestions(scenario, callState, options.detailsMode, options.detailsFrom);
  const request: DecisionRequest = {
    context: buildContext(scenario, callState, transcripts),
    // `fallback` is only read by the offline heuristic provider.
    questions: [
      options.outcomeFallback ? { ...outcomeQuestion, fallback: options.outcomeFallback } : outcomeQuestion,
      ...scenarioQuestions,
    ],
  };
  options.onRequest?.(request);
  return withTimeout((signal) => decide(request, signal), options.timeoutMs);
}

/** The caller's most recent line (instructions excluded). */
export function lastCallerText(transcripts: TranscriptLine[]): string | undefined {
  return [...transcripts].reverse().find((line) => line.speaker === 'user' && line.text.trim() && !isInstruction(line.text))?.text.trim();
}

/** Outcome options with their probabilities, most likely first. */
export function rankOutcome(answers: DecisionResult): [string, number][] {
  const outcome = answers[OUTCOME_QUESTION_ID];
  return outcome ? sortedProbabilities(outcome.p) : [];
}

/**
 * "opt_out" is advice, not a veto. "No, that's it, thanks" right after "it still doesn't work" reads as the caller
 * wrapping up, but the agent's hand-off is still the right step. When opt_out is the top answer, rank the other
 * options without it (renormalized) and decide on those; the caller wanting to finish becomes a note.
 */
export function rankWithoutOptOut(ranked: [string, number][]): { ranked: [string, number][]; optOut?: number } {
  if (ranked[0]?.[0] !== 'opt_out') return { ranked };
  const optOut = ranked[0][1];
  const rest = ranked.slice(1);
  const total = rest.reduce((sum, [, p]) => sum + p, 0);
  return { ranked: total > 0 ? rest.map(([option, p]) => [option, p / total] as [string, number]) : rest, optOut };
}

/** The best answer and its probability for each non-outcome question, for logs. */
export function summarizeExtras(answers: DecisionResult): Record<string, [string, number]> {
  return Object.fromEntries(
    Object.entries(answers)
      .filter(([id]) => id !== OUTCOME_QUESTION_ID)
      .map(([id, answer]) => [id, [answer.best, answer.p[answer.best] ?? 0]])
  );
}

/** A decision model answer, ranked, or why there isn't one. */
export type Asked =
  | {
      ok: true;
      answers: DecisionResult;
      provider: string;
      inputTokens?: number;
      request?: DecisionRequest;
      latencyMs: number;
      /** Outcome options, most likely first. */
      ranked: [string, number][];
      /** The same with opt_out set aside when it came first (see rankWithoutOptOut). */
      effective: [string, number][];
      /** opt_out's probability, when it was set aside. */
      optOut?: number;
    }
  | { ok: false; error: string; request?: DecisionRequest; latencyMs: number };

/** Asks the decision model (see askDecisionModel) and ranks the outcome. Never throws. */
export async function ask(
  scenario: AnyScenario,
  callState: CallState,
  transcripts: TranscriptLine[],
  decide: DecideFn,
  options: Omit<Parameters<typeof askDecisionModel>[4], 'onRequest'> & { now?: () => number }
): Promise<Asked> {
  const now = options.now ?? (() => performance.now());
  const started = now();
  let request: DecisionRequest | undefined;
  try {
    const result = await askDecisionModel(scenario, callState, transcripts, decide, { ...options, onRequest: (sent) => (request = sent) });
    const ranked = rankOutcome(result.answers);
    const { ranked: effective, optOut } = rankWithoutOptOut(ranked);
    return { ok: true, ...result, request, latencyMs: Math.round(now() - started), ranked, effective, optOut };
  } catch (error) {
    return { ok: false, error: String(error), request, latencyMs: Math.round(now() - started) };
  }
}

/**
 * What the answers do to the call: the scenario's effects (applyDecision), plus the caller's answers the decision
 * model confirmed ("jev" details mode). `callState` should include the agent's latest data.
 */
export function decisionEffects(
  scenario: AnyScenario,
  callState: CallState,
  answers: DecisionResult,
  transcripts: TranscriptLine[],
  acceptThreshold: number,
  decision: { proposedAction: string; accepted: boolean }
): DecisionEffects {
  const callerText = lastCallerText(transcripts);
  const effects =
    scenario.applyDecision?.({
      state: callState.currentState,
      ...decision,
      answers,
      callData: callState.callData,
      acceptThreshold,
      lastCallerText: callerText,
    }) ?? {};
  return withExtraction(effects, extractionEffects(scenario, callState, answers, acceptThreshold, callerText));
}

/** The log entry for a decision the model answered. */
export function answeredLog(
  base: Pick<DecisionLog, 'source' | 'at' | 'state' | 'proposed'>,
  asked: Extract<Asked, { ok: true }>,
  verdict: Verdict,
  winner: string,
  note?: string
): DecisionLog {
  return {
    ...base,
    verdict,
    winner,
    outcome: asked.ranked.slice(0, 4),
    extras: summarizeExtras(asked.answers),
    latencyMs: asked.latencyMs,
    provider: asked.provider,
    note,
    request: asked.request,
    inputTokens: asked.inputTokens,
  };
}

export interface CheckedUpdateOutcome extends UpdateStateOutcome {
  log: DecisionLog;
}

/**
 * The updateState handler with the decision check in front. Asks the decision
 * model about the proposed action and applies the rules above.
 */
export async function handleCheckedUpdateState(
  scenario: AnyScenario,
  params: { action?: unknown; additionalData?: unknown },
  callState: CallState,
  deps: { transcripts: TranscriptLine[]; decide: DecideFn; config?: DecisionConfig; now?: () => number; detailsMode?: DetailsMode }
): Promise<CheckedUpdateOutcome> {
  const config = deps.config ?? DEFAULT_DECISION_CONFIG;
  const proposed = typeof params.action === 'string' ? params.action : '';
  const baseLog = { source: 'updateState' as const, at: new Date().toISOString(), state: callState.currentState, proposed };

  // Nothing to check: no decision model, an action the engine will reject anyway,
  // or an action that depends on tool results rather than on what the caller said.
  if (
    !config.enabled ||
    !getAvailableActions(scenario, callState.currentState).includes(proposed) ||
    getAction(scenario, callState.currentState, proposed)?.decisionCheck === false
  ) {
    const outcome = handleUpdateState(scenario, params, callState);
    return { ...outcome, log: { ...baseLog, verdict: 'skipped', latencyMs: 0 } };
  }

  // The agent's data, merged: the decision's effects build on it, so they don't overwrite what the agent just sent.
  const withAgentData: CallState = {
    ...callState,
    callData: mergeModelData(callState.callData, params.additionalData, scenario.modelWritableKeys),
  };
  // Offline, the heuristic provider trusts the agent's proposal unless the caller's words point elsewhere.
  const asked = await ask(scenario, callState, deps.transcripts, deps.decide, {
    timeoutMs: config.timeoutMs,
    outcomeFallback: proposed,
    detailsMode: deps.detailsMode,
    detailsFrom: withAgentData,
    now: deps.now,
  });
  if (!asked.ok) {
    // Fail open: apply the agent's action as if there were no check.
    console.warn('Decision check failed open:', asked.error);
    const outcome = handleUpdateState(scenario, params, callState);
    return { ...outcome, log: { ...baseLog, verdict: 'fail_open', latencyMs: asked.latencyMs, error: asked.error, request: asked.request } };
  }

  const pProposed = asked.effective.find(([option]) => option === proposed)?.[1] ?? 0;
  const [winner, pWinner] = asked.effective[0] ?? [proposed, 0];
  // The decision model's probabilities for an obvious answer vary (0.79 one turn, 0.97 the next),
  // so agreeing with the agent on the top option is enough once it clears the floor.
  const accepted = pProposed >= config.acceptThreshold || (winner === proposed && pProposed >= config.floor);
  const effects = decisionEffects(scenario, withAgentData, asked.answers, deps.transcripts, config.acceptThreshold, {
    proposedAction: proposed,
    accepted,
  });
  const optOutNote = asked.optOut !== undefined ? `opt_out ${Math.round(asked.optOut * 100)}% was treated as advice.` : '';
  const log = answeredLog(baseLog, asked, 'accepted', winner, [effects.note, optOutNote].filter(Boolean).join(' ') || undefined);
  const note = [effects.note, asked.optOut !== undefined ? scenario.prompts.feedback.wrapUp : ''].filter(Boolean).join(' ') || undefined;

  if (accepted && !effects.veto) {
    const outcome = handleUpdateState(scenario, params, callState, { overrides: effects.callData, note });
    return { ...outcome, log: { ...log, verdict: outcome.accepted ? 'accepted' : 'rejected' } };
  }

  // Rejected: keep the facts the caller gave, but don't move.
  let message: string;
  let verdict: Verdict = 'rejected';
  if (effects.veto) {
    message = scenario.prompts.feedback.notApplied.vetoed({ reason: effects.veto });
  } else if (winner !== proposed && pWinner >= config.acceptThreshold) {
    message = overrideMessage(scenario, proposed, winner);
    verdict = 'overridden';
  } else {
    message = scenario.prompts.feedback.notApplied.notConfirmed;
  }
  if (note) message = `${message} ${note}`;

  return {
    accepted: false,
    result: wrapInstruction(message),
    callState: { ...withAgentData, callData: mergeOverrides(withAgentData.callData, effects.callData) },
    steps: [],
    log: { ...log, verdict },
  };
}
