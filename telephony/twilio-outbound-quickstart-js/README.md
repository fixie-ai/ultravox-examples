# Ultravox Twilio Outbound Call Quickstart

This Node.js application demonstrates how to make outbound phone calls using Ultravox AI and Twilio. It sets up an AI-powered phone call where the AI agent (named Steve) will interact with the call recipient.

## Prerequisites

- Node.js (v18 or higher)
- An Ultravox API key
- A Twilio account with:
  - Account SID
  - Auth Token
  - A phone number

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
   Open `index.js` and update the following constants with your credentials:

  ```javascript
  // ------------------------------------------------------------
  // Step 1:  Configure Twilio account and destination number
  // ------------------------------------------------------------
  const TWILIO_ACCOUNT_SID = 'your_twilio_account_sid_here';
  const TWILIO_AUTH_TOKEN = 'your_twilio_auth_token_here';
  const TWILIO_PHONE_NUMBER = 'your_twilio_phone_number_here';
  const DESTINATION_PHONE_NUMBER = 'the_destination_phone_number_here';

  // ------------------------------------------------------------
  // Step 2:  Configure Ultravox API key
  //
  // Optional: Modify the system prompt
  // ------------------------------------------------------------
  const ULTRAVOX_API_KEY = 'your_ultravox_api_key_here';
  const SYSTEM_PROMPT = 'Your name is Steve and you are calling a person on the phone. Ask them their name and see how they are doing.';
  ```

## Running the Application

Start the application using either:
  ```bash
  pnpm start
  ```

  or 

  ```bash
  npm start
  ```

The application will:
1. Create an Ultravox call session
1. Initiate a phone call through Twilio
1. Connect the AI agent to the call

## Console Output

When running successfully, you should see something like:
  ```bash
  🚀 Starting Outbound Ultravox Voice AI Phone Call...

  ✅ Configuration validation passed!
  📞 Creating Ultravox call...
  ✅ Got Ultravox joinUrl: wss://prod-voice-pgaenaxiea-uc.a.run.app/calls/ULTRAVOX_CALL_ID/telephony
  📱 Initiating Twilio call...
  🎉 Twilio outbound phone call initiated successfully!
  📋 Twilio Call SID: CA3b...
  📞 Calling +12065551212 from +18005551212
  ```

## Troubleshooting

If you encounter errors:
1. Verify all API keys and credentials are correct
1. Ensure the destination phone number is in a valid format (e.g., +1234567890)
1. Check that your Twilio number is capable of making outbound calls

## Project Structure

- `index.js` - Main application file containing the call logic
- `package.json` - Project dependencies and scripts
- `README.md` - This documentation file