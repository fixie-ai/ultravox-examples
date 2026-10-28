import type { Server } from 'node:http';
import { serve } from '@hono/node-server';
import { decisionConfigFromEnv } from '../../engine/decision/config';
import { createDecideFn } from '../../engine/decision/providers';
import { supportScenario } from '../../agent';
import { DEFAULT_AGENT_PREFIX } from '../../engine/ultravoxAgents';
import { createDevtools } from './app';

// Starts the devtools server. pnpm dev sets DEVTOOLS_PUBLIC_URL and TOOLS_PUBLIC_URL to the tunnel URLs,
// and OBSERVER_SECRET (shared with the tool server) for the observer.
const apiKey = process.env.ULTRAVOX_API_KEY;
const publicUrl = process.env.DEVTOOLS_PUBLIC_URL;
if (!apiKey) throw new Error('ULTRAVOX_API_KEY is not set.');
if (!publicUrl) throw new Error('DEVTOOLS_PUBLIC_URL is not set (the public https URL Ultravox can reach this server at).');

// The data-connection observer runs here, so this server also talks to the decision model.
const { decide } = createDecideFn(process.env);

const port = Number(process.env.DEVTOOLS_PORT ?? 8788);
const devtools = createDevtools({
  ultravoxApiKey: apiKey,
  publicUrl,
  toolsPublicUrl: process.env.TOOLS_PUBLIC_URL,
  toolsSecret: process.env.TOOLS_SECRET,
  agentPrefix: process.env.AGENT_NAME ?? DEFAULT_AGENT_PREFIX,
  scenario: supportScenario,
  decide,
  config: decisionConfigFromEnv(process.env),
  observerSecret: process.env.OBSERVER_SECRET,
});
// Only on this machine's loopback: /api and /events trust local requests. (Not 'localhost', which can be ::1.)
const server = serve({ fetch: devtools.app.fetch, port, hostname: '127.0.0.1' }, () => {
  console.log(`Devtools server on http://127.0.0.1:${port} (public: ${publicUrl})`);
}) as Server;
devtools.attach(server);
