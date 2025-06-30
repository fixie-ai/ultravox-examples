# Twilio Call Transfer with Ultravox

This TypeScript application demonstrates how to make AI-powered outbound phone calls using Ultravox with Twilio, including advanced call transfer capabilities with whisper functionality.

## Features

- **Call transfers**: AI agent can transfer calls to human agents with context
- **Whisper transfers**: Optionally, include call summary to human before completing transfer
- **Webhook handling**: Twilio-specific webhook endpoints for call events

## Prerequisites

- Node.js (v20 or higher)
- An Ultravox API key
- Twilio Account SID, Auth Token, and phone number
- ngrok or similar tunneling service (required for local development)

## Project Structure

```
├── src/
│   ├── index.ts              # Main application entry point
│   ├── apiServer.ts          # Express server for API endpoints and webhooks
│   ├── callManager.ts        # Call registration and transfer logic
│   ├── twilioClient.ts       # Twilio API integration
│   ├── ultravox.ts           # Ultravox API integration and tool configuration
│   ├── webhooks.ts           # Twilio webhook handlers
│   └── types.ts              # TypeScript type definitions
├── package.json              # Dependencies and scripts
├── tsconfig.json             # TypeScript configuration
└── README.md                 # This file
```

## Setup

1. **Clone and install dependencies:**
```bash
cd twilio-call-transfer-ts
pnpm install
```

2. **Configure environment variables:**
Create a `.env` file with the following variables:

```bash
# Ultravox Configuration
ULTRAVOX_API_KEY=your_ultravox_api_key_here

# Twilio Configuration
TWILIO_ACCOUNT_SID=your_twilio_account_sid_here
TWILIO_AUTH_TOKEN=your_twilio_auth_token_here
TWILIO_PHONE_NUMBER=your_twilio_phone_number_here

# Call Configuration
OUTBOUND_PHONE_NUMBER=+1234567890          # Number to call
DESTINATION_PHONE_NUMBER=+1987654321       # Transfer destination

# Server Configuration
API_PORT=3000
SERVICE_API_KEY=your_internal_api_key_here
NGROK_URL=https://your-ngrok-url.ngrok.io
```

3. **Set up ngrok:**
```bash
# In a separate terminal
ngrok http 3000

# Copy the HTTPS URL to your .env file as NGROK_URL
```

4. **Build and run:**
```bash
pnpm run build
pnpm start

# Or for development with auto-reload
pnpm run dev
```

## How It Works

### Call Flow
1. **Server Startup**: Express server starts with API endpoints and webhook handlers
2. **Ultravox Call Creation**: Creates an Ultravox voice AI call with transfer tool configuration
3. **Outbound Call**: Initiates call through Twilio to the specified number
4. **Audio Streaming**: Connects bidirectional audio between Twilio and Ultravox
5. **Voice AI Interaction**: Steve (the AI agent) converses with the call recipient
6. **Transfer Capability**: AI agent can transfer calls using the configured `transferCall` tool

### Transfer Implementation

The application implements two transfer types:

**Regular Transfer:**
- Direct transfer to destination number using TwiML `<Dial>`
- Immediate connection without human agent interaction

**Whisper Transfer (when `useWhisper: true`):**
- Creates a conference room for the transfer
- Calls the human agent first with context message
- Agent can hear transfer details before connecting to caller
- Seamless three-way connection management

### Tool Configuration

The AI agent is equipped with a `transferCall` tool that includes:
- **Automatic parameters**: Call ID from the active session
- **Static parameters**: Destination number and whisper setting
- **Dynamic parameters**: Caller's first name, last name, and transfer reason

## API Endpoints

### Health Check
```
GET /api/health
```

### Call Details
```
GET /api/calls/:callId
Headers: X-API-Key: your_service_api_key
```

### Debug Active Calls
```
GET /api/debug/calls  
Headers: X-API-Key: your_service_api_key
```

### Transfer Call
```
POST /api/transfer
Headers: X-API-Key: your_service_api_key
Content-Type: application/json

{
  "ultravoxCallId": "call_123",
  "destinationNumber": "+15551234567",
  "firstName": "John",
  "lastName": "Doe", 
  "transferReason": "Technical support needed",
  "useWhisper": true
}
```

### Twilio Webhooks
- **Status Updates**: `/status` - Handles call status changes
- **Stream Events**: `/stream-events` - Processes audio streaming events

## Customization

### Modify AI Behavior
Edit the `SYSTEM_PROMPT` in `src/ultravox.ts`:
```typescript
const SYSTEM_PROMPT = 'Your custom AI assistant prompt here...';
```

### Configure Transfer Tool
Modify the tool configuration in `getAgentTools()` function in `src/ultravox.ts` to change:
- Tool description and behavior
- Required parameters
- Transfer endpoint URL
- Authentication requirements

### Add New API Endpoints
Extend `src/apiServer.ts` to add new REST endpoints for additional functionality.

## Console Output

Successful startup shows:
```
Creating Ultravox call with Twilio as medium...
Sending request payload: {"systemPrompt":"Your name is Steve..."
API Server listening on port 3000
Public URL: https://<your_ngrok_url>
Twilio Status: https://<your_ngrok_url>/status
Twilio Streams: https://<your_ngrok_url>/stream-events
Ultravox API response status: 201 Created
Complete response data: {"callId":"c474c5be-..."
API request succeeded
Ultravox call created: c474c5be-242d-...
Got joinUrl: wss://prod-voice-pgaenaxiea-uc.a.run.app/calls/c474c5be-...telephony
Using Twilio webhook URLs:
- Status: https://<your_ngrok_url>/status
- Stream Events: https://<your_ngrok_url>/stream-events
Call initiated with Twilio: CAe0...
Call registered: c474c5be-... -> CAe0... (Twilio)
Call registered in the system.
```

## Troubleshooting

**Common Issues:**

1. **Environment Variables**: Ensure all required variables are set in `.env`
2. **API Key Errors**: Verify Twilio and Ultravox credentials are valid
3. **Phone Number Format**: Ensure numbers are in E.164 format (+1234567890)
4. **ngrok URL**: Confirm NGROK_URL matches your tunnel URL exactly
5. **Webhook Access**: Test that Twilio can reach your webhook endpoints

**Debug Steps:**
1. Check `/api/health` endpoint: `curl http://localhost:3000/api/health`
2. Verify ngrok tunnel: `curl https://your-url.ngrok.io/api/health`
3. Test Twilio credentials in their console
4. Review server logs for specific error messages
5. Check active calls: `GET /api/debug/calls` with proper API key

## Security Considerations

**For Production Use:**
- Implement Twilio webhook signature validation
- Use secure database instead of in-memory call storage
- Add rate limiting to prevent API abuse
- Use HTTPS for all connections
- Validate and sanitize all input data
- Implement proper error handling and logging
