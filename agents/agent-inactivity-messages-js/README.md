# Inactivity Messages Demo

A minimal example showing how to create an Ultravox voice AI agent that uses inactivity messages to prompt for end user input and then wrap up the call if no response.

## Quick Start

1. **Get your API key** from the [Ultravox Console](https://app.ultravox.ai/settings)
1. **Set your API key** in the code:
   ```javascript
   const ULTRAVOX_API_KEY = 'your_api_key_here';
   ```
1. **Run the script**:
   ```bash
   node create-agent.js
   ```

That's it! You'll have a new voice AI agent ready with inactivity messages in place.

## Requirements

- **Node.js 18+** (for native fetch support)

## Error Handling

If you get an error:

- **403 Forbidden**: Check your API key
- **400 Bad Request**: Check to see if an agent with the same name already exists (try a different name)