// How the observer runs for a call. Kept apart from observe.ts (which signs markers with node:crypto) so the
// browser debugger can import it too.

/** "thread": an Ultravox side thread calls the observeTurn tool. "dataconnection": a service on the call's data connection runs it. */
export type ObserverVariant = 'thread' | 'dataconnection';
/** The per-call observer setting: off, or which variant runs. */
export type ObserverSetting = 'off' | ObserverVariant;
export const OBSERVER_SETTINGS: ObserverSetting[] = ['off', 'thread', 'dataconnection'];
export const isObserverSetting = (value: unknown): value is ObserverSetting => OBSERVER_SETTINGS.includes(value as ObserverSetting);

/** Who forces a main tool call: the observer (either variant) or the extraction thread. */
export type MarkerVariant = ObserverVariant | 'extract';
