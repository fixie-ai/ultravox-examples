import { describe, expect, it } from 'vitest';
import { DecideFn, DEFAULT_DECISION_CONFIG } from '../engine/decision/check';
import { HeuristicProvider } from '../engine/decision/providers/heuristic';
import { DecisionResult } from '../engine/decision/types';
import { supportScenario } from '../agent';
import { createToolServer } from './app';
import { AgentCallState, encodeStateHeader, initialAgentState, readAgentState } from './callState';
import { handleToolRequest, toTranscript } from './handlers';

const fixed =
  (probabilities: Record<string, Record<string, number>>, inputTokens = 900): DecideFn =>
  async () => {
    const answers: DecisionResult = {};
    for (const [id, p] of Object.entries(probabilities)) {
      answers[id] = { best: Object.entries(p).sort(([, a], [, b]) => b - a)[0][0], p };
    }
    return { provider: 'fixed', answers, inputTokens };
  };

const heuristic = new HeuristicProvider();
const offline: DecideFn = async (request) => ({ provider: 'heuristic', ...(await heuristic.decide(request)) });

const conversation = (...lines: [string, string][]) =>
  lines.map(([role, text]) => ({ role: role === 'caller' ? 'MESSAGE_ROLE_USER' : 'MESSAGE_ROLE_AGENT', text }));

/** Plays tool calls the way Ultravox would: each call carries the state the previous one returned. */
class ToolCallDriver {
  state: AgentCallState;
  result = '';
  constructor(
    private readonly decide: DecideFn,
    private readonly config = DEFAULT_DECISION_CONFIG
  ) {
    this.state = initialAgentState(supportScenario);
  }
  async call(tool: string, params: Record<string, unknown>, said: [string, string][] = []) {
    const response = await handleToolRequest(
      supportScenario,
      tool,
      { ...params, callState: JSON.parse(encodeStateHeader(this.state)), conversation: conversation(...said), callId: 'c1' },
      { decide: this.decide, config: this.config }
    );
    this.state = response.state ?? this.state;
    this.result = response.result;
    return this;
  }
  get current() {
    return this.state.machine.currentState;
  }
}

describe('call state', () => {
  it('starts fresh when a request has no (or bad) state', () => {
    expect(readAgentState(supportScenario, undefined)).toEqual(initialAgentState(supportScenario));
    expect(readAgentState(supportScenario, { v: 1, machine: { currentState: 'nope' } })).toEqual(initialAgentState(supportScenario));
  });

  it('trims the audit trail, never the state machine, when the header would get too big', () => {
    const state = initialAgentState(supportScenario);
    const decision = { source: 'updateState' as const, at: '', state: 'greeting', proposed: 'x', verdict: 'accepted' as const, latencyMs: 1, note: 'n'.repeat(1500) };
    const big: AgentCallState = {
      ...state,
      decisions: Array.from({ length: 20 }, () => decision),
      lastTool: { name: 'updateState', steps: [], request: { context: 'c'.repeat(4000), questions: [] } },
    };
    const header = encodeStateHeader(big);
    expect(header.length).toBeLessThanOrEqual(16_000);
    const parsed = JSON.parse(header) as AgentCallState;
    expect(parsed.machine).toEqual(state.machine);
    expect(parsed.lastTool?.request).toBeUndefined();
    expect(parsed.decisions.length).toBeLessThan(20);
  });

  it('encodes the header as ASCII that parses back to the same state', () => {
    const state = initialAgentState(supportScenario);
    state.machine.callData.issue_summary = 'It’s “broken” — très';
    const header = encodeStateHeader(state);
    expect(/^[\x20-\x7e]*$/.test(header)).toBe(true);
    expect(JSON.parse(header)).toEqual(state);
  });

  it('maps Ultravox conversation history to transcript lines', () => {
    expect(
      toTranscript([
        { role: 'MESSAGE_ROLE_AGENT', text: 'Hi' },
        { role: 'MESSAGE_ROLE_TOOL_CALL', text: '{}' },
        { role: 'MESSAGE_ROLE_USER', text: 'Help' },
      ])
    ).toEqual([
      { speaker: 'agent', text: 'Hi' },
      { speaker: 'user', text: 'Help' },
    ]);
  });
});

describe('updateState', () => {
  it('applies a confirmed action and records the decision and Jev tokens in the call state', async () => {
    const call = new ToolCallDriver(fixed({ outcome: { issue_stated: 0.95, not_yet: 0.05 } }));
    await call.call('updateState', { action: 'issue_stated', additionalData: { issue_summary: 'bill wrong' } }, [['caller', 'My bill is wrong.']]);
    expect(call.current).toBe('identify_account');
    expect(call.result).toContain('Current state: identify_account');
    expect(call.state.decisions).toHaveLength(1);
    expect(call.state.jev).toEqual({ checks: 1, inputTokens: 900 });
    expect(call.state.lastTool).toMatchObject({ name: 'updateState', decision: { verdict: 'accepted' } });
    expect(call.state.lastTool?.request?.questions[0].id).toBe('outcome');
    // The request text is kept for the latest decision only, not in the list.
    expect(call.state.decisions[0]).not.toHaveProperty('request');
  });
});

describe('a whole call', () => {
  it('runs a billing call offline with the heuristic provider', async () => {
    const call = new ToolCallDriver(offline);
    await call.call(
      'updateState',
      {
        action: 'issue_stated',
        additionalData: { issue_summary: 'Charged twice', category: 'billing', details: { billing_problem: 'double charge', charge_amount: '$79.99', charge_date: 'Sept 1' } },
      },
      [['caller', 'I was charged twice, 79.99 on September 1st.']]
    );
    expect(call.current).toBe('identify_account');
    // A successful lookup moves the call on by itself; the details already given skip two states.
    await call.call('lookupAccount', { accountNumber: '100234' });
    expect(call.current).toBe('self_serve');
    expect(call.result).toContain('"found":true');
    expect(call.result).toContain('Skipped "identify_account", "classify_issue", "collect_details"');
    expect(call.state.lastTool?.steps.map((step) => step.to)).toEqual(['classify_issue', 'collect_details', 'self_serve']);
  });
});

describe('scenario tools', () => {
  it('number tickets per call from the call state', async () => {
    const call = new ToolCallDriver(offline);
    await call.call('createTicket', { summary: 'a', category: 'billing', priority: 'normal' });
    expect(call.result).toContain('ACME-1042');
    await call.call('createTicket', { summary: 'b', category: 'billing', priority: 'normal' });
    expect(call.result).toContain('ACME-1043');
  });
});

describe('HTTP tool server', () => {
  const app = createToolServer({ scenario: supportScenario, decide: offline, config: DEFAULT_DECISION_CONFIG, log: () => {} });

  it('with a secret, only answers tool calls that carry it', async () => {
    const guarded = createToolServer({ scenario: supportScenario, decide: offline, config: DEFAULT_DECISION_CONFIG, secret: 's3cret', log: () => {} });
    const call = (headers: Record<string, string>) =>
      guarded.request('/tools/lookupAccount', { method: 'POST', headers, body: JSON.stringify({ accountNumber: '100234' }) });
    expect((await call({})).status).toBe(401);
    expect((await call({ 'X-Tool-Secret': 'wrong' })).status).toBe(401);
    expect((await call({ 'X-Tool-Secret': 's3cret' })).status).toBe(200);
    expect((await guarded.request('/health')).status).toBe(200);
  });

  it('returns the agent text and the complete new state in X-Ultravox-Update-Call-State', async () => {
    const response = await app.request('/tools/updateState', {
      method: 'POST',
      body: JSON.stringify({ action: 'issue_stated', additionalData: { issue_summary: 'Internet down' }, callState: initialAgentState(supportScenario), conversation: [] }),
    });
    expect(response.status).toBe(200);
    expect(await response.text()).toContain('Current state:');
    const state = JSON.parse(response.headers.get('X-Ultravox-Update-Call-State')!) as AgentCallState;
    expect(state.v).toBe(1);
    expect(state.machine.callData.issue_summary).toBe('Internet down');
  });

  it('404s an unknown tool', async () => {
    expect((await app.request('/tools/nope', { method: 'POST', body: '{}' })).status).toBe(404);
  });

  it('refuses a body that isn\'t JSON instead of resetting the call', async () => {
    const response = await app.request('/tools/updateState', { method: 'POST', body: 'not json' });
    expect(response.status).toBe(400);
    expect(response.headers.get('X-Ultravox-Update-Call-State')).toBeNull();
  });

  it('reports a failing tool to the agent without internals or a call state change', async () => {
    const boom = { name: 'boom', definition: { description: 'Fails.' }, run: () => Promise.reject(new Error('db password wrong')) };
    const broken = createToolServer({ scenario: { ...supportScenario, tools: [boom] }, decide: offline, config: DEFAULT_DECISION_CONFIG, log: () => {} });
    const response = await broken.request('/tools/boom', { method: 'POST', body: JSON.stringify({ conversation: [] }) });
    expect(response.status).toBe(200);
    expect(await response.text()).toBe('Error: the boom tool failed. Continue the conversation.');
    expect(response.headers.get('X-Ultravox-Update-Call-State')).toBeNull();
  });
});
