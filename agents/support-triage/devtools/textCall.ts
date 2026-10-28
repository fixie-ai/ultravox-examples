import { WebSocket } from 'ws';
import type { DetailsMode } from '../engine/decision/extraction';
import type { ObserverSetting } from '../engine/observer/settings';
import { supportScenario } from '../agent';
import { applyEnvelope, CallModel, decisionsOf, emptyCallModel, summarizePath, TimelineEvent, timingsOf } from './shared/callModel';
import { CostEstimate, estimateCost, formatUsd, ratesFromEnv } from './shared/cost';

// ----------------------------------------------------------------------------- //
// Scripted text calls against the running agent (needs `pnpm dev`).            //
// Creates a call from the saved Ultravox agent through the devtools server,    //
// plays the caller's lines as text, and follows the data connection stream.   //
// ----------------------------------------------------------------------------- //

export interface TextCallResult {
  callId: string;
  model: string;
  observer: string;
  details: string;
  path: string[];
  finalState: string;
  /** Everything the data connection said about the call. */
  stream: CallModel;
  stuck: boolean;
  /** True when the call ended (e.g. the agent hung up) before the script finished. */
  ended: boolean;
  cost?: CostEstimate;
  timings: ReturnType<typeof timingsOf>;
}

export interface TextCallOptions {
  /** Ultravox model; "default" (or undefined) for Ultravox's default. */
  model?: string;
  /** off, thread or dataconnection. */
  observer?: ObserverSetting;
  /** How the caller's free-text answers are captured: agent, jev or extract. */
  details?: DetailsMode;
  lines: string[];
  /** Print the conversation and events as they happen. */
  verbose?: boolean;
}

/** How long to wait for the agent to finish a reply. */
const REPLY_TIMEOUT_MS = 25_000;

/** A call in the web debugger (Vite, on DEVTOOLS_WEB_PORT). */
export const debuggerUrl = (callId: string) => `http://localhost:${process.env.DEVTOOLS_WEB_PORT || 5173}/?callId=${callId}`;

function describe(event: TimelineEvent): string | undefined {
  switch (event.kind) {
    case 'turn':
      return event.final ? `${event.speaker === 'caller' ? 'CALLER' : 'AGENT '}: ${event.text.trim()}` : undefined;
    case 'tool':
      return `  tool ${event.name}(${JSON.stringify(event.params)})${event.ms !== undefined ? ` ${event.ms} ms` : ''}${event.threadId !== 'UI' ? ` [thread ${event.threadId}]` : ''}`;
    case 'transition':
      return `  state: ${event.steps.map((step) => `${step.from} -${step.action}-> ${step.to}${step.automatic ? ' (auto)' : ''}`).join(', ')} [${event.by}]`;
    case 'decision': {
      const log = event.log;
      if (log.source === 'observer' && log.verdict === 'no_change') return `  observer (${log.observer?.variant}): no change, top=${log.outcome?.[0]?.[0] ?? '-'} ${log.latencyMs} ms`;
      const top = log.outcome?.[0];
      const extras = Object.entries(log.extras ?? {})
        .map(([id, [best, p]]) => `${id}=${best}(${p.toFixed(2)})`)
        .join(' ');
      return `  Jev ${log.source} ${log.verdict} in ${log.state}: proposed=${log.proposed} top=${top ? `${top[0]}(${top[1].toFixed(2)})` : '-'} ${extras} ${log.latencyMs} ms${log.error ? ` error=${log.error}` : ''}`;
    }
    case 'response':
      return `  agent responded in ${event.seconds.toFixed(2)} s (${event.result})`;
    case 'thread':
      return `  thread ${event.type} ${event.threadId}`;
    default:
      return undefined;
  }
}

export async function runTextCall(options: TextCallOptions): Promise<TextCallResult> {
  // 127.0.0.1: the devtools server listens only there.
  const devtoolsUrl = process.env.DEVTOOLS_URL || `http://127.0.0.1:${process.env.DEVTOOLS_PORT || 8788}`;
  const print = (text: string | undefined) => text && options.verbose && console.log(text);

  // Ultravox limits how fast calls can be created and how many run at once (429). Wait and retry.
  let created: Response | undefined;
  for (let attempt = 0; attempt < 12; attempt++) {
    created = await fetch(`${devtoolsUrl}/api/calls`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ model: options.model, observer: options.observer, details: options.details, medium: 'text' }),
    }).catch(() => undefined);
    if (!created) throw new Error(`Can't reach the devtools server at ${devtoolsUrl}. Is pnpm dev running?`);
    if (created.ok) break;
    const text = await created.text();
    // The devtools server passes on Ultravox's status.
    if (created.status !== 429) throw new Error(`Creating the call failed (${created.status}): ${text}`);
    const seconds = Number(/available in (\d+) second/.exec(text)?.[1] ?? 10);
    print(`(Ultravox is limiting calls: ${/Too many concurrent calls/.test(text) ? 'too many at once' : 'rate limit'}; retrying in ${seconds + 1}s)`);
    await new Promise((resolve) => setTimeout(resolve, (seconds + 1 + Math.random() * 2) * 1000));
    created = undefined;
  }
  if (!created) throw new Error('Creating the call failed: Ultravox kept limiting calls (429).');
  const { callId, joinUrl, model, observer, details } = (await created.json()) as { callId: string; joinUrl: string; model: string; observer: string; details: string };
  print(`call ${callId} (${model}, observer ${observer}, details ${details}) · debugger: ${debuggerUrl(callId)}`);

  // Follow the data connection stream.
  const stream = emptyCallModel();
  let printed = 0;
  const events = new WebSocket(`${devtoolsUrl.replace(/^http/, 'ws')}/events/${callId}`);
  // Join the call as the caller, in text.
  const call = new WebSocket(joinUrl);
  let status = '';
  let ended = false;
  let stuck = false;
  let lastActivity = Date.now();
  let finishing = false;
  // A socket error fails this call only (a script like pnpm compare goes on with the others).
  let failed: Error | undefined;
  const fail = (what: string) => (error: Error) => (failed ??= new Error(`${what}: ${error.message}`));
  events.on('error', fail('The devtools event stream failed'));
  // Closed by the server before the call ended: it restarted (tsx watch) or stopped, so the stream is incomplete.
  events.on('close', () => !finishing && !ended && fail('The devtools event stream closed')(new Error('was the devtools server restarted?')));
  call.on('error', fail('The call socket failed'));
  events.on('message', (data) => {
    applyEnvelope(stream, JSON.parse(data.toString()));
    // Print events once they're final (transcript lines finish later than they start).
    while (printed < stream.events.length) {
      const event = stream.events[printed];
      if (event.kind === 'turn' && !event.final) break;
      print(describe(event));
      printed++;
    }
  });
  call.on('close', () => (ended = true));
  call.on('message', (data, isBinary) => {
    if (isBinary) return;
    lastActivity = Date.now();
    const message = JSON.parse(data.toString());
    if (message.type === 'state') status = message.state;
  });

  try {
    await new Promise((resolve, reject) => {
      call.once('open', resolve);
      call.once('error', reject);
    });

    // A reply is done once the agent is listening and nothing has arrived for 2.5 s: right after it starts
    // listening, trailing tool calls (or a forced observer call) can still make it speak again.
    const settled = async () => {
      const deadline = Date.now() + REPLY_TIMEOUT_MS;
      while (Date.now() < deadline) {
        await new Promise((resolve) => setTimeout(resolve, 400));
        if (failed) throw failed;
        if (ended || (status === 'listening' && Date.now() - lastActivity > 2500)) return true;
      }
      return false;
    };

    stuck = !(await settled());
    for (const line of options.lines) {
      if (stuck || ended) break;
      call.send(JSON.stringify({ type: 'user_text_message', text: line }));
      stuck = !(await settled());
    }
    if (stuck) print(`!! no reply within ${REPLY_TIMEOUT_MS / 1000}s (status: ${status})`);

    if (ended) print('(the agent ended the call)');
    else call.send(JSON.stringify({ type: 'hang_up', message: '' }));
    await new Promise((resolve) => setTimeout(resolve, 1500));
  } finally {
    finishing = true;
    call.close();
    events.close();
  }
  if (failed) throw failed;

  // Cost from Ultravox's join/end times (they can take a moment to be recorded). Without them the result stands.
  let cost: CostEstimate | undefined;
  for (let attempt = 0; attempt < 5 && !cost; attempt++) {
    type Times = { joined?: string; ended?: string };
    const times = await fetch(`${devtoolsUrl}/api/calls/${callId}`)
      .then((response) => response.json() as Promise<Times>)
      .catch((): Times => ({}));
    if (times.joined && times.ended) {
      cost = estimateCost(Date.parse(times.ended) - Date.parse(times.joined), decisionsOf(stream), ratesFromEnv(process.env));
    } else {
      await new Promise((resolve) => setTimeout(resolve, 1500));
    }
  }

  const scenario = supportScenario;
  const path = summarizePath(scenario.initialState, stream.events).visits.map((visit) => visit.state);
  return {
    callId,
    model,
    observer,
    details,
    path,
    finalState: stream.agentState?.machine.currentState ?? scenario.initialState,
    stream,
    stuck,
    ended,
    cost,
    timings: timingsOf(stream),
  };
}

export function formatCost(cost: CostEstimate | undefined): string {
  if (!cost) return 'estimated cost: unavailable';
  return (
    `estimated cost: ${formatUsd(cost.totalUsd)} = Ultravox ${formatUsd(cost.ultravox.usd)} ` +
    `(${cost.ultravox.seconds.toFixed(1)}s → ${cost.ultravox.increments} × ${cost.rates.incrementSeconds}s at $${cost.rates.ultravoxPerMinute}/min) ` +
    `+ Jev ${formatUsd(cost.jev.usd)} (${cost.jev.calls} checks, ${cost.jev.inputTokens} input tokens at $${cost.rates.jevPerMillionInputTokens}/M)`
  );
}
