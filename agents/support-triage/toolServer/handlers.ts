import { DecideFn, DecisionConfig, DecisionLog, handleCheckedUpdateState, TranscriptLine } from '../engine/decision/check';
import { missingFieldsFor } from '../engine/decision/extraction';
import { MAIN_TOOL, renderStateInstruction } from '../engine/prompt';
import { settle, TransitionResult } from '../engine/stateMachine';
import { runScenarioTool } from '../engine/tools';
import { OBSERVER_TOOL, RECORD_DETAILS_TOOL } from '../engine/ultravoxTools';
import { describeSteps, handleUpdateState, mergeOverrides } from '../engine/updateState';
import { MARKER_KEY, ObserverMarker, verifyMarker } from '../engine/observer/marker';
import { ForcedCall, forcedToolCallMessage, markedMainToolCall, observeTurn } from '../engine/observer/observe';
import { AnyScenario } from '../engine/types';
import { AgentCallState, markerId, nextAgentState, readAgentState } from './callState';

// The logic behind each HTTP tool, independent of the web framework.

/** A tool request body: the automatic parameters plus the model's arguments. */
export interface ToolRequestBody {
  callState?: unknown;
  conversation?: unknown;
  callId?: string;
  [param: string]: unknown;
}

export interface ToolResponse {
  /** Text the agent sees (or, for send-to-thread, the JSON Ultravox expects). */
  result: string;
  /** The complete new call state. Undefined leaves the call state as it was. */
  state?: AgentCallState;
  /** Extra response headers, e.g. X-Ultravox-Agent-Reaction. */
  headers?: Record<string, string>;
}

export interface ToolDeps {
  decide: DecideFn;
  config: DecisionConfig;
  /** Shared with the observer, to verify its forced tool calls. */
  observerSecret?: string;
  /** How the agent reacts after a call the observer forced (default speaks-once; see below). */
  observerReaction?: 'speaks' | 'listens' | 'speaks-once';
}

/** Ultravox's conversation history, as the transcript lines the decision model reads. */
export function toTranscript(conversation: unknown): TranscriptLine[] {
  if (!Array.isArray(conversation)) return [];
  return conversation.flatMap((message: { role?: string; text?: string }) => {
    if (message?.role === 'MESSAGE_ROLE_USER') return [{ speaker: 'user', text: message.text ?? '' }];
    if (message?.role === 'MESSAGE_ROLE_AGENT') return [{ speaker: 'agent', text: message.text ?? '' }];
    return [];
  });
}

export const LISTENS = { 'X-Ultravox-Agent-Reaction': 'listens' };

/**
 * The reaction for a main tool call the observer forced. "speaks-once" speaks only if the agent didn't speak
 * right before the call: if it already answered the caller's turn, the new instruction lands silently (no
 * double talk); if the forced call landed in the middle of the agent's own tool calls (e.g. right after a
 * tool result the agent is about to read out), the agent still speaks. "listens" would swallow
 * that pending reply, because Ultravox uses the reaction of the last tool result.
 */
const forcedReaction = (deps: ToolDeps) => ({ 'X-Ultravox-Agent-Reaction': deps.observerReaction ?? 'speaks-once' });

/** What every handler gets: the call's state before this tool call, plus the request. */
interface ToolCall {
  toolName: string;
  previous: AgentCallState;
  params: Record<string, unknown>;
  transcripts: TranscriptLine[];
  callId?: string;
  /** The Ultravox thread that called the tool ("UI" is the main conversation). */
  threadId?: unknown;
  turnAt?: number;
}

const isMainConversation = (threadId: unknown) => !threadId || threadId === 'UI';

/** Has the main conversation run `call` (a send-to-thread result, from a side thread's tool). */
function sendToMainConversation(call: ForcedCall, summary: string): ToolResponse {
  return {
    result: JSON.stringify({ callingThreadResultText: summary, dataMessage: { ...forcedToolCallMessage(call), threadId: 'UI' } }),
    headers: { 'X-Ultravox-Response-Type': 'send-to-thread', ...LISTENS },
  };
}

export async function handleToolRequest(
  scenario: AnyScenario,
  toolName: string,
  body: ToolRequestBody,
  deps: ToolDeps
): Promise<ToolResponse> {
  // callState, conversation, callId, callMetadata and threadId are automatic parameters.
  const { callState: rawState, conversation, callId, callMetadata, threadId, ...params } = body;
  const call: ToolCall = {
    toolName,
    previous: readAgentState(scenario, rawState, callMetadata),
    params,
    transcripts: toTranscript(conversation),
    callId,
    threadId,
    turnAt: typeof params.turnAt === 'number' ? params.turnAt : undefined,
  };

  if (toolName === RECORD_DETAILS_TOOL) return recordDetails(scenario, call, deps);
  if (toolName === OBSERVER_TOOL) return observerTurn(scenario, call, deps);

  const isMainTool = toolName === MAIN_TOOL;
  const marker = isMainTool ? (params.additionalData as Record<string, unknown> | undefined)?.[MARKER_KEY] : undefined;
  if (marker !== undefined) return applyMarker(scenario, call, marker, deps);

  const { previous, transcripts } = call;
  const detailsMode = previous.settings.details;
  // The agent picked an action; the decision model checks it.
  if (isMainTool) {
    const outcome = await handleCheckedUpdateState(scenario, params, previous.machine, { transcripts, ...deps, detailsMode });
    return {
      result: outcome.result,
      state: nextAgentState(previous, { machine: outcome.callState, toolName, steps: outcome.steps, decision: outcome.log }),
    };
  }

  // A scenario tool (lookupAccount, ...). Its data may move the call on (e.g. the account was found).
  const outcome = await runScenarioTool(scenario, toolName, params, previous.machine);
  return { result: outcome.result, state: nextAgentState(previous, { machine: outcome.callState, toolName, steps: outcome.steps }) };
}

/** The extraction thread ("extract" details mode): pass the fields it found to the main conversation. */
function recordDetails(scenario: AnyScenario, { previous, params, callId, threadId }: ToolCall, deps: ToolDeps): ToolResponse {
  const { feedback } = scenario.prompts;
  if (isMainConversation(threadId)) return { result: feedback.internalTool };
  if (!deps.observerSecret || !scenario.extraction || !callId) return { result: feedback.notConfigured({ what: 'Extraction' }), headers: LISTENS };
  const missing = missingFieldsFor(scenario, previous.machine);
  const given = (params.details && typeof params.details === 'object' ? params.details : {}) as Record<string, unknown>;
  const found = Object.fromEntries(
    Object.entries(given).filter(([field, value]) => Object.hasOwn(missing, field) && typeof value === 'string' && value.trim())
  );
  const fields = Object.keys(found);
  if (fields.length === 0) return { result: feedback.nothingNew, headers: LISTENS };
  const state = previous.machine.currentState;
  const marker: ObserverMarker = {
    variant: 'extract',
    callId,
    issuedAt: Date.now(),
    fromState: state,
    // Only the new fields: merged into the details the main conversation has by then.
    overrides: { [scenario.extraction.factKey]: found },
    decision: {
      source: 'extract',
      at: new Date().toISOString(),
      state,
      proposed: '-',
      verdict: 'applied',
      latencyMs: 0,
      note: `Extracted ${fields.join(', ')}.`,
    },
  };
  return sendToMainConversation(markedMainToolCall(scenario, marker, deps.observerSecret), feedback.sentToMainConversation({ what: fields.join(', ') }));
}

/** The observer's thread (thread variant): decide, and if needed, have the main conversation run the main tool. */
async function observerTurn(scenario: AnyScenario, { previous, transcripts, callId, threadId, turnAt }: ToolCall, deps: ToolDeps): Promise<ToolResponse> {
  const { feedback } = scenario.prompts;
  if (isMainConversation(threadId)) return { result: feedback.internalTool };
  if (!deps.observerSecret || !callId) return { result: feedback.notConfigured({ what: 'Observer' }), headers: LISTENS };
  const observation = await observeTurn(scenario, previous.machine, transcripts, {
    detailsMode: previous.settings.details,
    variant: 'thread',
    decide: deps.decide,
    config: deps.config,
    secret: deps.observerSecret,
    callId,
    turnAt,
  });
  if (!observation.forcedCall) {
    // The decision, for whoever watches the call (the data connection's tool_used); the thread never generates.
    return { result: JSON.stringify({ noChange: true, decision: { ...observation.log, request: undefined } }), headers: LISTENS };
  }
  return sendToMainConversation(observation.forcedCall, feedback.sentToMainConversation({ what: observation.forcedCall.name }));
}

/** A main tool call forced by the observer or the extraction thread: apply the marker's decision. */
function applyMarker(scenario: AnyScenario, { toolName, previous, callId }: ToolCall, value: unknown, deps: ToolDeps): ToolResponse {
  const { feedback } = scenario.prompts;
  const headers = forcedReaction(deps);
  const marker = verifyMarker(value, deps.observerSecret, callId);
  if (!marker) return { result: feedback.invalidMarker, headers };
  // Applied before (the agent copied an earlier forced call), or the call already moved on: nothing to do.
  const signature = (value as { signature: string }).signature;
  if (previous.appliedMarkers?.includes(markerId(signature)) || marker.fromState !== previous.machine.currentState) {
    return { result: feedback.alreadyHandled, headers };
  }

  // The marker was made from an older copy of the call. Captured answers only fill fields still empty here, so they
  // don't overwrite something the agent recorded since.
  const factKey = scenario.extraction?.factKey;
  const overrides =
    factKey && marker.overrides?.[factKey]
      ? { ...marker.overrides, [factKey]: onlyMissing(marker.overrides[factKey], missingFieldsFor(scenario, previous.machine)) }
      : marker.overrides;
  const recorded = marker.variant === 'extract' ? feedback.answersRecorded : '';
  let decision = {
    ...(marker.decision as unknown as DecisionLog),
    observer: { variant: marker.variant, delayMs: marker.turnAt ? Date.now() - marker.turnAt : undefined },
  };
  let result: string;
  let outcome: TransitionResult;

  if (marker.action) {
    const note = [recorded, feedback.observerMetGoal, marker.note].filter(Boolean).join(' ');
    const updated = handleUpdateState(scenario, { action: marker.action }, previous.machine, { overrides, note });
    outcome = updated;
    if (updated.accepted) {
      result = updated.result;
    } else {
      // Its condition failed (e.g. a detail is still missing): keep the data, and tell the agent what's missing.
      decision = { ...decision, verdict: 'rejected' };
      result = renderStateInstruction(scenario, updated.callState, {
        afterToolCall: true,
        note: [recorded, feedback.notYet({ reason: updated.reason ?? updated.result }), marker.note].filter(Boolean).join(' '),
      });
    }
  } else {
    // Just the data: record it, and skip anything it already answers.
    outcome = settle(scenario, { ...previous.machine, callData: mergeOverrides(previous.machine.callData, overrides) });
    result = renderStateInstruction(scenario, outcome.callState, {
      afterToolCall: true,
      note: [recorded, describeSteps(scenario, outcome.steps), marker.note].filter(Boolean).join(' ') || undefined,
    });
  }
  return { result, state: nextAgentState(previous, { machine: outcome.callState, toolName, steps: outcome.steps, decision, marker: signature }), headers };
}

/** The fields of `value` (an object of captured answers) that are still missing. */
function onlyMissing(value: unknown, missing: Record<string, string>): Record<string, unknown> {
  if (!value || typeof value !== 'object') return {};
  return Object.fromEntries(Object.entries(value).filter(([field]) => Object.hasOwn(missing, field)));
}
