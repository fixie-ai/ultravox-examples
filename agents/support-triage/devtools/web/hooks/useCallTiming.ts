import { useEffect, useState } from 'react';

/** Where the duration comes from; see CostMeter. */
export type TimingSource = 'live' | 'final' | 'loading' | 'local';

interface Timing {
  callId?: string;
  /** Local clock, for a call joined in this tab. */
  joinedAt?: number;
  endedAt?: number;
  /** Ultravox's join time, for a call opened with ?callId= that's still running. */
  ultravoxJoinedAt?: number;
  /** From Ultravox's join/end times. */
  officialDurationMs?: number;
  /** Stopped asking Ultravox for its times. */
  gaveUp?: boolean;
}

/** Applies a patch to the timing of one call; timing kept for another call is replaced. */
const patched = (callId: string, patch: Partial<Timing>) => (timing: Timing) => ({
  ...(timing.callId === callId ? timing : { callId }),
  ...patch,
});

interface Options {
  /** A call joined in this tab is connected. */
  callActive: boolean;
  /** The call was opened with ?callId=: only Ultravox's times are known. */
  viewOnly: boolean;
  /** When the call's data connection closed, if it has. */
  streamEndedAt?: number;
}

/**
 * How long the call ran, for the cost estimate. A call joined here uses the local clock while live, then
 * Ultravox's join/end times once recorded (they can take a moment). A call opened with ?callId= polls Ultravox
 * until the call has ended, counting from Ultravox's join time meanwhile.
 */
export function useCallTiming(
  callId: string | undefined,
  { callActive, viewOnly, streamEndedAt }: Options
): { durationMs: number; source: TimingSource } {
  const [stored, setStored] = useState<Timing>({});
  const timing: Timing = stored.callId === callId ? stored : { callId };
  const [now, setNow] = useState(() => Date.now());

  // Local clock: when the call connects and ends.
  useEffect(() => {
    if (!callId || viewOnly) return;
    if (callActive && timing.joinedAt === undefined) setStored(patched(callId, { joinedAt: Date.now() }));
    if (!callActive && timing.joinedAt !== undefined && timing.endedAt === undefined) setStored(patched(callId, { endedAt: Date.now() }));
  }, [callId, viewOnly, callActive, timing.joinedAt, timing.endedAt]);

  // Ultravox's times: after a call joined here ends (a few tries), or until a viewed call ends.
  const ended = timing.endedAt !== undefined;
  const done = timing.officialDurationMs !== undefined || !!timing.gaveUp;
  useEffect(() => {
    if (!callId || done || !(viewOnly || ended)) return;
    let cancelled = false;
    let timer: ReturnType<typeof setTimeout> | undefined;
    let attempts = 0;
    let failures = 0;
    const poll = async () => {
      const response = await fetch(`/api/calls/${callId}`).catch(() => undefined);
      const times = response?.ok ? await response.json().catch(() => ({})) : {};
      if (cancelled) return;
      if (times.ended) {
        const official = times.joined ? Date.parse(times.ended) - Date.parse(times.joined) : 0;
        setStored(patched(callId, { officialDurationMs: official }));
        return;
      }
      if (times.joined) setStored(patched(callId, { ultravoxJoinedAt: Date.parse(times.joined) }));
      attempts++;
      failures = response?.ok ? 0 : failures + 1;
      if (viewOnly ? failures >= 10 : attempts >= 5) {
        setStored(patched(callId, { gaveUp: true }));
        return;
      }
      timer = setTimeout(poll, viewOnly ? 3000 : 2000);
    };
    poll();
    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
  }, [callId, viewOnly, ended, done]);

  const viewedLive = viewOnly && !done && timing.ultravoxJoinedAt !== undefined && streamEndedAt === undefined;
  const ticking = callActive || viewedLive;
  useEffect(() => {
    if (!ticking) return;
    setNow(Date.now());
    const timer = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(timer);
  }, [ticking]);

  const since = (start: number | undefined, end: number) => (start === undefined ? 0 : Math.max(0, end - start));
  if (timing.officialDurationMs !== undefined) return { durationMs: timing.officialDurationMs, source: 'final' };
  if (viewOnly) {
    const durationMs = since(timing.ultravoxJoinedAt, streamEndedAt ?? now);
    return { durationMs, source: timing.gaveUp ? 'local' : viewedLive ? 'live' : 'loading' };
  }
  const durationMs = since(timing.joinedAt, timing.endedAt ?? now);
  return { durationMs, source: callActive ? 'live' : ended && !timing.gaveUp ? 'loading' : 'local' };
}
