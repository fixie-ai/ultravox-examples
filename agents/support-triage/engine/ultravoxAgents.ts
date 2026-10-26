import { buildCallTemplate } from './ultravoxTools';
import { AnyScenario } from './types';

// ----------------------------------------------------------------------------- //
// The agent on Ultravox                                                         //
// ----------------------------------------------------------------------------- //
// Saves the scenario as an Ultravox agent (one per model), with every tool      //
// pointing at your HTTP tool server. Calls are then created from the agent      //
// (POST /api/agents/{id}/calls) by your app, a phone number, or the dev tools.  //
//   pnpm agent:sync -- --tools-url https://tools.example.com                    //
// ----------------------------------------------------------------------------- //

const API = 'https://api.ultravox.ai/api';

/** Saved agents are named `<prefix>[-<model>]`; set AGENT_NAME to change the prefix. */
export const DEFAULT_AGENT_PREFIX = 'acme-support-triage';

export interface SavedAgent {
  agentId: string;
  name: string;
  model?: string;
}

/**
 * The Ultravox agent name for a model: "acme-support-triage" for Ultravox's default model, or
 * "acme-support-triage-ultravox-v0-7" for another. (A call created from an agent can't override its model, so
 * each model is its own agent.)
 */
export function agentName(prefix: string, model?: string): string {
  const suffix = model ? `-${model.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '')}` : '';
  return `${prefix}${suffix}`;
}

async function ultravox<T>(apiKey: string, method: string, path: string, body?: unknown): Promise<T> {
  const response = await fetch(`${API}${path}`, {
    method,
    headers: { 'X-API-Key': apiKey, 'Content-Type': 'application/json' },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const text = await response.text();
  if (!response.ok) throw new Error(`Ultravox ${method} ${path} returned ${response.status}: ${text}`);
  return (text ? JSON.parse(text) : undefined) as T;
}

type AgentSummary = { agentId: string; name: string };

/** Saved agents whose names contain `search` (the first 100, which is plenty for one example's agents). */
async function searchAgents(apiKey: string, search: string): Promise<AgentSummary[]> {
  const page = await ultravox<{ results: AgentSummary[] }>(apiKey, 'GET', `/agents?search=${encodeURIComponent(search)}&pageSize=100`);
  return page.results;
}

/** Finds a saved agent by exact name. */
export async function findAgent(apiKey: string, name: string): Promise<AgentSummary | undefined> {
  return (await searchAgents(apiKey, name)).find((agent) => agent.name === name);
}

/** Creates or updates one Ultravox agent per model, pointing at the tool server. */
export async function syncAgents(options: {
  apiKey: string;
  scenario: AnyScenario;
  toolsBaseUrl: string;
  /** The tool server's TOOLS_SECRET, which Ultravox then sends with every tool call. */
  toolsSecret?: string;
  prefix: string;
  /** Ultravox models; undefined is Ultravox's default. */
  models?: (string | undefined)[];
}): Promise<SavedAgent[]> {
  // Every agent's name starts with the prefix, so one search finds the existing ones. If a name is duplicated,
  // use the first match, as findAgent does, so both always pick the same agent.
  const existing = new Map<string, string>();
  for (const agent of await searchAgents(options.apiKey, options.prefix)) {
    if (!existing.has(agent.name)) existing.set(agent.name, agent.agentId);
  }
  return Promise.all(
    (options.models ?? [undefined]).map(async (model) => {
      const server = { baseUrl: options.toolsBaseUrl, secret: options.toolsSecret };
      const callTemplate = buildCallTemplate(options.scenario, server, { model });
      const name = agentName(options.prefix, model);
      const agentId = existing.get(name);
      const agent = agentId
        ? await ultravox<{ agentId: string }>(options.apiKey, 'PATCH', `/agents/${agentId}`, { name, callTemplate })
        : await ultravox<{ agentId: string }>(options.apiKey, 'POST', '/agents', { name, callTemplate });
      return { agentId: agent.agentId, name, model };
    })
  );
}

/** Ultravox's generation models available to this account. */
export async function listModels(apiKey: string): Promise<string[]> {
  const page = await ultravox<{ results: { name: string }[] }>(apiKey, 'GET', '/models');
  return page.results.map((model) => model.name);
}

/** Creates a call from a saved agent. `overrides` can add a medium, a data connection, etc. */
export async function createAgentCall(
  apiKey: string,
  agentId: string,
  overrides: Record<string, unknown> = {}
): Promise<{ callId: string; joinUrl: string }> {
  return ultravox(apiKey, 'POST', `/agents/${agentId}/calls`, overrides);
}

export async function getCall(apiKey: string, callId: string): Promise<Record<string, unknown>> {
  return ultravox(apiKey, 'GET', `/calls/${encodeURIComponent(callId)}`);
}
