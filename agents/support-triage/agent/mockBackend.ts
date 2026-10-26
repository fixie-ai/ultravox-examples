// ----------------------------------------------------------------------------- //
// Mock backend for Acme Internet (fictional). Everything is in memory and       //
// deterministic so the demo and the tests behave the same way every time.       //
// Replace these functions with calls to your real CRM and ticketing system.     //
// (The knowledge base is in mockKnowledgeBase.ts.)                              //
// ----------------------------------------------------------------------------- //

export interface Customer {
  accountNumber: string;
  name: string;
  email: string;
  plan: string;
  status: 'active' | 'past_due';
}

export const CUSTOMERS: Customer[] = [
  { accountNumber: '100234', name: 'Jordan Lee', email: 'jordan.lee@example.com', plan: 'Fiber 500', status: 'active' },
  { accountNumber: '100871', name: 'Priya Shah', email: 'priya.shah@example.net', plan: 'Cable 200', status: 'active' },
  { accountNumber: '101552', name: 'Marcus Bell', email: 'marcus.bell@example.org', plan: 'Fiber 1 Gig', status: 'past_due' },
];

/** Turns a spoken email ("jordan dot lee at example dot com") into an address. */
export function normalizeEmail(input: string): string {
  return input
    .toLowerCase()
    .replace(/\s+at\s+/g, '@')
    .replace(/\s+dot\s+/g, '.')
    .replace(/\s+/g, '');
}

export function lookupAccount(query: { email?: unknown; accountNumber?: unknown }): Customer | undefined {
  if (typeof query.accountNumber === 'string' || typeof query.accountNumber === 'number') {
    const digits = String(query.accountNumber).replace(/\D/g, '');
    const match = CUSTOMERS.find((customer) => customer.accountNumber === digits);
    if (match) return match;
  }
  if (typeof query.email === 'string' && query.email.trim()) {
    const email = normalizeEmail(query.email);
    return CUSTOMERS.find((customer) => customer.email === email);
  }
  return undefined;
}

export type Priority = 'low' | 'normal' | 'high' | 'urgent';
export const PRIORITIES: Priority[] = ['low', 'normal', 'high', 'urgent'];

export interface Ticket {
  id: string;
  summary: string;
  category: string;
  priority: Priority;
  /** What the caller should expect, for the agent to tell them. */
  nextSteps: string;
}

const FIRST_TICKET_NUMBER = 1042;

/** Creates a ticket. `sequence` is how many tickets this call already created, so IDs are predictable per call. */
export function createTicket(input: { summary?: unknown; category?: unknown; priority?: unknown }, sequence = 0): Ticket {
  const priority = PRIORITIES.includes(input.priority as Priority) ? (input.priority as Priority) : 'normal';
  const fast = priority === 'urgent' || priority === 'high';
  return {
    id: `ACME-${FIRST_TICKET_NUMBER + sequence}`,
    summary: typeof input.summary === 'string' && input.summary.trim() ? input.summary.trim() : 'No summary given',
    category: typeof input.category === 'string' ? input.category : 'other',
    priority,
    nextSteps: fast
      ? 'A support specialist will call back within 4 hours.'
      : 'A support specialist will call back within one business day.',
  };
}
