# Demo Agent (Node.js)

Official Ultravox demo agent example in Node.js. This example demonstrates how to create and manage a voice AI agent using the Ultravox API.

## Quick Start

### 1. Install Dependencies
```bash
pnpm install
```
or
```bash
npm install
```

### 2. Configure Environment

Copy the example environment file to a `.env` file and add your API key:

```bash
cp .env.example .env
```

Edit `.env` and add your Ultravox API key:

```env
ULTRAVOX_API_KEY=your_actual_api_key_here
```

### 3. Create the Demo Agent
```bash
pnpm run create-agent
```
or
```bash
npm run create-agent
```

### 4. Verify Creation
```bash
pnpm run check-agent
```
or
```bash
npm run check-agent
```

## Usage

### Available Commands

| Command | Description |
|---------|-------------|
| `pnpm run create-agent` | Create the demo agent (idempotent) |
| `pnpm run check-agent` | Check agent status and display details |
| `pnpm start` | Interactive CLI interface |

### Environment Variables

| Variable | Required | Default | Description |
|----------|----------|---------|-------------|
| `ULTRAVOX_API_KEY` | ✅ Yes | - | Your Ultravox API key |
| `LOG_LEVEL` | No | `info` | Logging level (error, warn, info, debug) |

## Configuration

The demo agent's properties are defined in `config/demo-agent.js`. Key configurations include:

### Agent Properties
- **Name**: "Ultravox_Demo_Agent"
- **Voice**: Jessica
- **Recording**: Enabled

### Conversation Settings
- **First Speaker**: Agent (starts with a greeting)
- **Temperature**: 0.4

## Customization

### Modifying Agent Behavior

Edit `config/demo-agent.js` to customize:

- System prompt and personality
- Voice settings and model
- Conversation timing and flow
- Inactivity messages
- Recording preferences

See the [Create Agent API](https://docs.ultravox.ai/api-reference/agents/agents-post) for details on what can be configured in the agent `callTemplate`.

### Adding New Features

The modular structure makes it easy to extend:

- Add new commands in `src/index.js`
- Extend the API client in `src/ultravox-client.js`
- Add new configuration options in `config/demo-agent.js`

## Development

### Running in Development Mode
```bash
pnpm run dev
```
or
```bash
npm run dev
```

This uses Node's `--watch` flag for automatic reloading during development.

### Logging Levels

Set different logging levels for debugging:

```bash
LOG_LEVEL=debug npm run create-agent
```

Available levels: `error`, `warn`, `info`, `debug`