import { createHmac, timingSafeEqual } from 'node:crypto';
import type { CallData } from '../types';
import type { MarkerVariant } from './settings';

// ----------------------------------------------------------------------------- //
// Observer marker                                                               //
// ----------------------------------------------------------------------------- //
// When the observer decides the caller already met the current goal, it forces  //
// a call to the agent's updateState tool on the main conversation, carrying     //
// this marker. The tool server applies the observer's decision instead of       //
// running its own check. The marker is signed with OBSERVER_SECRET so the model //
// can't forge "the observer said so", and it's tied to one call and expires, so //
// a copied marker can't be replayed later.                                      //
// ----------------------------------------------------------------------------- //

export const MARKER_KEY = '_observer';

/** How long a marker is valid. A forced call waits for the agent to finish speaking, so allow a while. */
export const MARKER_TTL_MS = 2 * 60_000;

export interface ObserverMarker {
  variant: MarkerVariant;
  /** The call it was issued for. */
  callId: string;
  /** When it was issued (ms since epoch). */
  issuedAt: number;
  /** The state the observer looked at. If the call has moved on, the marker is ignored. */
  fromState: string;
  /** The action to apply, if any. */
  action?: string;
  /** Call data from the decision (e.g. category, frustration). */
  overrides?: Partial<CallData>;
  /** Note for the agent's next instruction. */
  note?: string;
  /** When the caller's turn ended (ms since epoch), to measure how long the observer took. */
  turnAt?: number;
  /** The observer's decision, for the record in call state. */
  decision?: Record<string, unknown>;
}

function sign(payload: string, secret: string): string {
  return createHmac('sha256', secret).update(payload).digest('base64url');
}

/** The marker as it travels in the forced tool call's arguments. */
export function signMarker(marker: ObserverMarker, secret: string): { payload: string; signature: string } {
  const payload = JSON.stringify(marker);
  return { payload, signature: sign(payload, secret) };
}

/** Returns the marker if it's correctly signed, for this call, and not expired; else undefined. */
export function verifyMarker(value: unknown, secret: string | undefined, callId: string | undefined, now = Date.now()): ObserverMarker | undefined {
  if (!secret || !callId || !value || typeof value !== 'object') return undefined;
  const { payload, signature } = value as { payload?: unknown; signature?: unknown };
  if (typeof payload !== 'string' || typeof signature !== 'string') return undefined;
  const expected = Buffer.from(sign(payload, secret));
  const actual = Buffer.from(signature);
  if (expected.length !== actual.length || !timingSafeEqual(expected, actual)) return undefined;
  let marker: ObserverMarker;
  try {
    marker = JSON.parse(payload) as ObserverMarker;
  } catch {
    return undefined;
  }
  return marker.callId === callId && now - marker.issuedAt >= 0 && now - marker.issuedAt <= MARKER_TTL_MS ? marker : undefined;
}
