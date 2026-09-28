/**
 * JSON (REST) shapes for the Inworld pronunciation dictionary and TTS APIs.
 *
 * Written from the ai.inworld.pronunciation.v1 and ai.inworld.tts.v1 API
 * definitions (the TTS types cover only the fields this example uses). Field
 * names are the lowerCamelCase JSON names the REST API accepts and returns.
 */

// ---------------------------------------------------------------------------
// ai.inworld.pronunciation.v1
// ---------------------------------------------------------------------------

/** One user-authored entry in a pronunciation dictionary. */
export interface PronunciationEntry {
  /**
   * Caller-facing spelling. Must tokenize to one replaceable lexical token (a
   * single word, no phrases) and contain at most 128 Unicode code points.
   */
  displayHeadword: string;
  /** Exact canonical BCP-47 code, e.g. "en-US". "en-us", "en", and "auto" are rejected. */
  languageCode: string;
  /**
   * 1-64 IPA phone tokens, ONE PHONE PER ELEMENT (["k","æ","t"], not ["kæt"] or
   * ["/kæt/"]). Each at most 16 code points, no whitespace, no "/". Aliases are
   * canonicalized by the service, so the response may differ from the request.
   */
  phoneSymbols: string[];
}

/** A named collection of pronunciation overrides owned by one workspace. */
export interface PronunciationDictionary {
  /**
   * Service-assigned resource name:
   * "workspaces/{workspace}/pronunciationDictionaries/{uuid}". Output only on
   * create; required on update.
   */
  name?: string;
  /** 1-64 Unicode code points. Required on create. */
  displayName: string;
  /**
   * Complete contents: 0-1,000 entries, 512 KiB encoded limit. On update with
   * "pronunciations" in the mask, this list atomically REPLACES all entries.
   */
  pronunciations?: PronunciationEntry[];
  /** Required on update and delete. Changes whenever metadata or contents change. */
  etag?: string;
  /** RFC 3339 timestamp. Output only. */
  createTime?: string;
  /** RFC 3339 timestamp. Output only. */
  updateTime?: string;
}

/** Response of GET .../pronunciationDictionaries. Page size is capped at 5. */
export interface ListPronunciationDictionariesResponse {
  pronunciationDictionaries?: PronunciationDictionary[];
  /** Empty or absent on the last page. */
  nextPageToken?: string;
}

/** Mutable fields accepted in update_mask. Omission or "*" means both. */
export type PronunciationDictionaryUpdateField = "displayName" | "pronunciations";

// ---------------------------------------------------------------------------
// ai.inworld.tts.v1 (subset used by this example)
// ---------------------------------------------------------------------------

export interface PronunciationDictionaryLocator {
  /** Full resource name: "workspaces/{workspace}/pronunciationDictionaries/{uuid}". */
  dictionary: string;
}

export interface PronunciationDictionarySettings {
  /** One to three distinct dictionaries, in priority order (first match wins). */
  dictionaries: PronunciationDictionaryLocator[];
}

export type AudioEncoding =
  | "AUDIO_ENCODING_UNSPECIFIED"
  | "LINEAR16"
  | "MP3"
  | "OGG_OPUS"
  | "ALAW"
  | "MULAW"
  | "FLAC";

export interface AudioConfig {
  audioEncoding?: AudioEncoding;
  sampleRateHertz?: number;
  speakingRate?: number;
}

/** POST /tts/v1/voice request (subset). */
export interface SynthesizeSpeechRequest {
  text: string;
  voiceId: string;
  /** Dictionaries apply to TTS 2 models only (e.g. "inworld-tts-2"). */
  modelId: string;
  /**
   * BCP-47 synthesis language. Set it: with AUTO (omitted), dictionaries apply
   * only where the server-side auto-language rollout flag is on.
   */
  language?: string;
  audioConfig?: AudioConfig;
  /**
   * Selects named dictionaries. Mutually exclusive with
   * enableCustomPronunciation, even when that field is false.
   */
  pronunciationDictionarySettings?: PronunciationDictionarySettings;
  /** Selects the workspace default dictionary. Do not combine with the field above. */
  enableCustomPronunciation?: boolean;
}

/** POST /tts/v1/voice response (subset). */
export interface SynthesizeSpeechResponse {
  /** Base64-encoded audio (proto bytes). */
  audioContent: string;
}

// ---------------------------------------------------------------------------
// google.rpc.Status as rendered by the REST gateway
// ---------------------------------------------------------------------------

export interface FieldViolation {
  /** Proto field path, e.g. "pronunciation_dictionary.pronunciations[2].phone_symbols[1]". */
  field: string;
  description?: string;
}

export interface StatusDetail {
  "@type": string;
  fieldViolations?: FieldViolation[];
  [key: string]: unknown;
}

export interface InworldErrorBody {
  /** gRPC status code number, e.g. 3 = INVALID_ARGUMENT, 10 = ABORTED (etag mismatch). */
  code?: number;
  message?: string;
  details?: StatusDetail[];
}
