import { DecisionLog } from '../engine/decision/check';
import { DecisionRequest } from '../engine/decision/types';
import { TransitionStep } from '../engine/stateMachine';
import { initializeStateMachine } from '../engine/stateMachine';
import { AnyScenario, CallState } from '../engine/types';
import { DetailsMode, isDetailsMode } from '../engine/decision/extraction';

// ----------------------------------------------------------------------------- //
// What the agent keeps in Ultravox's call state                                 //
// ----------------------------------------------------------------------------- //
// HTTP tools are stateless: every tool request carries the call state           //
// (KNOWN_PARAM_CALL_STATE) and every response returns the complete new state     //
// (X-Ultravox-Update-Call-State replaces it; it doesn't merge). So the state    //
// machine, plus a short record of each decision, lives on the Ultravox call.   //
// That record is the agent's audit trail of why the call moved, and it's also   //
// what the developer tools read to show Jev's results.                         //
// ----------------------------------------------------------------------------- //

/** A decision, without the request text (that's kept only for the latest one). */
export type DecisionRecord = Omit<DecisionLog, 'request'>;

export interface CallSettings {
  /** How the caller's free-text answers are captured (see decision/extraction.ts). */
  details: DetailsMode;
}

export interface AgentCallState {
  v: 1;
  /** Per-call settings, read from the call's metadata on the first tool call. */
  settings: CallSettings;
  machine: CallState;
  /** The last few decisions, newest last. */
  decisions: DecisionRecord[];
  /** Running totals, for cost. */
  jev: { checks: number; inputTokens: number };
  /** Observer markers already applied (signature prefixes), so a copied forced call can't apply one twice. */
  appliedMarkers?: string[];
  /** What the most recent tool call did. */
  lastTool?: {
    name: string;
    steps: TransitionStep[];
    decision?: DecisionRecord;
    /** Exactly what was sent to the decision model for that decision. */
    request?: DecisionRequest;
  };
}

export const MAX_DECISIONS = 20;
const MAX_APPLIED_MARKERS = 10;
// Ultravox has accepted 30 KB call states in testing; stay well under that by trimming the audit trail first.
const MAX_STATE_HEADER_BYTES = 16_000;

export function initialAgentState(scenario: AnyScenario, settings: Partial<CallSettings> = {}): AgentCallState {
  return {
    v: 1,
    settings: { details: settings.details ?? 'agent' },
    machine: initializeStateMachine(scenario),
    decisions: [],
    jev: { checks: 0, inputTokens: 0 },
  };
}

/** Reads the state a tool request carries. A call without one (its first tool call) starts fresh. */
export function readAgentState(scenario: AnyScenario, raw: unknown, metadata?: unknown): AgentCallState {
  const state = raw as Partial<AgentCallState> | undefined;
  if (state?.v === 1 && state.machine?.currentState && scenario.states[state.machine.currentState]) {
    return { ...initialAgentState(scenario), ...state } as AgentCallState;
  }
  // Per-call settings come from the call's metadata (set when the call is created).
  const details = (metadata as Record<string, unknown> | undefined)?.details;
  return initialAgentState(scenario, { details: isDetailsMode(details) ? details : undefined });
}

/** The new state after a tool call. `marker` is the signature of the observer marker it applied, if any. */
export function nextAgentState(
  previous: AgentCallState,
  update: { machine: CallState; toolName: string; steps: TransitionStep[]; decision?: DecisionLog; marker?: string }
): AgentCallState {
  const { request, ...decision } = update.decision ?? ({} as DecisionLog);
  const record = update.decision ? (decision as DecisionRecord) : undefined;
  return {
    ...previous,
    machine: update.machine,
    decisions: record ? [...previous.decisions, record].slice(-MAX_DECISIONS) : previous.decisions,
    jev:
      record && typeof record.inputTokens === 'number'
        ? { checks: previous.jev.checks + 1, inputTokens: previous.jev.inputTokens + record.inputTokens }
        : previous.jev,
    lastTool: { name: update.toolName, steps: update.steps, decision: record, request },
    appliedMarkers: update.marker ? [...(previous.appliedMarkers ?? []), markerId(update.marker)].slice(-MAX_APPLIED_MARKERS) : previous.appliedMarkers,
  };
}

/** A short id for a marker signature (its prefix is plenty to tell markers apart). */
export const markerId = (signature: string) => signature.slice(0, 16);

const encode = (state: AgentCallState) =>
  JSON.stringify(state).replace(/[\u007f-\uffff]/g, (char) => `\\u${char.charCodeAt(0).toString(16).padStart(4, '0')}`);

/**
 * The call state as a header value. Headers must be ASCII, so non-ASCII
 * characters (e.g. curly quotes in what the caller said) are \u-escaped.
 */
export function encodeStateHeader(state: AgentCallState): string {
  let trimmed = state;
  let header = encode(trimmed);
  // Too big for a header: drop what only the debugger reads (the last request, then the oldest decisions).
  while (header.length > MAX_STATE_HEADER_BYTES && (trimmed.lastTool?.request || trimmed.decisions.length > 0)) {
    trimmed = trimmed.lastTool?.request
      ? { ...trimmed, lastTool: { ...trimmed.lastTool, request: undefined } }
      : { ...trimmed, decisions: trimmed.decisions.slice(1) };
    header = encode(trimmed);
  }
  return header;
}
