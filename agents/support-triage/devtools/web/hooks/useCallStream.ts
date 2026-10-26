import { useEffect, useState } from 'react';
import { applyEnvelope, CallModel, emptyCallModel, Envelope } from '../../shared/callModel';

type StreamStatus = 'connecting' | 'open' | 'closed';

interface Stream {
  callId: string;
  model: CallModel;
  status: StreamStatus;
  /** False if the socket closed without ever opening (the server doesn't know the call). */
  opened: boolean;
  /** When the call's data connection closed (server time), i.e. the call ended. */
  endedAt?: number;
}

const NO_CALL = emptyCallModel();

/**
 * Subscribes to a call's data connection stream, relayed by the devtools server: it replays every message so far,
 * then streams new ones. Each subscription builds its own model, so a re-run (a new call, Fast Refresh, StrictMode)
 * starts fresh, and messages from a socket that's been replaced are dropped.
 */
export function useCallStream(callId: string | undefined) {
  const [stream, setStream] = useState<Stream | undefined>(undefined);
  // applyEnvelope mutates the model; this re-renders after each message (and tells components it changed).
  const [version, setVersion] = useState(0);

  useEffect(() => {
    if (!callId) return;
    const model = emptyCallModel();
    let current = true;
    const update = (patch: Partial<Stream>) => current && setStream((s) => (s?.model === model ? { ...s, ...patch } : s));
    setStream({ callId, model, status: 'connecting', opened: false });

    const socket = new WebSocket(`${location.protocol === 'https:' ? 'wss' : 'ws'}://${location.host}/events/${callId}`);
    socket.onopen = () => update({ status: 'open', opened: true });
    socket.onerror = () => update({ status: 'closed' });
    socket.onclose = () => update({ status: 'closed' });
    socket.onmessage = (event) => {
      if (!current) return;
      const envelope = JSON.parse(event.data) as Envelope;
      applyEnvelope(model, envelope);
      if (envelope.message?.type === 'data_connection_closed') update({ endedAt: envelope.at });
      setVersion((version) => version + 1);
    };
    return () => {
      current = false;
      socket.close();
    };
  }, [callId]);

  // Until the effect has subscribed to a new call, don't show the previous one's stream.
  const live = callId && stream?.callId === callId ? stream : undefined;
  return {
    model: live?.model ?? NO_CALL,
    status: live?.status ?? (callId ? 'connecting' : 'closed'),
    opened: live?.opened ?? false,
    endedAt: live?.endedAt,
    /** Changes with every message: the model is mutated in place, so use this to notice it changed. */
    version,
  };
}
