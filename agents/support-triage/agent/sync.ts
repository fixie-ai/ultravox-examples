import { supportScenario } from '.';
import { DEFAULT_AGENT_PREFIX, syncAgents } from '../engine/ultravoxAgents';

// Saves the agent on Ultravox, pointing its tools at your tool server:
//   pnpm agent:sync -- --tools-url https://tools.example.com
// Set TOOLS_SECRET to the tool server's, so Ultravox sends it with every tool call.
// (pnpm dev runs this automatically with the tunnel URL.)

const argIndex = process.argv.indexOf('--tools-url');
const toolsBaseUrl = argIndex > -1 ? process.argv[argIndex + 1] : process.env.TOOLS_PUBLIC_URL;
if (!toolsBaseUrl) throw new Error('Pass --tools-url https://… (the public URL of your tool server) or set TOOLS_PUBLIC_URL.');
if (!process.env.ULTRAVOX_API_KEY) throw new Error('ULTRAVOX_API_KEY is not set.');
if (!process.env.TOOLS_SECRET) {
  // A tool server with a secret refuses every call from these agents. (pnpm dev syncs its own agents with its own.)
  console.warn('TOOLS_SECRET is not set: the agents will call the tool server without one.');
}

const agents = await syncAgents({
  apiKey: process.env.ULTRAVOX_API_KEY,
  scenario: supportScenario,
  toolsBaseUrl,
  toolsSecret: process.env.TOOLS_SECRET,
  prefix: process.env.AGENT_NAME ?? DEFAULT_AGENT_PREFIX,
});
for (const agent of agents) console.log(`${agent.name}: ${agent.agentId}`);
