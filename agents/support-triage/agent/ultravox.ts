import type { UltravoxSettings } from '../engine/types';

// How the agent is set up on Ultravox. pnpm dev (or pnpm agent:sync) saves it; your tools (tools.ts) and the state
// machine's updateState tool are added for you. See the Ultravox call template docs for other settings.

export const ultravox: UltravoxSettings = {
  voice: 'Mark (Inworld)',
  firstSpeaker: 'agent',
  // model: 'ultravox-v0.7',   // Ultravox's default model unless you set one
  builtInTools: [
    { toolName: 'hangUp' },
    // A real knowledge base: an Ultravox corpus (see "Using a real knowledge base" in the README).
    // { toolName: 'queryCorpus', parameterOverrides: { corpus_id: '<your corpus id>' } },
  ],
  // callTemplate: { languageHint: 'en' },   // any other call template settings
};
