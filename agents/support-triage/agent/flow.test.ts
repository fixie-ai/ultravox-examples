import { describe, expect, it } from 'vitest';
import { supportScenario } from '.';
import { buildSystemPrompt, renderStateInstruction } from '../engine/prompt';
import { buildCallTemplate } from '../engine/ultravoxTools';
import { getAllActions, getAvailableActions, transition } from '../engine/stateMachine';
import { CallState } from '../engine/types';
import { CATEGORIES, missingFields, REQUIRED_FIELDS } from './fields';
import { CallDriver } from '../engine/testDriver';

const at = (currentState: string, callData: CallState['callData'] = {}): CallState => ({
  currentState,
  previousState: null,
  callData: { stateHistory: [], ...callData },
});

describe('support scenario definition', () => {
  it('greets with no tool call first, as an inbound agent-first call', () => {
    const config = buildCallTemplate(supportScenario, { baseUrl: 'https://t' });
    expect(config.firstSpeakerSettings).toEqual({ agent: {} });
    expect(config.systemPrompt).toContain('Goal: Greet the caller as Riley from Acme Internet');
    expect(config.systemPrompt).toContain("virtual assistant");
  });

  it('offers request_human everywhere except escalate and call_ended', () => {
    for (const state of Object.keys(supportScenario.states)) {
      const expected = state !== 'escalate' && state !== 'call_ended';
      expect(getAvailableActions(supportScenario, state).includes('request_human'), state).toBe(expected);
    }
  });

  it('mentions every action in the system prompt', () => {
    const prompt = buildSystemPrompt(supportScenario);
    for (const action of getAllActions(supportScenario)) expect(prompt).toContain(`"${action}"`);
  });

  it('never writes a script in the instructions', () => {
    for (const state of Object.keys(supportScenario.states)) {
      const text = renderStateInstruction(supportScenario, at(state, { category: 'billing' }));
      expect(text).toContain('Goal:');
      expect(text).not.toMatch(/say something like/i);
    }
  });
});

describe('fields', () => {
  it('has required fields for every category', () => {
    for (const category of CATEGORIES) expect(Object.keys(REQUIRED_FIELDS[category]).length).toBeGreaterThan(0);
  });

  it('lists missing fields for the category', () => {
    expect(missingFields({ category: 'billing', details: { charge_amount: '$5', charge_date: '' } })).toEqual([
      'charge_date',
      'billing_problem',
    ]);
    expect(missingFields({})).toEqual([]);
  });
});

describe('support state rules', () => {
  it('requires an issue summary before leaving greeting', () => {
    const call = new CallDriver(supportScenario);
    expect(call.rejected('issue_stated')).toMatch(/issue_summary/);
  });

  it('requires a successful lookup before account_verified', () => {
    const call = new CallDriver(supportScenario);
    call.act('issue_stated', { issue_summary: 'help' });
    expect(call.rejected('account_verified')).toMatch(/lookupAccount/);
  });

  it('skips identify_account if the account was looked up during the greeting', async () => {
    const call = new CallDriver(supportScenario);
    await call.tool('lookupAccount', { accountNumber: '100234' });
    call.act('issue_stated', { issue_summary: 'slow internet' });
    expect(call.callState.currentState).toBe('classify_issue');
  });

  it('rejects an unknown category and lists the valid ones', () => {
    const call = new CallDriver(supportScenario);
    call.act('issue_stated', { issue_summary: 'help' }).act('continue_unverified');
    expect(call.rejected('issue_classified', { category: 'refund' })).toContain(CATEGORIES.join(', '));
  });

  it('names the missing details when details_collected is premature, and keeps what was given', () => {
    const call = new CallDriver(supportScenario);
    call.act('issue_stated', { issue_summary: 'slow', category: 'technical' }).act('continue_unverified');
    const reason = call.rejected('details_collected', { details: { symptom: 'slow' } });
    expect(reason).toContain('started_at, router_restarted');
    expect(call.data.details).toEqual({ symptom: 'slow' });
  });

  it('sends "other" issues straight to escalate', () => {
    const call = new CallDriver(supportScenario);
    call
      .act('issue_stated', { issue_summary: 'question about a partnership', category: 'other' })
      .act('continue_unverified');
    call.act('details_collected', { details: { description: 'wants to partner' } });
    expect(call.callState.currentState).toBe('escalate');
    expect(call.data.escalation_reason).toBe('needs_specialist');
  });

  it('offers a retention option for cancellations', () => {
    const call = new CallDriver(supportScenario);
    call
      .act('issue_stated', { issue_summary: 'cancel', category: 'cancel_service', details: { cancel_reason: 'moving' } })
      .act('continue_unverified');
    expect(call.callState.currentState).toBe('self_serve');
    expect(call.lastResult).toContain('retention offer');
  });

  it('searches the knowledge base when the call reaches self_serve, and puts the steps in the goal', () => {
    const call = new CallDriver(supportScenario);
    call
      .act('issue_stated', { issue_summary: 'forgot my password', category: 'account_access', details: { access_problem: 'forgot password' } })
      .act('continue_unverified');
    expect(call.callState.currentState).toBe('self_serve');
    expect(call.data.kb_article).toMatchObject({ id: 'kb-reset-password' });
    expect(call.lastResult).toContain('From the knowledge base ("Reset your account password")');
  });


  it('allows issue_resolved with an article or when the caller confirmed the fix, not otherwise', () => {
    const at = (callData: Record<string, unknown>) => ({ currentState: 'self_serve', previousState: null, callData: { stateHistory: [], ...callData } });
    expect(() => transition(supportScenario, at({ category: 'technical' }), 'issue_resolved')).toThrow(/knowledge base/);
    expect(transition(supportScenario, at({ category: 'technical', kb_article: { id: 'x' } }), 'issue_resolved').callState.currentState).toBe('resolved');
    expect(transition(supportScenario, at({ category: 'technical', caller_confirmed_fixed: true }), 'issue_resolved').callState.currentState).toBe('resolved');
  });

  it('new_issue clears the last issue but keeps the account', async () => {
    const call = new CallDriver(supportScenario);
    await call.tool('lookupAccount', { accountNumber: '100234' });
    call.act('issue_stated', { issue_summary: 'pw', category: 'account_access', details: { access_problem: 'forgot' } });
    call.act('issue_resolved').act('new_issue', { issue_summary: 'Also my bill is high' });
    expect(call.callState.currentState).toBe('classify_issue');
    expect(call.data).toMatchObject({ category: undefined, details: undefined, kb_article: undefined, caller_confirmed_fixed: undefined, resolved_count: 1 });
    expect(call.data.account).toBeDefined();
  });

  it('new_issue keeps what the agent said about the new issue (only the last issue is cleared)', async () => {
    const call = new CallDriver(supportScenario);
    await call.tool('lookupAccount', { accountNumber: '100234' });
    call.act('issue_stated', { issue_summary: 'pw', category: 'account_access', details: { access_problem: 'forgot' } });
    call.act('issue_resolved').act('new_issue', { issue_summary: 'Billed multiple times this month', category: 'billing' });
    // The category came with new_issue, so classify_issue is skipped; the last issue's details are gone.
    expect(call.callState.currentState).toBe('collect_details');
    expect(call.data).toMatchObject({ category: 'billing', issue_summary: 'Billed multiple times this month', details: undefined });
  });
});
