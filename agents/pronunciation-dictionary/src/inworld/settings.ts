import { optionalEnv, requireEnv } from "../env.ts";
import { InworldClient } from "./client.ts";

/** Inworld settings shared by the scripts, read from the environment or .env. */
export function inworldSettings() {
  return {
    client: new InworldClient({
      apiKey: requireEnv("INWORLD_API_KEY"),
      workspace: requireEnv("INWORLD_WORKSPACE"),
      baseUrl: optionalEnv("INWORLD_BASE_URL", "https://api.inworld.ai"),
    }),
    /** The scripts find "their" dictionary by this display name. */
    dictionaryDisplayName: optionalEnv("INWORLD_DICTIONARY_DISPLAY_NAME", "Pronunciation dictionary example"),
    voiceId: optionalEnv("INWORLD_VOICE_ID", "Sarah"),
    /** Pronunciation dictionaries apply to TTS 2 models only. */
    modelId: optionalEnv("INWORLD_MODEL_ID", "inworld-tts-2"),
    language: optionalEnv("INWORLD_LANGUAGE", "en-US"),
  };
}
