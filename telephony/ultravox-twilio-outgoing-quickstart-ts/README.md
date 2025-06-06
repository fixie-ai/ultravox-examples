# Ultravox Twilio Outgoing Call Quickstart

This TypeScript application demonstrates how to make outgoing phone calls using Ultravox AI and Twilio. It sets up an AI-powered phone call where the AI agent (named Steve) will interact with the call recipient.

## Prerequisites

- Node.js (v20 or higher)
- An Ultravox API key
- A Twilio account with:
  - Account SID
  - Auth Token
  - A phone number

## Quick Setup

1. **Clone the repository:**
```bash
git clone https://github.com/yourusername/ultravox-twilio-quickstart.git
cd ultravox-twilio-quickstart
```

2. **Install dependencies:**
```bash
pnpm install
```

3. **Configure your environment:**
   Copy `.env.example` to `.env` and update with your credentials:
```bash
cp .env.example .env
```

Edit `.env`:
```env
ULTRAVOX_API_KEY=your_ultravox_api_key_here
TWILIO_ACCOUNT_SID=your_twilio_account_sid_here
TWILIO_AUTH_TOKEN=your_twilio_auth_token_here
TWILIO_PHONE_NUMBER=your_twilio_phone_number_here
DESTINATION_PHONE_NUMBER=the_destination_phone_number_here
```

4. **Run the application:**
```bash
pnpm start
```

## What It Does

The application will:
1. Create an Ultravox voice AI call
2. Initiate a phone call through Twilio to your destination number
3. Connect the AI agent (Steve) to the call
4. The AI will introduce itself and start a conversation

## Console Output

When running successfully, you should see:
```
🚀 Creating Ultravox call...
✅ Got joinUrl: https://...
📞 Call initiated: CA1234...
🎉 Success! Ultravox voice AI call in progress
```

## Customization

**Modify the AI personality** by changing the `SYSTEM_PROMPT` in your `.env`:
```env
SYSTEM_PROMPT=Your name is Sarah and you're calling to schedule a doctor's appointment.
```

**Change AI voice** by editing `src/index.ts` and updating the `voice` property (options: Mark, Jessica, Carolina-Spanish, etc.)

## Try Online

[**🚀 Open in CodeSandbox**](https://codesandbox.io/s/github/fixie-ai/ultravox-examples/tree/main/telephony/ultravox-twilio-outgoing-quickstart-ts) - Test the code without setting up locally!

## Troubleshooting

**Common Issues:**
- ❌ `Missing required environment variable` → Check your `.env` file
- ❌ `Twilio Error 21211` → Phone number format should be +1234567890
- ❌ `Authentication failed` → Verify your Twilio Account SID and Auth Token
- ❌ `Ultravox API Error` → Check your Ultravox API key

**Phone Number Format:**
- ✅ Correct: `+12345678901`
- ❌ Wrong: `(234) 567-8901` or `234-567-8901`

## Project Structure

```
├── src/
│   └── index.ts          # Main application (TypeScript)
├── package.json          # Dependencies and scripts
├── .env.example         # Environment template
├── .env                 # Your credentials (not in git)
└── README.md           # This file
```

## Development

- **Development mode:** `pnpm run dev` (auto-restart on changes)
- **Build:** `pnpm run build`
- **Production:** `pnpm start`

## API Documentation

- [Ultravox API Docs](https://docs.ultravox.ai)
- [Twilio API Docs](https://www.twilio.com/docs/voice)