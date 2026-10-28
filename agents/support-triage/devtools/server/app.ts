import { randomUUID } from 'node:crypto';
import type { IncomingHttpHeaders, IncomingMessage, Server } from 'node:http';
import type { Duplex } from 'node:stream';
import { Hono } from 'hono';
import type { ContentfulStatusCode } from 'hono/utils/http-status';
import { WebSocket, WebSocketServer } from 'ws';
import type { DecideFn, DecisionConfig } from '../../engine/decision/check';
import { DetailsMode, extractionPrompt, isDetailsMode, missingFieldsFor } from '../../engine/decision/extraction';
import { initializeStateMachine } from '../../engine/stateMachine';
import { OBSERVER_TOOL, RECORD_DETAILS_TOOL } from '../../engine/ultravoxTools';
import { forcedToolCallMessage, observeTurn } from '../../engine/observer/observe';
import { isObserverSetting, OBSERVER_SETTINGS, ObserverSetting } from '../../engine/observer/settings';
import type { AnyScenario } from '../../engine/types';
import { agentName, createAgentCall, findAgent, getCall, listModels, syncAgents } from '../../engine/ultravoxAgents';
import { applyEnvelope, CallModel, emptyCallModel, Envelope } from '../shared/callModel';

// ----------------------------------------------------------------------------- //
// Devtools server                                                              //
// ----------------------------------------------------------------------------- //
// - POST /api/calls: creates a test call from the saved Ultravox agent for the  //
//   chosen model, adding a data connection back to this server.               //
// - WS /dc/:token: Ultravox connects here and streams the call's data messages. //
// - WS /events/:callId: the debugger and scripts subscribe; they get every      //
//   message so far, then each new one, stamped with when it arrived.          //
// - Observer, per call: "thread" spawns an Ultravox thread that calls the       //
//   observeTurn HTTP tool; "dataconnection" runs the observer here and sends    //
//   the forced tool call over the data connection.                             //
// Only /dc is public: the tunnel reaches the whole server, so /api and /events //
// refuse requests that came through it (see viaTunnel), and ones a web page   //
// on another site could send (see isLocalHost, isLocalOrigin).                //
// ----------------------------------------------------------------------------- //

const DATA_MESSAGES = {
  transcript: true,
  state: true,
  callStarted: true,
  callEvent: true,
  toolUsed: true,
};

/** Finished calls stay for review (?callId=); beyond this many, the oldest are dropped. */
const MAX_SESSIONS = 50;

/**
 * True when a request came through the Cloudflare tunnel: Cloudflare adds these headers, and requests from this
 * machine (the Vite proxy, the scripts) don't have them. The tunnel exists only for Ultravox's data connection,
 * so anything else arriving through it is someone with the URL, who could otherwise create calls on your
 * account or read them.
 */
export function viaTunnel(headers: Headers | IncomingHttpHeaders): boolean {
  const has = (name: string) => (headers instanceof Headers ? headers.has(name) : headers[name] !== undefined);
  return has('cf-connecting-ip') || has('cf-ray');
}

/**
 * True for a Host header naming this machine. A page on another site can make a browser send requests here, and
 * with DNS rebinding its own hostname can resolve to 127.0.0.1; its Host header still names that site.
 */
export const isLocalHost = (host: string | undefined) => !!host && /^(localhost|127\.0\.0\.1)(:\d+)?$/i.test(host);
/** True when a WebSocket upgrade may subscribe: no Origin (a script, not a browser) or a page served from this machine. */
export const isLocalOrigin = (origin: string | undefined) => origin === undefined || /^https?:\/\/(localhost|127\.0\.0\.1)(:\d+)?$/i.test(origin);

interface Session {
  token: string;
  /** When the call was requested (see live). */
  createdAt: number;
  callId?: string;
  model?: string;
  observer: ObserverSetting;
  details: DetailsMode;
  envelopes: Envelope[];
  subscribers: Set<WebSocket>;
  /** Ultravox's data connection, for sending messages into the call. */
  dataConnection?: WebSocket;
  /** What the data messages say so far (the data-connection observer reads it). */
  stream: CallModel;
  lastObservedOrdinal: number;
}

export interface DevtoolsOptions {
  ultravoxApiKey: string;
  /** Public https URL of this server (the tunnel), for the data connection. */
  publicUrl: string;
  /** Public URL of the tool server, to sync each agent on first use (see agentIdFor). */
  toolsPublicUrl?: string;
  /** The tool server's TOOLS_SECRET, for the agents it syncs. */
  toolsSecret?: string;
  agentPrefix: string;
  scenario: AnyScenario;
  /** For the data-connection observer. */
  decide?: DecideFn;
  config?: DecisionConfig;
  observerSecret?: string;
  log?: (message: string) => void;
}

export function createDevtools(options: DevtoolsOptions) {
  const log = options.log ?? console.log;
  const sessions = new Map<string, Session>();
  const byCallId = new Map<string, Session>();
  const agentIds = new Map<string, Promise<string>>();
  // The data-connection observer runs here: it needs the decision model, its config and the marker secret.
  const observerHere =
    options.decide && options.config && options.observerSecret
      ? { decide: options.decide, config: options.config, secret: options.observerSecret }
      : undefined;

  /** A call that may still be running: its data connection is open, or it hasn't connected yet (a minute's grace). */
  const live = (session: Session) =>
    session.dataConnection ? session.dataConnection.readyState === WebSocket.OPEN : Date.now() - session.createdAt < 60_000;

  /** Adds a session, dropping the oldest finished ones (and closing their sockets) past MAX_SESSIONS. */
  function remember(session: Session) {
    sessions.set(session.token, session);
    for (const [token, old] of sessions) {
      if (sessions.size <= MAX_SESSIONS) break;
      if (live(old)) continue;
      sessions.delete(token);
      if (old.callId) byCallId.delete(old.callId);
      old.dataConnection?.close();
      for (const subscriber of old.subscribers) subscriber.close();
    }
  }

  /**
   * The saved agent for a model. With toolsPublicUrl (pnpm dev), it's synced (created or updated) the first
   * time it's used in this process: the tunnel URL and TOOLS_SECRET change on every run, and tsx watch restarts this
   * server when agent/ changes, so prompt and tool edits reach the agent on the next call. The promise is cached, so
   * calls started together (pnpm compare) share one sync instead of each creating the agent; a failure is forgotten
   * so the next call retries. Without toolsPublicUrl, it uses the agent pnpm agent:sync saved.
   */
  function agentIdFor(model?: string): Promise<string> {
    const name = agentName(options.agentPrefix, model);
    let agentId = agentIds.get(name);
    if (!agentId) {
      const pending = resolveAgentId(name, model);
      agentIds.set(name, pending);
      pending.catch(() => agentIds.get(name) === pending && agentIds.delete(name));
      agentId = pending;
    }
    return agentId;
  }

  async function resolveAgentId(name: string, model?: string): Promise<string> {
    let agent: { agentId: string } | undefined;
    if (options.toolsPublicUrl) {
      log(`syncing Ultravox agent ${name}`);
      [agent] = await syncAgents({
        apiKey: options.ultravoxApiKey,
        scenario: options.scenario,
        toolsBaseUrl: options.toolsPublicUrl,
        toolsSecret: options.toolsSecret,
        prefix: options.agentPrefix,
        models: [model],
      });
    } else {
      agent = await findAgent(options.ultravoxApiKey, name);
    }
    if (!agent) throw new Error(`No Ultravox agent named "${name}". Run pnpm agent:sync.`);
    return agent.agentId;
  }

  function publish(session: Session, message: unknown) {
    const envelope: Envelope = { at: Date.now(), message };
    session.envelopes.push(envelope);
    applyEnvelope(session.stream, envelope);
    const data = JSON.stringify(envelope);
    for (const subscriber of session.subscribers) {
      if (subscriber.readyState === WebSocket.OPEN) subscriber.send(data);
    }
    return envelope;
  }

  function send(session: Session, message: unknown) {
    if (session.dataConnection?.readyState === WebSocket.OPEN) session.dataConnection.send(JSON.stringify(message));
  }

  /**
   * "extract" details mode: after a caller turn in a state that captures answers, a side thread (a real LLM
   * generation) pulls out the fields still missing and calls recordDetails, which sends them to the main
   * conversation.
   */
  function extract(session: Session, ordinal: number) {
    if (session.details !== 'extract') return;
    const machine = session.stream.agentState?.machine;
    if (!machine) return;
    const missing = missingFieldsFor(options.scenario, machine);
    if (Object.keys(missing).length === 0) return;
    send(session, {
      type: 'spawn_thread',
      newThreadId: 'extractor',
      parentThreadId: 'UI',
      ifExists: 'replace',
      additionalMessages: [{ type: 'user_text_message', text: extractionPrompt(options.scenario, missing) }],
      toolFilter: { allowedTools: [RECORD_DETAILS_TOOL] },
      // One generation to call recordDetails (plus one to finish if needed); keep the output small.
      limits: { generationLimit: 2, threadOutputTokenLimit: 400 },
    });
    publish(session, { type: 'extraction_started', ordinal, fields: Object.keys(missing) });
  }

  /** After a final caller turn, run the observer the session asked for. */
  async function observe(session: Session, ordinal: number, turnAt: number) {
    if (session.observer === 'thread') {
      // The thread forks the conversation and runs observeTurn. observeTurn answers with the "listens" reaction, so
      // the thread doesn't generate; the limits only cap it in case it does. (Ultravox rejects a thread whose
      // generationLimit is already used up, so it can't be 0.)
      send(session, {
        type: 'spawn_thread',
        newThreadId: 'observer',
        parentThreadId: 'UI',
        ifExists: 'replace',
        additionalMessages: [
          { type: 'forced_agent_message', toolCalls: [{ id: `observe-${ordinal}`, name: OBSERVER_TOOL, arguments: { turnAt } }] },
        ],
        toolFilter: { allowedTools: [OBSERVER_TOOL] },
        limits: { generationLimit: 1, threadOutputTokenLimit: 50 },
      });
      return;
    }
    // Observer markers are bound to one call, so this needs the call id (set once the call is created).
    if (session.observer !== 'dataconnection' || !observerHere || !session.callId) return;
    const machine = session.stream.agentState?.machine ?? initializeStateMachine(options.scenario);
    const transcripts = session.stream.events.flatMap((event) =>
      event.kind === 'turn' ? [{ speaker: event.speaker === 'caller' ? 'user' : 'agent', text: event.text }] : []
    );
    const observation = await observeTurn(options.scenario, machine, transcripts, {
      detailsMode: session.details,
      variant: 'dataconnection',
      ...observerHere,
      callId: session.callId,
      turnAt,
    });
    // Shown in the debugger (and counted in the cost), whether or not it acted.
    publish(session, { type: 'observer_decision', log: { ...observation.log, request: undefined } });
    if (observation.forcedCall) send(session, forcedToolCallMessage(observation.forcedCall));
  }

  /** After a data message is in the model: a new final caller turn runs the observer and the extraction thread. */
  function onDataMessage(session: Session, message: { type?: string; role?: string; final?: boolean; ordinal?: number } | null, envelope: Envelope) {
    if (message?.type !== 'transcript' || message.role !== 'user' || !message.final || message.ordinal === undefined) return;
    if (message.ordinal <= session.lastObservedOrdinal) return;
    // The model has the whole line: instructions and empty finals (dropped from the model) aren't caller turns.
    if (session.stream.lines.get(message.ordinal)?.kind !== 'turn') return;
    session.lastObservedOrdinal = message.ordinal;
    observe(session, message.ordinal, envelope.at).catch((error) => log(`observer failed: ${String(error)}`));
    extract(session, message.ordinal);
  }

  const app = new Hono();

  // Only this machine may use the API (see viaTunnel, isLocalHost); /health is public for pnpm dev's tunnel readiness
  // check. A POST must be JSON: a cross-site form or no-cors fetch can't send that, so a web page can't start a call.
  app.use('/api/*', async (c, next) => {
    if (viaTunnel(c.req.raw.headers) || !isLocalHost(c.req.header('host') ?? new URL(c.req.url).host)) {
      return c.json({ error: 'The devtools API is only available locally.' }, 403);
    }
    if (c.req.method === 'POST' && !/^application\/json\s*(;|$)/i.test(c.req.header('content-type') ?? '')) {
      return c.json({ error: 'Send JSON (Content-Type: application/json).' }, 415);
    }
    await next();
  });
  app.get('/health', (c) => c.json({ ok: true }));

  app.post('/api/calls', async (c) => {
    type Body = { model?: string; observer?: ObserverSetting; details?: DetailsMode; medium?: 'webrtc' | 'text' };
    const body = await c.req.json<Body>().catch(() => ({}) as Body);
    const details: DetailsMode = isDetailsMode(body.details) ? body.details : 'agent';
    const model = body.model && body.model !== 'default' ? body.model : undefined;
    const observer: ObserverSetting = isObserverSetting(body.observer) ? body.observer : 'off';
    if (observer === 'dataconnection' && !observerHere) {
      return c.json({ error: 'The data-connection observer needs a decision provider, its config and OBSERVER_SECRET on the devtools server.' }, 400);
    }
    const token = randomUUID();
    const session: Session = { token, createdAt: Date.now(), model, observer, details, envelopes: [], subscribers: new Set(), stream: emptyCallModel(), lastObservedOrdinal: -1 };
    remember(session);
    try {
      const call = await createAgentCall(options.ultravoxApiKey, await agentIdFor(model), {
        // Per-call settings the agent's tools read (KNOWN_PARAM_CALL_METADATA).
        metadata: { details },
        dataConnection: {
          websocketUrl: `${options.publicUrl.replace(/^http/, 'ws').replace(/\/$/, '')}/dc/${token}`,
          dataMessages: DATA_MESSAGES,
        },
        // text-call drives calls in text over a WebSocket instead of WebRTC audio.
        ...(body.medium === 'text'
          ? { medium: { serverWebSocket: { inputSampleRate: 16000, outputSampleRate: 16000 } }, initialOutputMedium: 'MESSAGE_MEDIUM_TEXT' }
          : {}),
      });
      session.callId = call.callId;
      byCallId.set(call.callId, session);
      // How the call was set up, for the debugger and scripts (data messages may already have arrived before it).
      publish(session, { type: 'devtools_call', model: model ?? 'default', observer, details });
      log(`call ${call.callId} (${model ?? 'default model'}, observer ${observer}, details ${details}${body.medium === 'text' ? ', text' : ''})`);
      return c.json({ callId: call.callId, joinUrl: call.joinUrl, model: model ?? 'default', observer, details });
    } catch (error) {
      sessions.delete(token);
      log(`call creation failed: ${String(error)}`);
      // Pass on Ultravox's 4xx (e.g. 429 when it's limiting calls, which text-call retries); anything else is a 502.
      const status = Number(/Ultravox \S+ \S+ returned (\d{3})/.exec(String(error))?.[1]);
      return c.json({ error: String(error) }, (status >= 400 && status < 500 ? status : 502) as ContentfulStatusCode);
    }
  });

  // A call's timing from Ultravox, for the cost estimate.
  app.get('/api/calls/:callId', async (c) => {
    try {
      const call = await getCall(options.ultravoxApiKey, c.req.param('callId'));
      return c.json({ callId: call.callId, joined: call.joined ?? null, ended: call.ended ?? null, model: call.model ?? null });
    } catch (error) {
      return c.json({ error: String(error) }, 502);
    }
  });

  // Models this account can use, for the model picker.
  app.get('/api/models', async (c) => {
    try {
      return c.json({ models: await listModels(options.ultravoxApiKey) });
    } catch (error) {
      return c.json({ error: String(error) }, 502);
    }
  });

  app.get('/api/health', (c) =>
    c.json({ ok: true, publicUrl: options.publicUrl, observers: OBSERVER_SETTINGS.filter((o) => o !== 'dataconnection' || !!observerHere) })
  );

  // ---- WebSockets: Ultravox's data connection in, subscribers out ----
  const wss = new WebSocketServer({ noServer: true });

  function onUpgrade(request: IncomingMessage, socket: Duplex, head: Buffer) {
    const url = new URL(request.url ?? '/', 'http://localhost');
    const [, kind, id] = url.pathname.split('/');
    // /dc is reached through the tunnel (its random token is the guard); /events is local only, like /api.
    if (kind === 'events' && (viaTunnel(request.headers) || !isLocalHost(request.headers.host) || !isLocalOrigin(request.headers.origin))) {
      socket.end('HTTP/1.1 403 Forbidden\r\nConnection: close\r\n\r\n');
      return;
    }
    const session = kind === 'dc' ? sessions.get(id) : kind === 'events' ? byCallId.get(id) : undefined;
    if (!session) {
      socket.destroy();
      return;
    }
    wss.handleUpgrade(request, socket, head, (ws) => {
      ws.on('error', (error) => log(`${kind} socket error: ${error.message}`));
      if (kind === 'dc') {
        log(`data connection open for ${session.callId ?? session.token}`);
        session.dataConnection = ws;
        ws.on('message', (data, isBinary) => {
          if (isBinary) return;
          let message;
          try {
            message = JSON.parse(data.toString());
          } catch {
            return; // Ignore anything that isn't JSON.
          }
          onDataMessage(session, message, publish(session, message));
        });
        ws.on('close', () => publish(session, { type: 'data_connection_closed' }));
      } else {
        for (const envelope of session.envelopes) ws.send(JSON.stringify(envelope));
        session.subscribers.add(ws);
        ws.on('close', () => session.subscribers.delete(ws));
      }
    });
  }

  /** Attaches the WebSocket endpoints to the HTTP server. */
  function attach(server: Server) {
    server.on('upgrade', onUpgrade);
  }

  return { app, attach };
}
