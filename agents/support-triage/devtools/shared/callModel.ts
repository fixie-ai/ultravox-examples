import { DecisionLog, isInstruction } from '../../engine/decision/check';
import type { DecisionRequest } from '../../engine/decision/types';
import type { TransitionStep } from '../../engine/stateMachine';
import type { AgentCallState } from '../../toolServer/callState';
import { OBSERVER_TOOL } from '../../engine/ultravoxTools';

// ----------------------------------------------------------------------------- //
// Call model: everything the developer tools know about a call, built only     //
// from the data messages Ultravox streams to the data connection. Pure, so the //
// web debugger and the text-call script share it.                              //
// ----------------------------------------------------------------------------- //

/** A data message as relayed by the devtools server, stamped when it arrived. */
export interface Envelope {
  at: number;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  message: any;
}

interface Base {
  id: string;
  at: number;
}

export type TimelineEvent =
  | (Base & { kind: 'turn'; speaker: 'caller' | 'agent'; text: string; final: boolean; ordinal: number })
  | (Base & { kind: 'instruction'; text: string; ordinal: number })
  | (Base & { kind: 'tool'; invocationId: string; threadId: string; name: string; params: Record<string, unknown>; result: string; ms?: number; error?: string })
  | (Base & { kind: 'transition'; by: string; steps: TransitionStep[] })
  | (Base & { kind: 'decision'; log: DecisionLog })
  | (Base & { kind: 'response'; seconds: number; delays: { phase: string; type: string; seconds: number }[]; result: string })
  | (Base & { kind: 'thread'; type: string; threadId: string; reason?: string });

/** How the devtools set up the call. */
interface CallSetup {
  model: string;
  observer: string;
  details: string;
}

export interface CallModel {
  callId?: string;
  setup?: CallSetup;
  /** Agent status from "state" messages: listening, thinking, speaking. */
  status?: string;
  /** The agent's call state after the latest tool call. */
  agentState?: AgentCallState;
  events: TimelineEvent[];
  /** Transcript lines by ordinal (deltas accumulate until final). */
  lines: Map<number, TimelineEvent & { kind: 'turn' | 'instruction' }>;
  /** Tool latency from tool.execution call events, by invocation id. */
  toolLatency: Map<string, number>;
  /** Side-thread LLM generations (e.g. the extraction thread), which cost tokens beyond the call's minutes. */
  sideGenerations?: number;
  /** Counter for event ids (React keys); unlike events.length, it never repeats when a line is dropped. */
  seq: number;
}

export function emptyCallModel(): CallModel {
  return { events: [], lines: new Map(), toolLatency: new Map(), seq: 0 };
}

/** A new id for an event that has no natural one. */
const nextId = (model: CallModel, prefix: string) => `${prefix}${model.seq++}`;

/** How an observer variant ran, for labels. */
export const observerVariantLabel = (variant: string | undefined) => (variant === 'thread' ? 'Ultravox thread' : 'data connection');

/** Who moved the call, for each tool. */
function transitionAuthor(toolName: string, decision?: { source: string; observer?: { variant: string } }): string {
  if (decision?.source === 'extract') return 'extraction thread';
  if (decision?.source === 'observer') return `observer (${observerVariantLabel(decision.observer?.variant)})`;
  if (toolName === 'updateState') return 'agent (updateState)';
  return `${toolName} result (auto-advance)`;
}

function applyCallState(model: CallModel, at: number, invocationId: string, callState: unknown) {
  if (!callState) return;
  const state = callState as AgentCallState;
  if (state.v !== 1 || !state.machine) return;
  model.agentState = state;
  const last = state.lastTool;
  if (!last) return;
  // The data-connection observer's decisions are already in the stream (observer_decision); when one acted, just
  // add how long it took to take effect, and whether it did (rejected when the action's condition failed). The
  // published log and the marker's decision share `at`.
  const decision = last.decision;
  const reported =
    decision?.source === 'observer' && decision.observer?.variant === 'dataconnection'
      ? model.events.find((event) => event.kind === 'decision' && event.log.source === 'observer' && event.log.at === decision.at)
      : undefined;
  if (decision && reported?.kind === 'decision') {
    reported.log = { ...reported.log, observer: decision.observer, verdict: decision.verdict, note: decision.note };
  } else if (last.decision) {
    model.events.push({
      id: `${invocationId}:decision`,
      at,
      kind: 'decision',
      log: { ...last.decision, request: last.request as DecisionRequest | undefined },
    });
  }
  if (last.steps.length) {
    model.events.push({ id: `${invocationId}:transition`, at, kind: 'transition', by: transitionAuthor(last.name, last.decision), steps: last.steps });
  }
}

/** Replaces the observer's signed marker in tool arguments with a short label. */
function hideMarker(params: Record<string, unknown>): Record<string, unknown> {
  const replace = (value: unknown) =>
    value && typeof value === 'object' && '_observer' in value ? { ...(value as object), _observer: '(signed observer marker)' } : value;
  return Object.fromEntries(Object.entries(params).map(([key, value]) => [key, replace(value)]));
}

/** The decision in a thread observer's no-change result ({ noChange: true, decision }); its other results are text. */
function observerNoChange(result: unknown): DecisionLog | undefined {
  try {
    const parsed = JSON.parse(String(result));
    return parsed?.noChange === true && parsed.decision ? parsed.decision : undefined;
  } catch {
    return undefined;
  }
}

/** Applies one data message to the model (mutates and returns it). */
export function applyEnvelope(model: CallModel, { at, message }: Envelope): CallModel {
  switch (message?.type) {
    case 'call_started':
      model.callId = message.callId;
      break;
    case 'devtools_call':
      model.setup = { model: message.model, observer: message.observer, details: message.details ?? 'agent' };
      break;
    case 'observer_decision':
      model.events.push({ id: nextId(model, 'o'), at, kind: 'decision', log: message.log });
      break;
    case 'state':
      model.status = message.state;
      break;
    case 'transcript': {
      const existing = model.lines.get(message.ordinal);
      const text: string = message.text ?? `${existing?.text ?? ''}${message.delta ?? ''}`;
      if (!text.trim() && message.final) {
        // An agent reply that was only a tool call.
        if (existing) model.events = model.events.filter((event) => event !== existing);
        model.lines.delete(message.ordinal);
        break;
      }
      const line: TimelineEvent & { kind: 'turn' | 'instruction' } =
        message.role === 'user' && isInstruction(text)
          ? { id: `t${message.ordinal}`, at: existing?.at ?? at, kind: 'instruction', text, ordinal: message.ordinal }
          : {
              id: `t${message.ordinal}`,
              at: existing?.at ?? at,
              kind: 'turn',
              speaker: message.role === 'user' ? 'caller' : 'agent',
              text,
              final: !!message.final,
              ordinal: message.ordinal,
            };
      if (existing) model.events[model.events.indexOf(existing)] = line;
      else model.events.push(line);
      model.lines.set(message.ordinal, line);
      break;
    }
    case 'tool_used': {
      model.events.push({
        id: `${message.invocationId}:tool`,
        at,
        kind: 'tool',
        invocationId: message.invocationId,
        // "UI" for the main conversation; otherwise the side thread (observer, extractor) that ran the tool.
        threadId: message.threadId ?? 'UI',
        name: message.toolName,
        params: hideMarker(message.parameters ?? {}),
        result: message.result ?? '',
        ms: model.toolLatency.get(message.invocationId),
        error: message.errorMessage ?? undefined,
      });
      // callState is the complete new state when the tool changed it, or null when it didn't.
      applyCallState(model, at, message.invocationId, message.callState);
      // The thread observer's checks that changed nothing are only in its tool result.
      const noChange = message.toolName === OBSERVER_TOOL && (message.threadId ?? 'UI') !== 'UI' ? observerNoChange(message.result) : undefined;
      if (noChange) model.events.push({ id: `${message.invocationId}:decision`, at, kind: 'decision', log: noChange });
      break;
    }
    case 'call_event': {
      const event = message.event ?? {};
      if (event.type === 'tool.execution' && event.extras?.invocation_id) {
        const ms = Math.round(Number(event.extras.effective_latency ?? event.extras.execution_latency) * 1000);
        model.toolLatency.set(event.extras.invocation_id, ms);
        const tool = model.events.find((e) => e.kind === 'tool' && e.invocationId === event.extras.invocation_id);
        if (tool && tool.kind === 'tool') tool.ms = ms;
      } else if (event.type === 'agent_response_timeline' && event.extras) {
        const delays = (event.extras.delays ?? []).map((delay: { phase: string; type: string; duration_s: number }) => ({
          phase: delay.phase,
          type: delay.type,
          seconds: delay.duration_s,
        }));
        model.events.push({
          id: nextId(model, 'r'),
          at,
          kind: 'response',
          seconds: Number(event.extras.total_duration_s ?? 0),
          delays,
          result: String(event.extras.result ?? ''),
        });
      }
      break;
    }
    case 'extraction_started':
      model.events.push({ id: nextId(model, 'x'), at, kind: 'thread', type: 'extraction_started', threadId: 'extractor', reason: `looking for ${message.fields.join(', ')}` });
      break;
    case 'side_generation_completed':
      // A side thread's LLM generation (billed by tokens); the extraction thread makes these.
      model.sideGenerations = (model.sideGenerations ?? 0) + 1;
      model.events.push({ id: nextId(model, 'g'), at, kind: 'thread', type: 'side_generation', threadId: message.threadId, reason: message.toolCalls?.length ? `called ${message.toolCalls.map((call: { name?: string; toolName?: string }) => call.name ?? call.toolName).join(', ')}` : undefined });
      break;
    case 'thread_spawned':
    case 'thread_rejected':
    case 'thread_terminated':
      model.events.push({ id: nextId(model, 'th'), at, kind: 'thread', type: message.type, threadId: message.threadId, reason: message.reason });
      break;
  }
  return model;
}

/** Decisions in the order they happened. */
export function decisionsOf(model: CallModel): DecisionLog[] {
  return model.events.flatMap((event) => (event.kind === 'decision' ? [event.log] : []));
}

/** One visit to a state, and how the call left it. */
export interface Visit {
  state: string;
  /** 1-based position in the call's path. */
  order: number;
  /** True when an autoAdvance skipped through this state. */
  skipped: boolean;
}

export interface PathSummary {
  visits: Visit[];
  /** "from->to" keys of transitions taken, for highlighting edges. */
  takenEdges: Set<string>;
  /** Action names taken, for highlighting global actions. */
  takenActions: Set<string>;
}

/** The path a call took through the states, from its transition events. */
export function summarizePath(initialState: string, events: TimelineEvent[]): PathSummary {
  const visits: Visit[] = [{ state: initialState, order: 1, skipped: false }];
  const takenEdges = new Set<string>();
  const takenActions = new Set<string>();
  for (const event of events) {
    if (event.kind !== 'transition') continue;
    for (const step of event.steps) {
      if (step.automatic) visits[visits.length - 1].skipped = true;
      takenEdges.add(`${step.from}->${step.to}`);
      takenActions.add(step.action);
      visits.push({ state: step.to, order: visits.length + 1, skipped: false });
    }
  }
  return { visits, takenEdges, takenActions };
}

/** Durations, for the comparison runner: tool latency and agent response time. */
export function timingsOf(model: CallModel) {
  // Main-conversation tools only: side-thread tools (the observer's observeTurn, recordDetails) don't delay the agent.
  const tools = model.events.flatMap((event) => (event.kind === 'tool' && event.threadId === 'UI' && event.ms !== undefined ? [event] : []));
  const responses = model.events.flatMap((event) => (event.kind === 'response' ? [event.seconds] : []));
  const average = (values: number[]) => (values.length ? values.reduce((sum, v) => sum + v, 0) / values.length : 0);
  return {
    toolCalls: tools.length,
    averageToolMs: average(tools.map((tool) => tool.ms!)),
    averageResponseSeconds: average(responses),
    responses: responses.length,
  };
}
