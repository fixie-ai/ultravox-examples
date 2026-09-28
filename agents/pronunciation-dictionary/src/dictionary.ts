import type { PronunciationEntry } from "./inworld/types.ts";

/**
 * The custom pronunciation dictionary this example creates in Inworld.
 *
 * Rules the service enforces (the whole request fails if any entry breaks one):
 * - displayHeadword: a single word (it must tokenize to one lexical token), at most 128 code points.
 * - languageCode: exact canonical BCP-47, e.g. "en-US". Not "en-us", "en", or "auto".
 * - phoneSymbols: 1-64 IPA phones, one phone per array element, each at most
 *   16 code points, with no whitespace and no "/". Use standard English IPA,
 *   not ARPAbet.
 * - Each (languageCode, headword) pair may appear once per dictionary.
 * - At most 1,000 entries and 512 KiB per dictionary.
 *
 * The service validates every phone against the language's phone inventory.
 * If a symbol isn't in it, the error names the exact field, e.g.
 * pronunciation_dictionary.pronunciations[1].phone_symbols[3].
 *
 * What the en-US inventory accepts (found by testing):
 * - Diphthongs must be split into their parts: "a", "ɪ" (not "aɪ") and
 *   "e", "ɪ" (not "eɪ"). "eɪ" is rejected as a single token.
 * - Stress marks "ˈ" and "ˌ" are accepted as their own tokens.
 * - The long vowel "iː" is accepted as one token.
 *
 * At synthesis the service joins an entry's tokens back into one IPA string
 * (the comment above each entry), so splitting a diphthong doesn't change how
 * it sounds.
 */
export const DICTIONARY_ENTRIES: PronunciationEntry[] = [
  {
    // /ɪnwəɹld/
    displayHeadword: "Inworld",
    languageCode: "en-US",
    phoneSymbols: ["ɪ", "n", "w", "ə", "ɹ", "l", "d"],
  },

  // Names people often mispronounce.
  {
    // /wɪn/ ("win")
    displayHeadword: "Nguyen",
    languageCode: "en-US",
    phoneSymbols: ["w", "ɪ", "n"],
  },
  {
    // /ˈsɪɹʃə/ ("SEER-sha")
    displayHeadword: "Saoirse",
    languageCode: "en-US",
    phoneSymbols: ["ˈ", "s", "ɪ", "ɹ", "ʃ", "ə"],
  },
  {
    // /ʃɪˈvɑn/ ("shi-VAWN")
    displayHeadword: "Siobhan",
    languageCode: "en-US",
    phoneSymbols: ["ʃ", "ɪ", "ˈ", "v", "ɑ", "n"],
  },
  {
    // /ˈwʊstəɹ/ ("WUSS-ter")
    displayHeadword: "Worcester",
    languageCode: "en-US",
    phoneSymbols: ["ˈ", "w", "ʊ", "s", "t", "ə", "ɹ"],
  },

  // Made-up product names, which the model has no way to guess.
  {
    // /ˈkɑɹvɪks/ ("KAR-vix")
    displayHeadword: "Qorvix",
    languageCode: "en-US",
    phoneSymbols: ["ˈ", "k", "ɑ", "ɹ", "v", "ɪ", "k", "s"],
  },
  {
    // /ˈvaɪtə/ ("VY-tuh"): the diphthong aɪ is split into "a", "ɪ".
    displayHeadword: "Vyta",
    languageCode: "en-US",
    phoneSymbols: ["ˈ", "v", "a", "ɪ", "t", "ə"],
  },
];

/** Default text for `npm run inworld -- preview`; it uses every entry above. */
export const PREVIEW_TEXT =
  "Hi, this is Sarah, a voice from Inworld. " +
  "I'm calling for Siobhan Nguyen and Saoirse about your Qorvix order. " +
  "Your Vyta headset ships from our Worcester warehouse today.";

const MAX_ENTRIES = 1_000;
const MAX_DISPLAY_NAME_CODE_POINTS = 64;
const MAX_HEADWORD_CODE_POINTS = 128;
const MAX_PHONES = 64;
const MAX_PHONE_CODE_POINTS = 16;
const WHITESPACE = /\s/u;

const codePoints = (value: string): number => [...value].length;

/**
 * Checks the limits the API documents so mistakes fail fast with a readable
 * message. The server's check is still authoritative: whether a headword is one
 * lexical token and whether a phone is in the inventory are decided there.
 */
export function validateDictionary(displayName: string, entries: PronunciationEntry[]): string[] {
  const problems: string[] = [];
  const nameLength = codePoints(displayName.trim());
  if (nameLength === 0 || nameLength > MAX_DISPLAY_NAME_CODE_POINTS) {
    problems.push(`displayName must be 1-${MAX_DISPLAY_NAME_CODE_POINTS} characters`);
  }
  if (entries.length > MAX_ENTRIES) {
    problems.push(`at most ${MAX_ENTRIES} entries are allowed (got ${entries.length})`);
  }

  const seen = new Map<string, number>();
  entries.forEach((entry, i) => {
    const at = `pronunciations[${i}] (${entry.displayHeadword || "<empty>"})`;
    const headword = entry.displayHeadword.trim();
    if (headword.length === 0 || codePoints(headword) > MAX_HEADWORD_CODE_POINTS) {
      problems.push(`${at}: displayHeadword must be 1-${MAX_HEADWORD_CODE_POINTS} characters`);
    }
    if (WHITESPACE.test(headword)) {
      problems.push(`${at}: displayHeadword must be a single word, not a phrase`);
    }
    if (!/^[a-z]{2,3}-[A-Z]{2}$/.test(entry.languageCode)) {
      problems.push(`${at}: languageCode must be canonical BCP-47 such as "en-US"`);
    }
    if (entry.phoneSymbols.length === 0 || entry.phoneSymbols.length > MAX_PHONES) {
      problems.push(`${at}: phoneSymbols must contain 1-${MAX_PHONES} phones`);
    }
    entry.phoneSymbols.forEach((phone, j) => {
      if (phone.length === 0 || codePoints(phone) > MAX_PHONE_CODE_POINTS) {
        problems.push(`${at}: phoneSymbols[${j}] must be 1-${MAX_PHONE_CODE_POINTS} characters`);
      }
      if (phone.includes("/") || WHITESPACE.test(phone)) {
        problems.push(`${at}: phoneSymbols[${j}] must be one phone with no "/" or spaces`);
      }
    });

    // Approximates the server's language-aware matching; the server has the final say.
    const key = `${entry.languageCode}\u0000${headword.toLocaleLowerCase(entry.languageCode)}`;
    const first = seen.get(key);
    if (first !== undefined) {
      problems.push(`${at}: duplicates pronunciations[${first}]`);
    } else {
      seen.set(key, i);
    }
  });
  return problems;
}
