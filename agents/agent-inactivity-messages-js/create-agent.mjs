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
    name: 'Ultravox-Demo-Agent-Inactivity-Messages',
    callTemplate: {
      systemPrompt: "You're a friendly and fun ai agent. You like to chat casually.",
      temperature: 0.4,
      inactivityMessages: [
        {
          "duration": "30s",
          "message": "Are you still there?"
        },
        {
          "duration": "15s",
          "message": "If there's nothing else, may I end the call?"
        },
        {
          "duration": "10s",
          "message": "Thank you for calling. Have a great day. Goodbye.",
          "endBehavior": "END_BEHAVIOR_HANG_UP_SOFT"
        }
      ]
    }
  })
});

if (!createAgentResponse.ok) {
  throw new Error(`Failed to create agent (${createAgentResponse.status}): ${await createAgentResponse.text()}`);
}

const newAgent = (await createAgentResponse.json());
console.info(`Created new agent named ${newAgent.name} with agentId ${newAgent.agentId}...`);