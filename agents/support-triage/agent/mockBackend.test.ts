import { describe, expect, it } from 'vitest';
import { createTicket, lookupAccount, normalizeEmail } from './mockBackend';

describe('lookupAccount', () => {
  it('finds a customer by email, including spoken form and odd casing', () => {
    expect(lookupAccount({ email: 'jordan.lee@example.com' })?.name).toBe('Jordan Lee');
    expect(lookupAccount({ email: 'Jordan dot Lee at example dot com' })?.name).toBe('Jordan Lee');
  });

  it('finds a customer by account number, ignoring spaces and dashes', () => {
    expect(lookupAccount({ accountNumber: '100-871' })?.name).toBe('Priya Shah');
    expect(lookupAccount({ accountNumber: 101552 })?.name).toBe('Marcus Bell');
  });

  it('returns undefined when nothing matches', () => {
    expect(lookupAccount({ email: 'nobody@example.com' })).toBeUndefined();
    expect(lookupAccount({ accountNumber: '999999' })).toBeUndefined();
    expect(lookupAccount({})).toBeUndefined();
  });

  it('normalizes spoken emails', () => {
    expect(normalizeEmail(' Priya dot Shah at Example dot net ')).toBe('priya.shah@example.net');
  });
});

describe('createTicket', () => {
  it('returns predictable ticket IDs per call', () => {
    expect(createTicket({ summary: 'a', category: 'billing', priority: 'normal' }).id).toBe('ACME-1042');
    expect(createTicket({ summary: 'b', category: 'billing', priority: 'normal' }, 1).id).toBe('ACME-1043');
  });

  it('defaults bad priorities to normal and promises a faster callback for high priority', () => {
    expect(createTicket({ summary: 'a', priority: 'whenever' }).priority).toBe('normal');
    expect(createTicket({ summary: 'a', priority: 'high' }).nextSteps).toMatch(/4 hours/);
    expect(createTicket({ summary: 'a', priority: 'normal' }).nextSteps).toMatch(/one business day/);
  });
});
