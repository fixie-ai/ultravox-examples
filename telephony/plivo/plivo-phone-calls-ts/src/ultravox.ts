import { config } from 'dotenv';
config();

const ULTRAVOX_API_KEY = process.env.ULTRAVOX_API_KEY || '';

export async function createAgentCall() {
  // Find or create the demo agent
  let agentId;
  
  // Try to find existing agent
  const listResponse = await fetch('https://api.ultravox.ai/api/agents', {
    headers: { 'X-API-Key': ULTRAVOX_API_KEY }
  });

  if (listResponse.ok) {
    const { results } = await listResponse.json();
    const existingAgent = results.find((agent: any) => agent.name === 'sample-plivo-phone-calls-ts');
    if (existingAgent) {
      agentId = existingAgent.agentId;
    }
  }

  // Create agent if not found
  if (!agentId) {
    const createResponse = await fetch('https://api.ultravox.ai/api/agents', {
      method: 'POST',
      headers: {
        'X-API-Key': ULTRAVOX_API_KEY,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        name: 'sample-plivo-phone-calls-ts',
        callTemplate: {
          voice: 'Jessica',
          systemPrompt: "You're a friendly and fun gal. You like to chat casually.",
          temperature: 0.4,
        }
      })
    });

    if (!createResponse.ok) {
      throw new Error(`Failed to create agent: ${await createResponse.text()}`);
    }

    const newAgent = await createResponse.json();
    agentId = newAgent.agentId;
  }

  // Create the call
  const callResponse = await fetch(`https://api.ultravox.ai/api/agents/${agentId}/calls`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'X-API-Key': ULTRAVOX_API_KEY
    },
    body: JSON.stringify({ medium: { plivo: {} } })
  });

  if (!callResponse.ok) {
    throw new Error(`Failed to create call: ${await callResponse.text()}`);
  }

  return await callResponse.json();
}