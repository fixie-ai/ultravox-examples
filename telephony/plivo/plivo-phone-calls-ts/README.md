# Plivo Phone Calls

This TypeScript project demonstrates how to make outbound and receive inbound phone calls using Plivo and Ultravox Realtime.

## Setup

1. **Clone and install:**
   ```bash
   git clone <your-repo>
   cd plivo-phone-calls-ts
   pnpm install
   ```

2. **Configure environment:**
   Copy the example environment file in a new `.env` file and fill in your credentials:
   ```bash
   cp .env.example .env
   ```
   
   Edit `.env` with your actual values:
   ```bash
   # Ultravox Configuration
   ULTRAVOX_API_KEY=your_actual_ultravox_api_key
   
   # Plivo Configuration
   PLIVO_AUTH_ID=your_actual_plivo_auth_id
   PLIVO_AUTH_TOKEN=your_actual_plivo_auth_token
   PLIVO_PHONE_NUMBER=+1234567890
   
   # Call Configuration
   DESTINATION_PHONE_NUMBER=+1987654321
   
   # Server Configuration
   PORT=3000
   WEBHOOK_BASE_URL=https://your-ngrok-url.ngrok.io
   ```

3. **Expose your local server:**
   In a separate terminal, start ngrok:
   ```bash
   ngrok http 3000
   ```
   
   Copy the HTTPS URL (e.g., `https://abc123.ngrok.io`) and update `WEBHOOK_BASE_URL` in your `.env` file.

4. **Configure Plivo webhooks:**
   In your Plivo console:
   - Go to your phone number settings
   - Set the "Answer URL" to: `https://your-ngrok-url.ngrok.io/inbound`
   - Set the HTTP method to `POST`

## Usage

### For Inbound Calls

1. **Start the server:**
   ```bash
   pnpm start
   ```

2. **Call your Plivo number:**
Anyone can now call your Plivo phone number and be connected to the agent.

### For Outbound Calls

1. **Start the server** (in one terminal):
   ```bash
   pnpm start
   ```

2. **Make outbound calls** (in another terminal):
   ```bash
   # Call the default number from .env
   pnpm call
   
   # Or call a specific number
   pnpm call +15551234567
   ```

## Agent Configuration

A sample agent named `sample-plivo-phone-calls-ts` will automatically be created when you run this code and will have these settings:
- Voice: Jessica
- System prompt: "You're a friendly and fun gal. You like to chat casually."
- Temperature: 0.4

If the agent doesn't exist, it will be created automatically on the first call. The agent will be used for all inbound and outbound calls.

To learn more about agents in Ultravox, check out the docs:

[Agents Overview →](https://docs.ultravox.ai/agents/overview)



## API Endpoints

- `POST /inbound` - Webhook for incoming calls from Plivo
- `POST /outbound` - Trigger an outbound call
- `POST /connect` - Connect calls to Ultravox agent

