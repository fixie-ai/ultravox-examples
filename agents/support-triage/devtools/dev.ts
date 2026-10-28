import { ChildProcess, spawn } from 'node:child_process';
import { randomBytes } from 'node:crypto';
import { Resolver } from 'node:dns/promises';
import fs from 'node:fs';
import https from 'node:https';
import { bin, install, Tunnel } from 'cloudflared';
import { supportScenario } from '../agent';
import { DEFAULT_AGENT_PREFIX, syncAgents } from '../engine/ultravoxAgents';

// ----------------------------------------------------------------------------- //
// pnpm dev: runs the agent and the developer tools locally.                    //
//   1. the HTTP tool server (the agent's backend)                ← port 8787    //
//   2. a Cloudflare quick tunnel to it, so Ultravox can call the tools          //
//   3. the devtools server (data connection + debugger API)       ← port 8788    //
//   4. a second tunnel to it, for Ultravox's data connection                    //
//   5. pnpm agent:sync with the tools tunnel URL                                //
//   6. the web debugger (Vite)                                                  //
// Quick tunnels need no account; their URLs change on every run, which is why  //
// step 5 updates the saved Ultravox agents each time.                          //
// ----------------------------------------------------------------------------- //

const TOOLS_PORT = Number(process.env.TOOLS_PORT ?? 8787);
const DEVTOOLS_PORT = Number(process.env.DEVTOOLS_PORT ?? 8788);
const children: ChildProcess[] = [];
const tunnels: Tunnel[] = [];

const color = { tools: '\x1b[34m', devtools: '\x1b[35m', web: '\x1b[32m', dev: '\x1b[33m' } as const;
const say = (name: keyof typeof color, text: string) =>
  text
    .split('\n')
    .filter((line) => line.trim())
    .forEach((line) => console.log(`${color[name]}[${name}]\x1b[0m ${line}`));

function start(name: keyof typeof color, args: string[], env: Record<string, string> = {}) {
  const child = spawn('pnpm', ['exec', ...args], { env: { ...process.env, ...env }, stdio: ['ignore', 'pipe', 'pipe'] });
  child.stdout?.on('data', (data) => say(name, String(data)));
  child.stderr?.on('data', (data) => say(name, String(data)));
  child.on('exit', (code) => code && say(name, `exited with code ${code}`));
  children.push(child);
}

/**
 * Opens a quick tunnel and resolves with its URL once cloudflared has connected it. Fails (with cloudflared's
 * recent output) if cloudflared exits, errors or doesn't connect within the timeout.
 */
async function openTunnel(port: number, timeoutMs = 30_000): Promise<string> {
  // 127.0.0.1, not localhost (which can resolve to ::1): the devtools server listens only there.
  const tunnel = Tunnel.quick(`http://127.0.0.1:${port}`);
  tunnels.push(tunnel);
  // cloudflared logs to stderr; keep the tail for the error message.
  let output = '';
  const collect = (data: string) => (output = (output + data).slice(-2000));
  tunnel.on('stderr', collect);
  // Without a listener, a later 'error' would be thrown and skip shutdown.
  tunnel.on('error', (error) => say('dev', `tunnel to :${port}: ${error.message}`));
  const failure = (reason: string) => new Error(`cloudflared tunnel to :${port} ${reason}${output.trim() ? `. cloudflared said:\n${output.trim()}` : ''}`);
  let timer: NodeJS.Timeout | undefined;
  try {
    const [url] = await Promise.race([
      Promise.all([new Promise<string>((resolve) => tunnel.once('url', resolve)), new Promise((resolve) => tunnel.once('connected', resolve))]),
      new Promise<never>((_, reject) => {
        tunnel.once('exit', (code, signal) => reject(failure(`exited (${signal ?? `code ${code}`}) before connecting`)));
        tunnel.once('error', (error) => reject(failure(`failed: ${error.message}`)));
        timer = setTimeout(() => reject(failure(`didn't connect within ${timeoutMs / 1000}s`)), timeoutMs);
      }),
    ]);
    tunnel.on('exit', (code, signal) => say('dev', `tunnel to :${port} closed (${signal ?? `code ${code}`})`));
    return url;
  } finally {
    clearTimeout(timer);
    tunnel.off('stderr', collect);
  }
}

// A new trycloudflare.com hostname takes a few seconds to appear in DNS. If the
// system resolver looks it up too early it caches "not found" for a while, so
// the readiness check resolves through Cloudflare's public DNS and connects to
// that IP directly. (Ultravox resolves the name on its own servers, later.)
const publicDns = new Resolver();
publicDns.setServers(['1.1.1.1', '1.0.0.1']);

function getStatus(url: string, ip: string): Promise<number> {
  return new Promise((resolve, reject) => {
    const request = https.get(url, { lookup: (_host, options, callback) => (options?.all ? callback(null, [{ address: ip, family: 4 }]) : callback(null, ip, 4)), timeout: 5000 }, (response) => {
      response.resume();
      resolve(response.statusCode ?? 0);
    });
    request.on('error', reject);
    request.on('timeout', () => request.destroy(new Error('timeout')));
  });
}

/** Waits until a tunnel URL answers 200. */
async function waitFor(url: string, timeoutMs = 90_000) {
  const deadline = Date.now() + timeoutMs;
  const host = new URL(url).hostname;
  while (Date.now() < deadline) {
    const [ip] = await publicDns.resolve4(host).catch(() => [] as string[]);
    if (ip && (await getStatus(url, ip).catch(() => 0)) === 200) return;
    await new Promise((resolve) => setTimeout(resolve, 1500));
  }
  throw new Error(`${url} didn't respond within ${timeoutMs / 1000}s`);
}

// Stops the children and tunnels however this process exits (a signal, a failure, an uncaught error), so
// nothing is left running and holding the ports.
process.on('exit', () => {
  for (const child of children) child.kill();
  for (const tunnel of tunnels) tunnel.stop();
});
const shutdown = (code = 0) => process.exit(code);
process.on('SIGINT', () => shutdown());
process.on('SIGTERM', () => shutdown());

async function main() {
  const apiKey = process.env.ULTRAVOX_API_KEY;
  if (!apiKey) throw new Error('ULTRAVOX_API_KEY is not set (.env or .env.local).');
  if (!fs.existsSync(bin)) {
    say('dev', 'Installing the cloudflared binary (first run only)…');
    await install(bin);
  }

  // Signs the observer's forced tool calls; shared by the tool server and the devtools server.
  // || so an empty OBSERVER_SECRET= or TOOLS_SECRET= in .env still gets one (empty would turn the check off).
  const observerSecret = process.env.OBSERVER_SECRET || randomBytes(32).toString('base64url');
  // The tool server only answers calls that carry this; the saved agents send it (Ultravox tool authentication).
  const toolsSecret = process.env.TOOLS_SECRET || randomBytes(32).toString('base64url');
  start('tools', ['tsx', 'watch', 'toolServer/index.ts'], {
    TOOLS_PORT: String(TOOLS_PORT),
    OBSERVER_SECRET: observerSecret,
    TOOLS_SECRET: toolsSecret,
  });
  say('dev', 'Opening Cloudflare quick tunnels…');
  const [toolsUrl, devtoolsUrl] = await Promise.all([openTunnel(TOOLS_PORT), openTunnel(DEVTOOLS_PORT)]);
  start('devtools', ['tsx', 'watch', 'devtools/server/index.ts'], {
    DEVTOOLS_PORT: String(DEVTOOLS_PORT),
    DEVTOOLS_PUBLIC_URL: devtoolsUrl,
    TOOLS_PUBLIC_URL: toolsUrl,
    OBSERVER_SECRET: observerSecret,
    // For the agents it syncs on first use (it restarts when agent/ changes, so prompt edits take effect).
    TOOLS_SECRET: toolsSecret,
  });

  // The devtools API refuses requests through its tunnel, so check the public /health.
  await Promise.all([waitFor(`${toolsUrl}/health`), waitFor(`${devtoolsUrl}/health`)]);
  say('dev', `Tools:    ${toolsUrl}`);
  say('dev', `Devtools: ${devtoolsUrl}`);

  const agents = await syncAgents({
    apiKey,
    scenario: supportScenario,
    toolsBaseUrl: toolsUrl,
    toolsSecret,
    prefix: process.env.AGENT_NAME ?? DEFAULT_AGENT_PREFIX,
  });
  for (const agent of agents) say('dev', `Ultravox agent ${agent.name} → ${agent.agentId}`);

  start('web', ['vite']);
}

main().catch((error) => {
  say('dev', `Failed: ${error instanceof Error ? error.message : String(error)}`);
  shutdown(1);
});
