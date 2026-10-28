import { describe, expect, it } from 'vitest';
import { DecideFn, DEFAULT_DECISION_CONFIG } from '../decision/check';
import { DecisionResult } from '../decision/types';
import { supportScenario } from '../../agent';
import { CallState } from '../types';
import { agentName } from '../ultravoxAgents';
import { encodeStateHeader, initialAgentState, AgentCallState } from '../../toolServer/callState';
import { handleToolRequest } from '../../toolServer/handlers';
import { MARKER_KEY, MARKER_TTL_MS, ObserverMarker, signMarker, verifyMarker } from './marker';
import { forcedToolCallMessage, observeTurn } from './observe';

const SECRET = 'test-secret';
const CALL_ID = 'call-1';
const fixed =
  (probabilities: Record<string, Record<string, number>>): DecideFn =>
  async () => {
    const answers: DecisionResult = {};
    for (const [id, p] of Object.entries(probabilities)) {
      answers[id] = { best: Object.entries(p).sort(([, a], [, b]) => b - a)[0][0], p };
    }
    return { provider: 'fixed', answers, inputTokens: 800 };
  };
const at = (currentState: string, callData: CallState['callData'] = {}): CallState => ({
  currentState,
  previousState: null,
  callData: { stateHistory: [], ...callData },
});
const transcripts = [{ speaker: 'user', text: "Since this morning, and no, I haven't restarted it." }];

describe('marker', () => {
  const issuedAt = 1_000_000;
  const signed = signMarker({ variant: 'thread', callId: CALL_ID, issuedAt, fromState: 'greeting', action: 'issue_stated' }, SECRET);

  it('round-trips when signed with the same secret and rejects tampering', () => {
    expect(verifyMarker(signed, SECRET, CALL_ID, issuedAt)?.action).toBe('issue_stated');
    expect(verifyMarker(signed, 'other', CALL_ID, issuedAt)).toBeUndefined();
    expect(verifyMarker({ ...signed, payload: signed.payload.replace('issue_stated', 'end_call') }, SECRET, CALL_ID, issuedAt)).toBeUndefined();
    expect(verifyMarker(signed, undefined, CALL_ID, issuedAt)).toBeUndefined();
  });

  it('is only valid in its own call, and expires', () => {
    expect(verifyMarker(signed, SECRET, 'call-2', issuedAt)).toBeUndefined();
    expect(verifyMarker(signed, SECRET, undefined, issuedAt)).toBeUndefined();
    expect(verifyMarker(signed, SECRET, CALL_ID, issuedAt + MARKER_TTL_MS)).toBeDefined();
    expect(verifyMarker(signed, SECRET, CALL_ID, issuedAt + MARKER_TTL_MS + 1)).toBeUndefined();
  });
});

describe('observeTurn', () => {
  const options = (decide: DecideFn) => ({
    variant: 'dataconnection' as const,
    decide,
    config: DEFAULT_DECISION_CONFIG,
    secret: SECRET,
    callId: CALL_ID,
    turnAt: 1000,
  });

  it('forces the main tool with a signed marker when the caller met the goal', async () => {
    const machine = at('collect_details', { category: 'technical', details: { symptom: 'down', started_at: 'morning', router_restarted: 'no' } });
    const observation = await observeTurn(supportScenario, machine, transcripts, options(fixed({ outcome: { details_collected: 0.92 } })));
    expect(observation.log).toMatchObject({ source: 'observer', verdict: 'applied', observer: { variant: 'dataconnection' } });
    expect(observation.forcedCall?.name).toBe('updateState');
    const marker = verifyMarker((observation.forcedCall!.arguments.additionalData as Record<string, unknown>)[MARKER_KEY], SECRET, CALL_ID);
    expect(marker).toMatchObject({ callId: CALL_ID, fromState: 'collect_details', action: 'details_collected', turnAt: 1000 });
  });

  it('nudges without a transition when the caller becomes angry', async () => {
    const observation = await observeTurn(
      supportScenario,
      at('identify_account'),
      transcripts,
      options(fixed({ outcome: { not_yet: 0.9 }, frustration: { angry: 0.95 } }))
    );
    expect(observation.log.verdict).toBe('nudged');
    expect(observation.marker).toMatchObject({ action: undefined, overrides: { frustration: 'angry' } });
    // A nudge still names a valid action, to match updateState's enum (the marker decides what happens).
    expect(observation.forcedCall?.arguments.action).toBe('account_verified');
  });

  it('sends newly captured caller answers ("jev" details mode) even without a transition', async () => {
    const machine = at('collect_details', { category: 'technical', details: { symptom: 'down' } });
    const observation = await observeTurn(supportScenario, machine, transcripts, {
      ...options(fixed({ outcome: { not_yet: 0.9 }, 'field:started_at': { yes: 0.95, no: 0.05 } })),
      detailsMode: 'jev',
    });
    expect(observation.forcedCall).toBeDefined();
    // Only the new field: it's merged into the details the call has when the forced call lands.
    expect(observation.marker?.overrides).toEqual({ details: { started_at: transcripts[0].text } });
  });

  it('does nothing when the caller has not met the goal', async () => {
    const observation = await observeTurn(supportScenario, at('identify_account'), transcripts, options(fixed({ outcome: { not_yet: 0.9 } })));
    expect(observation.forcedCall).toBeUndefined();
    expect(observation.log.verdict).toBe('no_change');
  });

  it('builds a non-interrupting forced tool call', () => {
    expect(forcedToolCallMessage({ name: 'updateState', arguments: { action: 'x' } })).toEqual({
      type: 'forced_agent_message',
      urgency: 'soon',
      toolCalls: [{ name: 'updateState', arguments: { action: 'x' } }],
    });
  });
});

describe('tool server with the observer', () => {
  const deps = { decide: fixed({ outcome: { not_yet: 1 } }), config: DEFAULT_DECISION_CONFIG, observerSecret: SECRET };
  const stateAt = (machine: CallState): AgentCallState => ({ ...initialAgentState(supportScenario), machine });

  async function forced(machine: CallState, marker: Omit<ObserverMarker, 'callId' | 'issuedAt'>) {
    return handleToolRequest(
      supportScenario,
      'updateState',
      {
        action: 'details_collected',
        additionalData: { [MARKER_KEY]: signMarker({ callId: CALL_ID, issuedAt: Date.now(), ...marker }, SECRET) },
        callState: JSON.parse(encodeStateHeader(stateAt(machine))),
        conversation: [],
        callId: CALL_ID,
      },
      deps
    );
  }

  it('applies the observer’s action without running its own check, and records the decision', async () => {
    const machine = at('collect_details', { category: 'technical' });
    const response = await forced(machine, {
      variant: 'thread',
      fromState: 'collect_details',
      action: 'details_collected',
      overrides: { details: { symptom: 'down', started_at: 'morning', router_restarted: 'no' } },
      turnAt: Date.now() - 1500,
      decision: { source: 'observer', verdict: 'applied', state: 'collect_details', proposed: 'details_collected', at: '', latencyMs: 300 },
    });
    expect(response.state?.machine.currentState).toBe('self_serve');
    expect(response.result).toContain('already met the goal.');
    expect(response.state?.lastTool?.decision?.observer?.variant).toBe('thread');
    expect(response.state?.lastTool?.decision?.observer?.delayMs).toBeGreaterThanOrEqual(1500);
    expect(response.headers?.['X-Ultravox-Agent-Reaction']).toBe('speaks-once');
  });

  it('keeps the data but reports a rejection when the action\'s condition fails', async () => {
    const response = await forced(at('collect_details', { category: 'technical' }), {
      variant: 'thread',
      fromState: 'collect_details',
      action: 'details_collected',
      overrides: { details: { symptom: 'down' } },
      decision: { source: 'observer', verdict: 'applied', state: 'collect_details', proposed: 'details_collected', at: '', latencyMs: 300 },
    });
    expect(response.state?.machine.currentState).toBe('collect_details');
    expect(response.state?.machine.callData.details).toEqual({ symptom: 'down' });
    expect(response.state?.lastTool?.decision?.verdict).toBe('rejected');
    expect(response.result).toContain('Not yet: Still missing: started_at, router_restarted');
    expect(response.result).not.toContain('already met the goal');
  });

  it('applies a marker only once, even in the same state (the agent may copy a forced call)', async () => {
    const machine = at('identify_account');
    const signed = signMarker(
      { variant: 'dataconnection', callId: CALL_ID, issuedAt: Date.now(), fromState: 'identify_account', overrides: { frustration: 'angry' }, note: 'Offer a person.' },
      SECRET
    );
    const send = (state: AgentCallState) =>
      handleToolRequest(
        supportScenario,
        'updateState',
        { action: 'account_verified', additionalData: { [MARKER_KEY]: signed }, callState: JSON.parse(encodeStateHeader(state)), conversation: [], callId: CALL_ID },
        deps
      );
    const first = await send(stateAt(machine));
    expect(first.state?.machine.callData.frustration).toBe('angry');
    const again = await send(first.state!);
    expect(again.result).toBe('Already handled.');
    expect(again.state).toBeUndefined();
  });

  it('only fills captured answers that are still missing when the marker lands', async () => {
    // The extraction thread saw started_at missing; by the time its forced call lands, the agent has recorded it.
    const response = await forced(at('collect_details', { category: 'technical', details: { started_at: 'Monday 9am' } }), {
      variant: 'extract',
      fromState: 'collect_details',
      overrides: { details: { started_at: 'uh, since Monday I think', symptom: 'no internet' } },
    });
    expect(response.state?.machine.callData.details).toEqual({ started_at: 'Monday 9am', symptom: 'no internet' });
  });

  it('ignores a marker for a state the call already left', async () => {
    const response = await forced(at('self_serve', { category: 'technical' }), { variant: 'thread', fromState: 'collect_details', action: 'details_collected' });
    expect(response.result).toBe('Already handled.');
    expect(response.state).toBeUndefined();
    // Must not be "listens": a stale forced call can land right before the agent's pending reply.
    expect(response.headers?.['X-Ultravox-Agent-Reaction']).toBe('speaks-once');
  });

  it('rejects a forged marker', async () => {
    const response = await handleToolRequest(
      supportScenario,
      'updateState',
      { action: 'end_call', additionalData: { [MARKER_KEY]: { payload: '{"fromState":"greeting","action":"end_call"}', signature: 'nope' } }, callId: CALL_ID },
      deps
    );
    expect(response.result).toBe('Error: invalid or expired observer marker.');
  });

  it('refuses observeTurn from the main conversation and sends to the main thread from a side thread', async () => {
    const fromUi = await handleToolRequest(supportScenario, 'observeTurn', { threadId: 'UI' }, deps);
    expect(fromUi.result).toContain('internal');

    const machine = at('collect_details', { category: 'technical', details: { symptom: 'down', started_at: 'morning', router_restarted: 'no' } });
    const fromThread = await handleToolRequest(
      supportScenario,
      'observeTurn',
      { threadId: 'observer', turnAt: 5, callId: CALL_ID, callState: JSON.parse(encodeStateHeader(stateAt(machine))), conversation: [] },
      { ...deps, decide: fixed({ outcome: { details_collected: 0.95 } }) }
    );
    expect(fromThread.headers?.['X-Ultravox-Response-Type']).toBe('send-to-thread');
    const body = JSON.parse(fromThread.result);
    expect(body.dataMessage).toMatchObject({ type: 'forced_agent_message', threadId: 'UI', toolCalls: [{ name: 'updateState' }] });
    // The thread's copy of the call state isn't changed.
    expect(fromThread.state).toBeUndefined();
  });
});

describe('agentName', () => {
  it('adds a slug for non-default models', () => {
    expect(agentName('acme')).toBe('acme');
    expect(agentName('acme', 'example-model-31b')).toBe('acme-example-model-31b');
    expect(agentName('acme', 'ultravox-v0.6-gemma3-27b')).toBe('acme-ultravox-v0-6-gemma3-27b');
  });
});
