import { describe, expect, it } from 'vitest';
import { supportScenario } from '../../agent';
import { CallState } from '../types';
import { initialAgentState, readAgentState, encodeStateHeader, AgentCallState } from '../../toolServer/callState';
import { handleToolRequest } from '../../toolServer/handlers';
import { MARKER_KEY, verifyMarker } from '../observer/marker';
import { DecideFn, DEFAULT_DECISION_CONFIG, handleCheckedUpdateState } from './check';
import { extractionEffects, extractionPrompt, extractionQuestions, missingFieldsFor } from './extraction';
import { DecisionResult } from './types';

const SECRET = 'secret';
const at = (callData: CallState['callData']): CallState => ({
  currentState: 'collect_details',
  previousState: null,
  callData: { stateHistory: [], category: 'technical', ...callData },
});
const fixed =
  (probabilities: Record<string, Record<string, number>>): DecideFn =>
  async () => {
    const answers: DecisionResult = {};
    for (const [id, p] of Object.entries(probabilities)) answers[id] = { best: Object.entries(p).sort(([, a], [, b]) => b - a)[0][0], p };
    return { provider: 'fixed', answers };
  };

describe('details modes', () => {
  it('lists the missing fields only in states that capture answers', () => {
    expect(Object.keys(missingFieldsFor(supportScenario, at({ details: { symptom: 'down' } })))).toEqual(['started_at', 'router_restarted']);
    expect(missingFieldsFor(supportScenario, { ...at({}), currentState: 'greeting' })).toEqual({});
  });

  it('A1 asks one yes/no question per missing field, only in "jev" mode', () => {
    expect(extractionQuestions(supportScenario, at({}), 'agent')).toEqual([]);
    expect(extractionQuestions(supportScenario, at({ details: { symptom: 'down' } }), 'jev').map((q) => q.id)).toEqual([
      'field:started_at',
      'field:router_restarted',
    ]);
  });

  it('A1 fills confidently answered fields with the caller’s words, returning only the new ones', () => {
    const answers: DecisionResult = {
      'field:started_at': { best: 'yes', p: { yes: 0.93, no: 0.07 } },
      'field:router_restarted': { best: 'yes', p: { yes: 0.6, no: 0.4 } },
    };
    expect(extractionEffects(supportScenario, at({ details: { symptom: 'down' } }), answers, 0.8, 'Since this morning.')).toEqual({
      details: { started_at: 'Since this morning.' },
    });
  });

  it('A1 lets the agent’s details_collected through once Jev fills the rest', async () => {
    const outcome = await handleCheckedUpdateState(
      supportScenario,
      { action: 'details_collected', additionalData: { details: { symptom: 'keeps dropping' } } },
      at({}),
      {
        transcripts: [{ speaker: 'user', text: "Since this morning, and no, I haven't restarted it." }],
        decide: fixed({
          outcome: { details_collected: 0.9 },
          'field:started_at': { yes: 0.95, no: 0.05 },
          'field:router_restarted': { yes: 0.9, no: 0.1 },
        }),
        config: DEFAULT_DECISION_CONFIG,
        detailsMode: 'jev',
      }
    );
    expect(outcome.accepted).toBe(true);
    expect(outcome.callState.currentState).toBe('self_serve');
  });

  it('A2 tells the extraction thread which fields to look for', () => {
    expect(extractionPrompt(supportScenario, { started_at: 'when it started' })).toContain('- started_at: when it started');
  });

  it('reads the details mode from call metadata on the first tool call', () => {
    expect(readAgentState(supportScenario, undefined, { details: 'extract' }).settings.details).toBe('extract');
    expect(readAgentState(supportScenario, undefined, { details: 'nope' }).settings.details).toBe('agent');
  });
});

describe('recordDetails (A2)', () => {
  const deps = { decide: fixed({ outcome: { not_yet: 1 } }), config: DEFAULT_DECISION_CONFIG, observerSecret: SECRET };
  const stateAt = (machine: CallState): AgentCallState => ({ ...initialAgentState(supportScenario, { details: 'extract' }), machine });
  const call = (details: Record<string, unknown>, threadId = 'extractor', machine = at({ details: { symptom: 'down' } })) =>
    handleToolRequest(supportScenario, 'recordDetails', { details, threadId, callId: 'call-1', callState: JSON.parse(encodeStateHeader(stateAt(machine))), conversation: [] }, deps);

  it('refuses calls from the main conversation', async () => {
    expect((await call({ started_at: 'today' }, 'UI')).result).toContain('internal');
  });

  it('sends only missing, non-empty fields to the main conversation with a signed marker', async () => {
    const response = await call({ started_at: 'this morning', router_restarted: '', made_up: 'x', symptom: 'changed' });
    expect(response.headers?.['X-Ultravox-Response-Type']).toBe('send-to-thread');
    const message = JSON.parse(response.result).dataMessage;
    expect(message).toMatchObject({ type: 'forced_agent_message', threadId: 'UI', toolCalls: [{ name: 'updateState' }] });
    const marker = verifyMarker(message.toolCalls[0].arguments.additionalData[MARKER_KEY], SECRET, 'call-1');
    expect(marker).toMatchObject({ variant: 'extract', fromState: 'collect_details' });
    // Only the new field; it's merged into the call's details when applied.
    expect(marker?.overrides).toEqual({ details: { started_at: 'this morning' } });
  });

  it('does nothing when no missing field was found', async () => {
    expect((await call({ symptom: 'already have it' })).result).toBe('Nothing new.');
  });

  it('moves the call on once the extracted fields complete the details', async () => {
    const response = await call({ started_at: 'this morning', router_restarted: 'no' });
    const args = JSON.parse(response.result).dataMessage.toolCalls[0].arguments;
    const applied = await handleToolRequest(
      supportScenario,
      'updateState',
      { ...args, callId: 'call-1', callState: JSON.parse(encodeStateHeader(stateAt(at({ details: { symptom: 'down' } })))), conversation: [] },
      deps
    );
    expect(applied.state?.machine.currentState).toBe('self_serve');
    expect(applied.state?.lastTool?.decision).toMatchObject({ source: 'extract', verdict: 'applied' });
    expect(applied.result).toContain("answers were recorded");
  });
});
