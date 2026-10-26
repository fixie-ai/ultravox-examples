import { CallData } from '../engine/types';

// Issue categories and the details each one needs. Kept as data so the prompts, the conditions and the tests all
// read one source. What each category and field means, as the agent reads it, is in prompts.ts.

export const CATEGORIES = ['billing', 'technical', 'account_access', 'cancel_service', 'other'] as const;
export type Category = (typeof CATEGORIES)[number];

export const REQUIRED_FIELDS: Record<Category, string[]> = {
  billing: ['charge_amount', 'charge_date', 'billing_problem'],
  technical: ['symptom', 'started_at', 'router_restarted'],
  account_access: ['access_problem'],
  cancel_service: ['cancel_reason'],
  other: ['description'],
};

export function isCategory(value: unknown): value is Category {
  return typeof value === 'string' && (CATEGORIES as readonly string[]).includes(value);
}

export function getDetails(callData: CallData): Record<string, unknown> {
  const details = callData.details;
  return details && typeof details === 'object' && !Array.isArray(details) ? (details as Record<string, unknown>) : {};
}

/** Required field names for the call's category that haven't been collected. */
export function missingFields(callData: CallData): string[] {
  if (!isCategory(callData.category)) return [];
  const details = getDetails(callData);
  return REQUIRED_FIELDS[callData.category].filter((field) => {
    const value = details[field];
    return value === undefined || value === null || value === '';
  });
}
