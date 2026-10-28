import { describe, expect, it } from 'vitest';
import { supportScenario } from '.';
import { CallDriver } from '../engine/testDriver';

// One test per path in docs/sample-dialogs.md. Each plays the model's tool
// calls for the scripted caller and checks the state sequence.

describe('sample dialogs: support triage', () => {
  it('1. fixed through a knowledge-base article', async () => {
    const call = new CallDriver(supportScenario);
    // Caller: "Hi, my internet keeps dropping."
    call.act('issue_stated', {
      issue_summary: 'Internet keeps dropping',
      category: 'technical',
      details: { symptom: 'internet keeps dropping' },
    });
    // Caller: "It's jordan dot lee at example dot com."
    expect(await call.tool('lookupAccount', { email: 'jordan dot lee at example dot com' })).toMatchObject({ found: true });
    // The account moves the call on by itself, and classify_issue is skipped: the category came with issue_stated.
    expect(call.callState.currentState).toBe('collect_details');
    // The goal asks only for what's missing.
    const goal = call.lastResult.split('\n').find((line) => line.startsWith('Goal:'));
    expect(goal).toContain('started_at');
    expect(goal).not.toContain('symptom');
    // Caller: "Since this morning. No, I haven't restarted anything."
    call.act('details_collected', { details: { started_at: 'this morning', router_restarted: 'no' } });
    // The server searched the knowledge base on the way in.
    expect(call.data.kb_article).toMatchObject({ title: 'Restart your router' });
    // Caller: "OK, it's back. Thanks!"
    call.act('issue_resolved').act('end_call');

    expect(call.path).toEqual([
      'greeting',
      'identify_account',
      'classify_issue',
      'collect_details',
      'self_serve',
      'resolved',
      'call_ended',
    ]);
    expect(call.data.verified).toBe(true);
  });

  it('2. not fixed, so a ticket is created', async () => {
    const call = new CallDriver(supportScenario);
    // Caller: "My internet is down."
    call.act('issue_stated', { issue_summary: 'Internet is down', category: 'technical', details: { symptom: 'no internet' } });
    await call.tool('lookupAccount', { accountNumber: '100871' });
    // Caller: "Since last night, and yes, I already restarted the router."
    call.act('details_collected', { details: { started_at: 'last night', router_restarted: 'yes' } });
    expect(call.data.kb_article).toMatchObject({ title: 'Check for an outage in your area' });
    // Caller: "The light is still red."
    call.act('not_resolved');
    expect(call.rejected('end_call')).toMatch(/createTicket/);
    const ticket = await call.tool('createTicket', {
      summary: 'Internet down since last night; restarted router, light still red.',
      category: 'technical',
      priority: 'normal',
    });
    expect(ticket.ticketId).toBe('ACME-1042');
    call.act('end_call');

    expect(call.path).toEqual([
      'greeting',
      'identify_account',
      'classify_issue',
      'collect_details',
      'self_serve',
      'escalate',
      'call_ended',
    ]);
    expect(call.data.escalation_reason).toBe('not_resolved');
  });

  it('3. issue and details stated in the first sentence', async () => {
    const call = new CallDriver(supportScenario);
    // Caller: "Hi, I was charged twice this month, 79.99 on September 1st."
    call.act('issue_stated', {
      issue_summary: 'Charged twice this month',
      category: 'billing',
      details: { billing_problem: 'double charge', charge_amount: '$79.99', charge_date: 'September 1' },
    });
    await call.tool('lookupAccount', { accountNumber: '100234' });
    // The account moves the call on, and both classify_issue and collect_details are skipped.
    expect(call.callState.currentState).toBe('self_serve');
    expect(call.lastResult).toContain('Skipped "identify_account", "classify_issue", "collect_details"');
    // Caller: "Oh, so it's just pending. Got it."
    call.act('issue_resolved').act('end_call');

    expect(call.path).toEqual([
      'greeting',
      'identify_account',
      'classify_issue',
      'collect_details',
      'self_serve',
      'resolved',
      'call_ended',
    ]);
  });

  it('4. account not found, so the caller continues unverified', async () => {
    const call = new CallDriver(supportScenario);
    // Caller: "I can't get into my account."
    call.act('issue_stated', { issue_summary: "Can't get into my account" });
    // Caller gives an email that isn't on file, twice.
    expect(await call.tool('lookupAccount', { email: 'sam@example.com' })).toMatchObject({ found: false });
    call.act('account_not_found');
    expect(call.callState.currentState).toBe('identify_account');
    expect(call.lastResult).toContain('once more');
    expect(await call.tool('lookupAccount', { email: 's.a.m@example.com' })).toMatchObject({ found: false });
    // The second miss moves on by itself.
    expect(call.callState.currentState).toBe('classify_issue');
    expect(call.data.verified).toBe(false);
    // Caller: "I forgot my password."
    call.act('issue_classified', { category: 'account_access', details: { access_problem: 'forgot password' } });
    expect(call.callState.currentState).toBe('self_serve');
    call.act('issue_resolved').act('end_call');

    expect(call.path).toEqual([
      'greeting',
      'identify_account',
      'identify_account',
      'classify_issue',
      'collect_details',
      'self_serve',
      'resolved',
      'call_ended',
    ]);
  });

  it('5. caller asks for a human mid-flow', async () => {
    const call = new CallDriver(supportScenario);
    // Caller: "There's a charge on my bill I don't recognize."
    call.act('issue_stated', {
      issue_summary: 'Unrecognized charge',
      category: 'billing',
      details: { billing_problem: 'unrecognized charge' },
    });
    await call.tool('lookupAccount', { email: 'marcus.bell@example.org' });
    expect(call.callState.currentState).toBe('collect_details');
    // Caller: "It was $12."
    call.rejected('details_collected', { details: { charge_amount: '$12' } });
    // Caller: "Honestly, just get me a person."
    call.act('request_human');
    expect(call.callState.currentState).toBe('escalate');
    expect(call.lastResult).toContain('asked for a person');
    await call.tool('createTicket', { summary: 'Unrecognized $12 charge', category: 'billing', priority: 'normal' });
    // The ticket keeps the details collected before the handoff.
    expect(call.data.ticket).toMatchObject({
      account: '101552',
      details: { billing_problem: 'unrecognized charge', charge_amount: '$12' },
    });
    call.act('end_call');

    expect(call.path).toEqual([
      'greeting',
      'identify_account',
      'classify_issue',
      'collect_details',
      'escalate',
      'call_ended',
    ]);
    expect(call.data.escalation_reason).toBe('requested');
  });
});
