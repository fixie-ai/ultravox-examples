import { describe, expect, it } from 'vitest';
import { initialAgentState, nextAgentState } from '../../toolServer/callState';
import { supportScenario } from '../../agent';
import { applyEnvelope, decisionsOf, emptyCallModel, Envelope, summarizePath, timingsOf } from './callModel';

describe('callModel', () => {
  const initial = initialAgentState(supportScenario);
  const after = nextAgentState(initial, {
    machine: { currentState: 'identify_account', previousState: 'greeting', callData: { stateHistory: ['greeting'], issue_summary: 'bill' } },
    toolName: 'updateState',
    steps: [{ from: 'greeting', action: 'issue_stated', to: 'identify_account', automatic: false }],
    decision: {
      source: 'updateState',
      at: '',
      state: 'greeting',
      proposed: 'issue_stated',
      verdict: 'accepted',
      winner: 'issue_stated',
      outcome: [['issue_stated', 0.95]],
      latencyMs: 280,
      inputTokens: 910,
      request: { context: 'ctx', questions: [{ id: 'outcome', prompt: 'p', options: ['a', 'b'] }] },
    },
  });

  const envelopes: Envelope[] = [
    { at: 1, message: { type: 'call_started', callId: 'c1' } },
    { at: 2, message: { type: 'transcript', role: 'agent', text: 'Hi!', final: true, ordinal: 0 } },
    { at: 3, message: { type: 'transcript', role: 'user', delta: 'My bill', final: false, ordinal: 1 } },
    { at: 4, message: { type: 'transcript', role: 'user', delta: ' is wrong.', final: true, ordinal: 1 } },
    { at: 5, message: { type: 'call_event', event: { type: 'agent_response_timeline', extras: { result: 'tool_call', total_duration_s: 0.4, delays: [{ type: 'system', phase: 'llm_first_token', duration_s: 0.2 }] } } } },
    { at: 6, message: { type: 'transcript', role: 'agent', text: '\n', final: true, ordinal: 2 } },
    { at: 7, message: { type: 'call_event', event: { type: 'tool.execution', extras: { invocation_id: 'inv1', effective_latency: 0.31 } } } },
    { at: 8, message: { type: 'tool_used', toolName: 'updateState', invocationId: 'inv1', threadId: 'UI', parameters: { action: 'issue_stated' }, result: '<instruction>…', errorMessage: null, callState: after } },
    { at: 9, message: { type: 'transcript', role: 'user', text: '<instruction>\nnote\n</instruction>', final: true, ordinal: 3 } },
    { at: 10, message: { type: 'thread_spawned', threadId: 'observer' } },
    // A side-thread tool that didn't change the call state.
    { at: 11, message: { type: 'call_event', event: { type: 'tool.execution', extras: { invocation_id: 'obs1', effective_latency: 0.6 } } } },
    { at: 12, message: { type: 'tool_used', toolName: 'observeTurn', invocationId: 'obs1', threadId: 'observer', parameters: {}, result: '', errorMessage: null, callState: null } },
  ];
  const model = envelopes.reduce(applyEnvelope, emptyCallModel());

  it('builds the timeline from data messages', () => {
    expect(model.callId).toBe('c1');
    expect(model.events.map((event) => event.kind)).toEqual(['turn', 'turn', 'response', 'tool', 'decision', 'transition', 'instruction', 'thread', 'tool']);
  });

  it('accumulates transcript deltas and drops empty tool-only replies', () => {
    const caller = model.events.find((event) => event.kind === 'turn' && event.speaker === 'caller');
    expect(caller).toMatchObject({ text: 'My bill is wrong.', final: true, at: 3 });
    expect(model.lines.has(2)).toBe(false);
  });

  it('reads the agent state, decision and transition from tool_used.callState', () => {
    expect(model.agentState?.machine.currentState).toBe('identify_account');
    expect(decisionsOf(model)).toEqual([expect.objectContaining({ verdict: 'accepted', inputTokens: 910, request: expect.objectContaining({ context: 'ctx' }) })]);
    expect(summarizePath('greeting', model.events).visits.map((visit) => visit.state)).toEqual(['greeting', 'identify_account']);
  });

  it('keeps the state when a tool (here a side-thread tool) returns no call state', () => {
    expect(model.events.filter((event) => event.kind === 'tool').map((event) => event.kind === 'tool' && event.threadId)).toEqual(['UI', 'observer']);
    expect(model.agentState?.machine.currentState).toBe('identify_account');
    expect(decisionsOf(model)).toHaveLength(1);
  });

  it('uses tool.execution latency and averages response time, over main-conversation tools', () => {
    expect(model.events.find((event) => event.kind === 'tool')).toMatchObject({ ms: 310, name: 'updateState' });
    expect(timingsOf(model)).toEqual({ toolCalls: 1, averageToolMs: 310, averageResponseSeconds: 0.4, responses: 1 });
  });
});

describe('callModel: observer and setup', () => {
  it('records how the call was set up and the data-connection observer’s decisions', () => {
    const model = [
      { at: 1, message: { type: 'devtools_call', model: 'example-model', observer: 'dataconnection', details: 'jev' } },
      { at: 2, message: { type: 'observer_decision', log: { source: 'observer', verdict: 'no_change', state: 'greeting', proposed: '-', at: '', latencyMs: 250, inputTokens: 800, observer: { variant: 'dataconnection' } } } },
    ].reduce(applyEnvelope, emptyCallModel());
    expect(model.setup).toEqual({ model: 'example-model', observer: 'dataconnection', details: 'jev' });
    expect(decisionsOf(model)).toEqual([expect.objectContaining({ source: 'observer', verdict: 'no_change', inputTokens: 800 })]);
  });

  it('adds the delay to a data-connection observer decision instead of counting it twice', () => {
    const initial = initialAgentState(supportScenario);
    const observerDecision = { source: 'observer' as const, verdict: 'applied' as const, state: 'greeting', proposed: 'issue_stated', at: '', latencyMs: 300 };
    const after = nextAgentState(initial, {
      machine: { currentState: 'identify_account', previousState: 'greeting', callData: { stateHistory: ['greeting'] } },
      toolName: 'updateState',
      steps: [{ from: 'greeting', action: 'issue_stated', to: 'identify_account', automatic: false }],
      decision: { ...observerDecision, observer: { variant: 'dataconnection', delayMs: 1800 } },
    });
    const model = [
      { at: 1, message: { type: 'observer_decision', log: { ...observerDecision, observer: { variant: 'dataconnection' } } } },
      { at: 2, message: { type: 'tool_used', toolName: 'updateState', invocationId: 'f1', parameters: { additionalData: { _observer: { payload: 'x', signature: 'y' } } }, result: '', callState: after } },
    ].reduce(applyEnvelope, emptyCallModel());
    const decisions = decisionsOf(model);
    expect(decisions).toHaveLength(1);
    expect(decisions[0].observer).toEqual({ variant: 'dataconnection', delayMs: 1800 });
    // The transition is credited to the observer, and the signed marker is hidden.
    expect(model.events.find((event) => event.kind === 'transition')).toMatchObject({ by: 'observer (data connection)' });
    expect(model.events.find((event) => event.kind === 'tool')).toMatchObject({ params: { additionalData: { _observer: '(signed observer marker)' } } });
  });

  it('adds the delay to the observer decision that acted, matched by its time', () => {
    const initial = initialAgentState(supportScenario);
    const acted = { source: 'observer' as const, verdict: 'applied' as const, state: 'greeting', proposed: 'issue_stated', at: '2026-01-01T00:00:01Z', latencyMs: 300 };
    const later = { ...acted, verdict: 'no_change' as const, at: '2026-01-01T00:00:05Z' };
    const after = nextAgentState(initial, {
      machine: { currentState: 'identify_account', previousState: 'greeting', callData: { stateHistory: ['greeting'] } },
      toolName: 'updateState',
      steps: [{ from: 'greeting', action: 'issue_stated', to: 'identify_account', automatic: false }],
      decision: { ...acted, observer: { variant: 'dataconnection', delayMs: 4200 } },
    });
    const model = [
      { at: 1, message: { type: 'observer_decision', log: { ...acted, observer: { variant: 'dataconnection' } } } },
      // A newer observer decision (no delay yet) arrives before the first one's forced call lands.
      { at: 2, message: { type: 'observer_decision', log: { ...later, observer: { variant: 'dataconnection' } } } },
      { at: 3, message: { type: 'tool_used', toolName: 'updateState', invocationId: 'f1', parameters: {}, result: '', callState: after } },
    ].reduce(applyEnvelope, emptyCallModel());
    expect(decisionsOf(model).map((log) => [log.at, log.observer?.delayMs])).toEqual([
      [acted.at, 4200],
      [later.at, undefined],
    ]);
  });

  it('shows a data-connection observer action the tool server rejected as rejected', () => {
    const initial = initialAgentState(supportScenario);
    const acted = { source: 'observer' as const, verdict: 'applied' as const, state: 'greeting', proposed: 'issue_stated', at: '2026-01-01T00:00:01Z', latencyMs: 300 };
    const after = nextAgentState(initial, {
      machine: initial.machine,
      toolName: 'updateState',
      steps: [],
      decision: { ...acted, verdict: 'rejected', note: 'Still missing: charge_date.', observer: { variant: 'dataconnection', delayMs: 900 } },
    });
    const model = [
      { at: 1, message: { type: 'observer_decision', log: { ...acted, observer: { variant: 'dataconnection' } } } },
      { at: 2, message: { type: 'tool_used', toolName: 'updateState', invocationId: 'f1', parameters: {}, result: '', callState: after } },
    ].reduce(applyEnvelope, emptyCallModel());
    expect(decisionsOf(model)).toEqual([expect.objectContaining({ verdict: 'rejected', note: 'Still missing: charge_date.', observer: { variant: 'dataconnection', delayMs: 900 } })]);
  });

  it('counts the thread observer’s no-change checks, from its tool result', () => {
    const log = { source: 'observer', verdict: 'no_change', state: 'greeting', proposed: '-', at: '', latencyMs: 240, inputTokens: 700, observer: { variant: 'thread' } };
    const model = [
      { at: 1, message: { type: 'tool_used', toolName: 'observeTurn', invocationId: 'o1', threadId: 'observer', parameters: {}, result: JSON.stringify({ noChange: true, decision: log }), callState: null } },
      // When it acts, the result is text, and the decision arrives with the forced call.
      { at: 2, message: { type: 'tool_used', toolName: 'observeTurn', invocationId: 'o2', threadId: 'observer', parameters: {}, result: 'Sent updateState to the main conversation.', callState: null } },
      // Only the observer's own thread counts.
      { at: 3, message: { type: 'tool_used', toolName: 'observeTurn', invocationId: 'o3', threadId: 'UI', parameters: {}, result: JSON.stringify({ noChange: true, decision: log }), callState: null } },
    ].reduce(applyEnvelope, emptyCallModel());
    expect(decisionsOf(model)).toEqual([log]);
    expect(model.events.map((event) => event.kind)).toEqual(['tool', 'decision', 'tool', 'tool']);
  });
});

describe('callModel: event ids', () => {
  it('never reuses an id after an empty final transcript drops a line', () => {
    const model = [
      { at: 1, message: { type: 'transcript', role: 'agent', delta: '', final: false, ordinal: 0 } },
      { at: 2, message: { type: 'thread_spawned', threadId: 'observer' } },
      { at: 3, message: { type: 'transcript', role: 'agent', text: '', final: true, ordinal: 0 } },
      { at: 4, message: { type: 'thread_spawned', threadId: 'observer' } },
    ].reduce(applyEnvelope, emptyCallModel());
    const ids = model.events.map((event) => event.id);
    expect(ids).toHaveLength(2);
    expect(new Set(ids).size).toBe(2);
  });
});
