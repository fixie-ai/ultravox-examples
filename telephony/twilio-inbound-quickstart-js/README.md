# Ultravox Twilio Inbound Call Quickstart

This Node.js application demonstrates how to handle inbound calls using Twilio and connect them to an Ultravox AI agent. When someone calls your Twilio number, they'll be connected to an AI agent that will interact with them.

## Prerequisites

- Node.js (v18 or higher)
- An Ultravox API key
- A Twilio account with:
  - Account SID
  - Auth Token
  - A phone number
- A way to expose your local server to the internet (e.g., ngrok)

## Setup

1. Clone this repository
1. Install dependencies:
   ```bash
   pnpm install
   ```
   or
   ```bash
   npm install
   ```

1. Configure your environment:
   Open `index.js` and update the following constant:

   ```javascript
   // ------------------------------------------------------------
   // Step 1:  Configure Ultravox API key
   //
   // Optional:  Modify the system prompt
   // ------------------------------------------------------------
   const ULTRAVOX_API_KEY = 'your_ultravox_api_key_here';
   const SYSTEM_PROMPT = 'Your name is Steve. You are receiving a phone call. Ask them their name and see how they are doing.';
   ```

1. Start your server:
   ```bash
   pnpm start
   ```
   or
   ```bash
   npm start
   ```

1. Expose your local server:
   Use ngrok or similar to create a public URL:
   ```bash
   ngrok http 3000
   ```

1. Configure your Twilio webhook:
   - Go to your Twilio phone number settings
   - Set the webhook URL for incoming calls to:
     `https://your-ngrok-url/incoming`
   - Make sure the HTTP method is set to POST

## Testing

1. Call your Twilio phone number
1. You should be connected to the AI agent
1. Check your server console for logs

## Console Output

When the server starts up, you should see:
   ```bash
   🚀 Starting Inbound Ultravox Voice AI Phone Server...

   ✅ Configuration validation passed!
   🎉 Server running successfully on port 3000
   📞 Ready to handle incoming calls at POST /incoming
   🌐 Webhook URL: http://your-server:3000/incoming

   💡 Setup reminder:
      • Configure your Twilio phone number webhook to point to this server
      • Make sure this server is accessible from the internet (consider using ngrok for testing)
   ```

When receiving a call, you should see:

   ```bash
   📞 Incoming call received
   ✅ Configuration validation passed!
   🤖 Creating Ultravox call...
   ✅ Got Ultravox joinUrl: wss://prod-voice-pgaenaxiea-uc.a.run.app/calls/ULTRAVOX_CALL_ID/telephony
   📋 Sending TwiML response to Twilio
   ```

## Troubleshooting

If calls aren't connecting:
1. Verify your Ultravox API key is correct
1. Check that your ngrok URL is properly set as the incoming call webhook address in Twilio
1. Ensure your server is running and accessible
1. Check the server logs for any errors
1. Verify Twilio is sending webhooks (check Twilio console logs)

## Project Structure

- `index.js` - Main server file containing the webhook handler
- `package.json` - Project dependencies and scripts
- `README.md` - This documentation file