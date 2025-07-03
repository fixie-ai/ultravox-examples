//--------------------------------------------------------//
// Step 0: Set Ultravox API Key
//--------------------------------------------------------//
const ULTRAVOX_API_KEY = undefined;

//--------------------------------------------------------//
// Step 1: Create Demo Agent
//--------------------------------------------------------//
console.info('Creating agent...');
const createAgentResponse = await fetch('https://api.ultravox.ai/api/agents', {
  method: 'POST',
  headers: {
    'X-API-Key': ULTRAVOX_API_KEY,
    'Content-Type': 'application/json'
  },
  body: JSON.stringify({
    name: 'Ultravox_Demo_Agent',
    callTemplate: {
      voice: 'Jessica',
      systemPrompt: "You're a friendly and fun gal. You like to chat casually.",
      temperature: 0.4,
    }
  })
});

if (!createAgentResponse.ok) {
  throw new Error(`Failed to create agent (${createAgentResponse.status}): ${await createAgentResponse.text()}`);
}

const newAgent = (await createAgentResponse.json());
console.info(`Created new agent named ${newAgent.name} with agentId ${newAgent.agentId}...`);