import { describe, expect, it } from 'vitest';
import { searchMockKnowledgeBase } from './mockKnowledgeBase';

describe('searchMockKnowledgeBase', () => {
  it.each([
    ['technical', 'internet keeps dropping', 'kb-restart-router'],
    ['technical', 'already restarted the router, still down', 'kb-check-outage'],
    ['account_access', 'forgot my password', 'kb-reset-password'],
    ['billing', 'charged twice this month', 'kb-duplicate-pending-charge'],
    ['billing', 'card expired, update payment method', 'kb-update-payment-method'],
    ['cancel_service', 'want to cancel, too expensive', 'kb-cancellation-policy'],
  ])('%s / "%s" -> %s', (category, query, id) => {
    expect(searchMockKnowledgeBase({ category, query })?.id).toBe(id);
  });

  it('skips a fix the caller already tried', () => {
    expect(searchMockKnowledgeBase({ category: 'technical', query: 'internet is down', tried: ['router_restarted'] })?.id).toBe('kb-check-outage');
  });

  it('falls back to the category when no keyword matches', () => {
    expect(searchMockKnowledgeBase({ category: 'account_access', query: 'help' })?.id).toBe('kb-reset-password');
  });

  it('returns undefined when neither category nor keywords match', () => {
    expect(searchMockKnowledgeBase({ category: 'other', query: 'question about a refrigerator' })).toBeUndefined();
  });
});
