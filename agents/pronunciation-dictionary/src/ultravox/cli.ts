/**
 * Adds an Ultravox voice that speaks with an Inworld TTS 2 voice and one or
 * more Inworld pronunciation dictionaries.
 *
 *   npm run ultravox -- create-voice                         # this example's dictionary
 *   npm run ultravox -- create-voice --dictionary <id>       # a specific dictionary
 *   npm run ultravox -- create-voice --dictionary <id> --dictionary <id2> --name my-voice
 *
 * Re-running with the same voice name updates that voice instead of adding another.
 */
import { parseArgs } from "node:util";

import { optionalEnv, requireEnv } from "../env.ts";
import { ApiError, requestJson } from "../http.ts";
import { inworldSettings } from "../inworld/settings.ts";
import type {
  AccountTtsKeys,
  PaginatedVoiceList,
  SetTtsApiKeysRequest,
  Voice,
  VoiceWrite,
} from "./types.ts";

/** Ultravox accepts up to three dictionaries per voice, in priority order. */
const MAX_DICTIONARIES = 3;
const VOICE_NAME_PATTERN = /^[a-zA-Z0-9_-]{1,64}$/;

const inworld = inworldSettings();
const config = {
  inworldApiKey: requireEnv("INWORLD_API_KEY"),
  apiKey: requireEnv("ULTRAVOX_API_KEY"),
  baseUrl: optionalEnv("ULTRAVOX_BASE_URL", "https://api.ultravox.ai"),
  voiceName: optionalEnv("ULTRAVOX_VOICE_NAME", "sarah-pronunciation-example"),
  setInworldKey: optionalEnv("ULTRAVOX_SET_INWORLD_KEY", "false").toLowerCase() === "true",
};

const ultravox = <T>(method: string, pathOrUrl: string, body?: unknown): Promise<T> =>
  requestJson<T>(
    "Ultravox",
    method,
    pathOrUrl.startsWith("http") ? pathOrUrl : `${config.baseUrl}${pathOrUrl}`,
    { "X-API-Key": config.apiKey },
    body,
  );

/**
 * Resolves the dictionaries to attach, as full Inworld resource names. With no
 * --dictionary flags, uses this example's dictionary (found by display name).
 * Each one is read from Inworld first, which proves it exists and that
 * INWORLD_API_KEY can read it.
 */
async function resolveDictionaries(ids: string[]): Promise<string[]> {
  const { client } = inworld;
  if (ids.length === 0) {
    const dictionary = await client.findDictionaryByDisplayName(inworld.dictionaryDisplayName);
    if (!dictionary?.name) {
      throw new Error(
        `No dictionary named "${inworld.dictionaryDisplayName}" in workspace "${client.workspace}". ` +
          "Run `npm run inworld -- create`, or pass --dictionary <id> " +
          "(see `npm run inworld -- list`).",
      );
    }
    console.log(`  ${dictionary.name}  "${dictionary.displayName}"`);
    return [dictionary.name];
  }

  const names = ids.map((id) => client.dictionaryName(id.trim()));
  if (names.length > MAX_DICTIONARIES) {
    throw new Error(`A voice can use at most ${MAX_DICTIONARIES} dictionaries (got ${names.length}).`);
  }
  if (new Set(names).size !== names.length) {
    throw new Error("The same dictionary was passed more than once.");
  }
  for (const name of names) {
    try {
      const dictionary = await client.getDictionary(name);
      console.log(`  ${dictionary.name}  "${dictionary.displayName}"`);
    } catch (error) {
      if (error instanceof ApiError && error.status === 404) {
        throw new Error(
          `Inworld dictionary ${name} doesn't exist in workspace "${client.workspace}". ` +
            "Run `npm run inworld -- list` to see the available IDs.",
        );
      }
      throw error;
    }
  }
  return names;
}

/**
 * A voice created through the Ultravox API runs on the account's own Inworld
 * key (Account > TTS API keys), and that key must be able to read the dictionaries.
 */
async function ensureUltravoxHasInworldKey(): Promise<void> {
  const keys = await ultravox<AccountTtsKeys>("GET", "/api/accounts/me/tts_api_keys");
  const prefix = keys.inworld?.prefix;
  if (prefix && config.inworldApiKey.startsWith(prefix)) {
    console.log("  The Ultravox account already has this Inworld API key.");
    return;
  }
  if (!config.setInworldKey) {
    throw new Error(
      prefix
        ? `The Ultravox account's Inworld key (prefix "${prefix}") is not INWORLD_API_KEY, so ` +
            "calls may be unable to read these dictionaries. Set ULTRAVOX_SET_INWORLD_KEY=true " +
            "to replace it, or use a key from the same Inworld workspace."
        : "The Ultravox account has no Inworld API key, so calls with this voice would fail. " +
            "Set ULTRAVOX_SET_INWORLD_KEY=true to store INWORLD_API_KEY on the account.",
    );
  }
  const body: SetTtsApiKeysRequest = { inworld: config.inworldApiKey };
  await ultravox<AccountTtsKeys>("PATCH", "/api/accounts/me/tts_api_keys", body);
  console.log("  Stored INWORLD_API_KEY as the Ultravox account's Inworld TTS key.");
}

/**
 * Finds a voice this script can update: one defined by JSON that runs on the
 * account's own Inworld key (billing style EXTERNAL). Cloned voices can't be
 * modified through the API, so a clone with the same name is ignored.
 */
async function findDefinedVoiceByName(name: string): Promise<Voice | undefined> {
  const query = new URLSearchParams({
    ownership: "private",
    provider: "inworld",
    billingStyle: "VOICE_BILLING_STYLE_EXTERNAL",
  });
  let next: string | null | undefined = `/api/voices?${query}`;
  while (next) {
    const page: PaginatedVoiceList = await ultravox<PaginatedVoiceList>("GET", next);
    const match = page.results.find(
      (voice) => voice.name === name && voice.billingStyle === "VOICE_BILLING_STYLE_EXTERNAL",
    );
    if (match) return match;
    next = page.next;
  }
  return undefined;
}

async function upsertVoice(voiceName: string, dictionaryNames: string[]): Promise<Voice> {
  const body: VoiceWrite = {
    name: voiceName,
    description: `Inworld ${inworld.voiceId} on ${inworld.modelId} with ${dictionaryNames.length} pronunciation dictionar${dictionaryNames.length === 1 ? "y" : "ies"}`,
    primaryLanguage: inworld.language,
    definition: {
      inworld: {
        voiceId: inworld.voiceId,
        modelId: inworld.modelId,
        pronunciationDictionaryIds: dictionaryNames,
      },
    },
  };

  try {
    const existing = await findDefinedVoiceByName(voiceName);
    if (existing) {
      console.log(`  Found voice ${existing.voiceId}; updating it...`);
      return await ultravox<Voice>("PATCH", `/api/voices/${existing.voiceId}`, body);
    }
    console.log(`  Creating "${voiceName}"...`);
    return await ultravox<Voice>("POST", "/api/voices", body);
  } catch (error) {
    if (error instanceof ApiError && error.status === 400 && error.body.includes("pronunciationDictionaryIds")) {
      throw new Error(
        "This Ultravox environment doesn't support Inworld pronunciation dictionaries yet.\n" +
          error.message,
      );
    }
    throw error;
  }
}

async function createVoice(args: string[]): Promise<void> {
  const { values } = parseArgs({
    args,
    options: {
      dictionary: { type: "string", multiple: true, short: "d" },
      name: { type: "string", short: "n" },
    },
  });
  const voiceName = values.name?.trim() || config.voiceName;
  if (!VOICE_NAME_PATTERN.test(voiceName)) {
    throw new Error(
      `Voice name "${voiceName}" is invalid: use 1-64 letters, digits, "_" or "-" (no spaces).`,
    );
  }

  console.log("1. Checking the Inworld pronunciation dictionaries");
  const dictionaryNames = await resolveDictionaries(values.dictionary ?? []);

  console.log(`2. Adding the Ultravox voice (Inworld "${inworld.voiceId}" on ${inworld.modelId})`);
  await ensureUltravoxHasInworldKey();
  const voice = await upsertVoice(voiceName, dictionaryNames);
  const stored = voice.definition.inworld?.pronunciationDictionaryIds ?? [];
  if (stored.join("\n") !== dictionaryNames.join("\n")) {
    throw new Error(
      `Ultravox saved voice ${voice.voiceId} without the requested dictionaries ` +
        `(got ${JSON.stringify(stored)}). This environment doesn't support Inworld ` +
        "pronunciation dictionaries yet.",
    );
  }
  console.log(`  voiceId: ${voice.voiceId}`);
  console.log(`  name: ${voice.name}`);
  console.log(`  pronunciationDictionaryIds: ${stored.join(", ")}`);
  console.log(`\nDone. Use voice "${voice.voiceId}" (or "${voice.name}") in an Ultravox agent or call.`);
}

const USAGE = `Usage: npm run ultravox -- <command>

Commands:
  create-voice [--dictionary <id>]... [--name <voice-name>]
      Add (or update) an Ultravox voice that uses Inworld pronunciation dictionaries.
      --dictionary, -d  Dictionary ID or full resource name. Repeat for up to
                        ${MAX_DICTIONARIES}, in priority order. Default: this example's
                        dictionary (INWORLD_DICTIONARY_DISPLAY_NAME).
      --name, -n        Ultravox voice name. Default: ULTRAVOX_VOICE_NAME.`;

async function main(): Promise<void> {
  const [command, ...rest] = process.argv.slice(2);
  switch (command) {
    case "create-voice":
      return createVoice(rest);
    default:
      console.log(USAGE);
      if (command) process.exitCode = 1;
  }
}

main().catch((error: unknown) => {
  console.error(`\nFailed: ${error instanceof Error ? error.message : String(error)}`);
  process.exitCode = 1;
});
