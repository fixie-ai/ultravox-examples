import { answeredLog, ask, DecideFn, DecisionConfig, decisionEffects, DecisionLog, TranscriptLine } from '../decision/check';
import { DetailsMode } from '../decision/extraction';
import { MAIN_TOOL } from '../prompt';
import { getAvailableActions } from '../stateMachine';
import { AnyScenario, CallState } from '../types';
import { MARKER_KEY, ObserverMarker, signMarker } from './marker';
import { ObserverVariant } from './settings';

// ----------------------------------------------------------------------------- //
// Observer: reads each caller turn and acts when the agent didn't.              //
// ----------------------------------------------------------------------------- //
// The call relies on the agent calling updateState, and it sometimes doesn't.   //
// After every caller turn, the observer asks the decision model the same        //
// questions updateState's check would. If the caller met the goal (a confident, //
// valid action), it forces the updateState call on the main conversation, so    //
// the transition goes through the normal path and lands in the call state. It   //
// also passes along anything worth recording (e.g. an angry caller).            //
//                                                                               //
// Two ways to run it, to compare:                                               //
//   "thread":         an Ultravox side thread calls the observeTurn HTTP tool,  //
//                     which answers with send-to-thread (the tool server).      //
//   "dataconnection": a service on the call's data connection runs it and sends //
//                     the forced tool call itself (devtools/server in dev).     //
// ----------------------------------------------------------------------------- //

// The observer isn't on the caller's critical path, so it can wait longer than the main tool's check.
const OBSERVER_TIMEOUT_MS = 2000;

/** An updateState call for the main conversation to run. */
export interface ForcedCall {
  name: string;
  arguments: Record<string, unknown>;
}

export interface Observation {
  /** The forced main tool call to send to the main conversation, if the observer should act. */
  forcedCall?: ForcedCall;
  marker?: ObserverMarker;
  log: DecisionLog;
}

/**
 * The main tool call that carries a signed marker. The marker rides inside the tool's object parameter, so the
 * call matches the tool's schema; with a marker, the tool server applies the marker and ignores `action` (which
 * still has to be one of the tool's actions).
 */
export function markedMainToolCall(scenario: AnyScenario, marker: ObserverMarker, secret: string): ForcedCall {
  const signed = { [MARKER_KEY]: signMarker(marker, secret) };
  const action = marker.action ?? getAvailableActions(scenario, marker.fromState)[0];
  return { name: MAIN_TOOL, arguments: { action, additionalData: signed } };
}

export async function observeTurn(
  scenario: AnyScenario,
  machine: CallState,
  transcripts: TranscriptLine[],
  options: {
    variant: ObserverVariant;
    decide: DecideFn;
    config: DecisionConfig;
    secret: string;
    /** The call the forced call is for (the marker is only valid there). */
    callId: string;
    turnAt?: number;
    detailsMode?: DetailsMode;
  }
): Promise<Observation> {
  const base = { source: 'observer' as const, at: new Date().toISOString(), state: machine.currentState, proposed: '-' };
  const actions = getAvailableActions(scenario, machine.currentState);
  // Nothing to decide, or no decision model (DECISION_CHECK=off).
  if (actions.length === 0 || !options.config.enabled) return { log: { ...base, verdict: 'skipped', latencyMs: 0 } };

  const asked = await ask(scenario, machine, transcripts, options.decide, { timeoutMs: OBSERVER_TIMEOUT_MS, detailsMode: options.detailsMode });
  if (!asked.ok) return { log: { ...base, verdict: 'failed', latencyMs: asked.latencyMs, error: asked.error } };

  // opt_out is advice, not a veto (see rankWithoutOptOut): act on the best other option if it's confident.
  const [winner, pWinner] = asked.effective[0] ?? ['not_yet', 0];
  const isAction = actions.includes(winner);
  const confident = pWinner >= options.config.acceptThreshold;
  const effects = decisionEffects(scenario, machine, asked.answers, transcripts, options.config.acceptThreshold, {
    proposedAction: isAction ? winner : '',
    accepted: confident && isAction,
  });
  const optOutNote = asked.optOut !== undefined ? `opt_out ${Math.round(asked.optOut * 100)}% was treated as advice.` : '';
  const log: DecisionLog = {
    ...answeredLog(base, asked, 'no_change', winner, [effects.note, optOutNote].filter(Boolean).join(' ') || undefined),
    observer: { variant: options.variant },
    proposed: isAction ? winner : '-',
  };

  // Act on a transition; on newly captured caller answers ("jev" details mode), which may complete a state;
  // or on new information that comes with a note for the agent (e.g. the caller became angry). A mood change
  // on its own isn't worth a tool call.
  const action = confident && isAction && !effects.veto ? winner : undefined;
  const factKey = scenario.extraction?.factKey;
  const newAnswers = !!factKey && effects.callData?.[factKey] !== undefined;
  const newInfo = Object.entries(effects.callData ?? {}).some(([key, value]) => machine.callData[key] !== value);
  if (!action && !newAnswers && !(newInfo && effects.note)) return { log };

  const verdict = action ? 'applied' : 'nudged';
  const marker: ObserverMarker = {
    variant: options.variant,
    callId: options.callId,
    issuedAt: Date.now(),
    fromState: machine.currentState,
    action,
    overrides: effects.callData,
    note: effects.note,
    turnAt: options.turnAt,
    // The record in call state leaves out the request text (it's long).
    decision: { ...log, request: undefined, verdict },
  };
  return { forcedCall: markedMainToolCall(scenario, marker, options.secret), marker, log: { ...log, verdict } };
}

/** The forced_agent_message that makes the main conversation run the main tool. */
export function forcedToolCallMessage(call: ForcedCall) {
  return {
    type: 'forced_agent_message',
    // "soon": don't interrupt the agent; run the tool once it finishes speaking.
    urgency: 'soon',
    toolCalls: [{ name: call.name, arguments: call.arguments }],
  };
}
