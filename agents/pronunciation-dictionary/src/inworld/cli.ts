/**
 * Manage an Inworld TTS 2 pronunciation dictionary and hear it in use.
 *
 *   npm run inworld -- list             # every dictionary in the workspace
 *   npm run inworld -- get              # this example's dictionary and its entries
 *   npm run inworld -- create           # create it from src/dictionary.ts
 *   npm run inworld -- update           # replace its entries with src/dictionary.ts
 *   npm run inworld -- preview ["text"] # synthesize preview.mp3 with the dictionary
 *   npm run inworld -- delete           # delete it
 *
 * The example's dictionary is found by INWORLD_DICTIONARY_DISPLAY_NAME.
 */
import { writeFile } from "node:fs/promises";

import { DICTIONARY_ENTRIES, PREVIEW_TEXT, validateDictionary } from "../dictionary.ts";
import { ApiError } from "../http.ts";
import { inworldSettings } from "./settings.ts";
import type { PronunciationDictionary, PronunciationEntry } from "./types.ts";

const PREVIEW_FILE = "preview.mp3";

const settings = inworldSettings();
const { client } = settings;

function formatEntry(entry: PronunciationEntry): string {
  // The service joins the phone tokens into one /…/ IPA string at synthesis.
  return `${entry.displayHeadword} (${entry.languageCode})  /${entry.phoneSymbols.join("")}/`;
}

function printDictionary(dictionary: PronunciationDictionary): void {
  console.log(`  name: ${dictionary.name}`);
  console.log(`  displayName: ${dictionary.displayName}`);
  console.log(`  etag: ${dictionary.etag}`);
  console.log(`  updated: ${dictionary.updateTime}`);
  const entries = dictionary.pronunciations ?? [];
  console.log(`  entries (${entries.length}):`);
  for (const entry of entries) console.log(`    ${formatEntry(entry)}`);
}

function checkLocalEntries(): void {
  const problems = validateDictionary(settings.dictionaryDisplayName, DICTIONARY_ENTRIES);
  if (problems.length > 0) {
    throw new Error(`Fix src/dictionary.ts first:\n  - ${problems.join("\n  - ")}`);
  }
}

async function requireDictionary(): Promise<PronunciationDictionary> {
  const dictionary = await client.findDictionaryByDisplayName(settings.dictionaryDisplayName);
  if (!dictionary?.name) {
    throw new Error(
      `No dictionary named "${settings.dictionaryDisplayName}" in workspace ` +
        `"${client.workspace}". Run: npm run inworld -- create`,
    );
  }
  return dictionary;
}

async function list(): Promise<void> {
  const dictionaries = await client.listDictionaries();
  console.log(`${dictionaries.length} dictionaries in workspace "${client.workspace}":`);
  for (const d of dictionaries) {
    console.log(`  ${d.displayName}  (${d.pronunciations?.length ?? 0} entries)  ${d.name}`);
  }
}

async function get(): Promise<void> {
  printDictionary(await requireDictionary());
}

async function create(): Promise<void> {
  checkLocalEntries();
  const existing = await client.findDictionaryByDisplayName(settings.dictionaryDisplayName);
  if (existing) {
    throw new Error(
      `"${settings.dictionaryDisplayName}" already exists (${existing.name}). ` +
        "Run: npm run inworld -- update",
    );
  }
  console.log(`Creating "${settings.dictionaryDisplayName}" with ${DICTIONARY_ENTRIES.length} entries...`);
  printDictionary(
    await client.createDictionary({
      displayName: settings.dictionaryDisplayName,
      pronunciations: DICTIONARY_ENTRIES,
    }),
  );
}

async function update(): Promise<void> {
  checkLocalEntries();
  const replaceEntries = (current: PronunciationDictionary) =>
    client.updateDictionary(
      { name: current.name, displayName: current.displayName, etag: current.etag, pronunciations: DICTIONARY_ENTRIES },
      ["pronunciations"],
    );

  const current = await requireDictionary();
  console.log(`Replacing the entries of ${current.name} with ${DICTIONARY_ENTRIES.length} entries...`);
  try {
    printDictionary(await replaceEntries(current));
  } catch (error) {
    // HTTP 409: the dictionary changed after we read its etag. Re-read once and retry.
    if (!(error instanceof ApiError) || error.status !== 409) throw error;
    console.warn("  The dictionary changed since it was read; re-reading and retrying once...");
    printDictionary(await replaceEntries(await client.getDictionary(current.name!)));
  }
}

async function preview(text: string): Promise<void> {
  const dictionary = await requireDictionary();
  console.log(`Synthesizing with voice "${settings.voiceId}" on ${settings.modelId} (${settings.language})...`);
  console.log(`  text: ${text}`);
  const audio = await client.synthesize({
    text,
    voiceId: settings.voiceId,
    modelId: settings.modelId,
    // Set the language explicitly; the dictionary is matched by language.
    language: settings.language,
    audioConfig: { audioEncoding: "MP3" },
    pronunciationDictionarySettings: { dictionaries: [{ dictionary: dictionary.name! }] },
  });
  await writeFile(PREVIEW_FILE, audio);
  console.log(`  Wrote ${PREVIEW_FILE}`);
}

async function remove(): Promise<void> {
  const dictionary = await requireDictionary();
  await client.deleteDictionary(dictionary.name!, dictionary.etag!);
  console.log(`Deleted ${dictionary.name}`);
}

const USAGE = `Usage: npm run inworld -- <command>

Commands:
  list             List every dictionary in the workspace
  get              Show this example's dictionary and its entries
  create           Create the dictionary from src/dictionary.ts
  update           Replace the dictionary's entries with src/dictionary.ts
  preview ["text"] Synthesize ${PREVIEW_FILE} using the dictionary
  delete           Delete the dictionary`;

async function main(): Promise<void> {
  const [command, ...rest] = process.argv.slice(2);
  switch (command) {
    case "list":
      return list();
    case "get":
      return get();
    case "create":
      return create();
    case "update":
      return update();
    case "preview":
      return preview(rest.join(" ").trim() || PREVIEW_TEXT);
    case "delete":
      return remove();
    default:
      console.log(USAGE);
      if (command) process.exitCode = 1;
  }
}

main().catch((error: unknown) => {
  console.error(`\nFailed: ${error instanceof Error ? error.message : String(error)}`);
  if (error instanceof ApiError && error.status === 403) {
    console.error(
      "Check that the API key has write access to this workspace and that the " +
        "pronunciation dictionary API is enabled for it.",
    );
  }
  process.exitCode = 1;
});
