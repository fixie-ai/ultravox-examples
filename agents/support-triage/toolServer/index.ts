import { serve } from '@hono/node-server';
import { decisionConfigFromEnv } from '../engine/decision/config';
import { createDecideFn } from '../engine/decision/providers';
import { supportScenario } from '../agent';
import { createToolServer } from './app';

// Starts the HTTP tool server. Settings come from the environment
// (pnpm dev loads .env and .env.local): INWORLD_API_KEY, DECISION_PROVIDER,
// DECISION_MODEL, DECISION_ACCEPT, DECISION_FLOOR, DECISION_TIMEOUT_MS,
// DECISION_CHECK, TOOLS_PORT, TOOLS_SECRET.

const scenario = supportScenario;
const { decide, providerName } = createDecideFn(process.env);
const port = Number(process.env.TOOLS_PORT ?? 8787);
const app = createToolServer({
  scenario,
  decide,
  config: decisionConfigFromEnv(process.env),
  // Ultravox sends it with every tool call once the agent is synced with the same TOOLS_SECRET.
  secret: process.env.TOOLS_SECRET,
  // Shared with whatever runs the observer; pnpm dev generates one per run.
  observerSecret: process.env.OBSERVER_SECRET,
  // How the agent reacts after a call the observer forced; speaks-once by default (see handlers.ts).
  observerReaction:
    process.env.OBSERVER_REACTION === 'speaks' || process.env.OBSERVER_REACTION === 'listens' ? process.env.OBSERVER_REACTION : 'speaks-once',
});

if (!process.env.TOOLS_SECRET) console.warn('TOOLS_SECRET is not set: anyone who has this server\'s URL can call its tools.');
serve({ fetch: app.fetch, port }, () => {
  console.log(`Tool server on http://localhost:${port} (scenario: ${scenario.id}, decision provider: ${providerName})`);
});
