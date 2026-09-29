/**
 * JSON shapes for the Ultravox voices and account TTS-key APIs.
 *
 * Written from the Ultravox API schema (https://docs.ultravox.ai: Voice,
 * ExternalVoice, InworldVoice, PaginatedVoiceList, AccountTtsKeys, and
 * SetTtsApiKeysRequest), covering only the fields this example uses.
 */

export type InworldDeliveryMode =
  | "DELIVERY_MODE_UNSPECIFIED"
  | "DELIVERY_MODE_STABLE"
  | "DELIVERY_MODE_BALANCED"
  | "DELIVERY_MODE_CREATIVE";

/** A voice served by Inworld over bidirectional streaming. */
export interface InworldVoice {
  /** Inworld voice ID, e.g. "Sarah". */
  voiceId: string;
  /** Inworld model ID, e.g. "inworld-tts-2". */
  modelId: string;
  /** 0.5-1.5, default 1. */
  speakingRate?: number;
  /** 0.0-2.0. */
  temperature?: number;
  applyTextNormalization?: boolean;
  /** Only used by inworld-tts-2 models. */
  deliveryMode?: InworldDeliveryMode;
  /**
   * Up to three unique Inworld dictionary resource names, in priority order
   * (first match wins): "workspaces/{workspace}/pronunciationDictionaries/{uuid}".
   * Each must be readable with the Inworld API key stored on the Ultravox
   * account. Omit or leave empty for no dictionary.
   */
  pronunciationDictionaryIds?: string[];
}

/** Exactly one field must be set. Only the Inworld variant is modelled here. */
export interface ExternalVoice {
  inworld?: InworldVoice;
  [provider: string]: unknown;
}

export type VoiceOwnership = "public" | "private";
export type VoiceBillingStyle = "VOICE_BILLING_STYLE_INCLUDED" | "VOICE_BILLING_STYLE_EXTERNAL";

/** POST /api/voices (application/json) and PATCH /api/voices/{voiceId} body. */
export interface VoiceWrite {
  /** Must match ^[a-zA-Z0-9_-]{1,64}$ (no spaces), unique within the account. */
  name?: string;
  /** Max 240 characters. */
  description?: string;
  /** BCP-47, max 10 characters. */
  primaryLanguage?: string;
  definition?: ExternalVoice;
}

export interface Voice {
  voiceId: string;
  name: string;
  description?: string | null;
  primaryLanguage?: string | null;
  languageLabel?: string | null;
  previewUrl: string;
  ownership: VoiceOwnership;
  billingStyle: VoiceBillingStyle;
  provider: string | null;
  definition: ExternalVoice;
}

export interface PaginatedVoiceList {
  next?: string | null;
  previous?: string | null;
  results: Voice[];
  total?: number;
}

export interface KeyPrefix {
  prefix: string;
}

/** GET /api/accounts/me/tts_api_keys. Only key prefixes are returned. */
export interface AccountTtsKeys {
  elevenLabs?: KeyPrefix;
  cartesia?: KeyPrefix;
  lmnt?: KeyPrefix;
  google?: KeyPrefix;
  inworld?: KeyPrefix;
  respeecher?: KeyPrefix;
}

/** PATCH /api/accounts/me/tts_api_keys. */
export interface SetTtsApiKeysRequest {
  elevenLabs?: string | null;
  cartesia?: string | null;
  lmnt?: string | null;
  google?: string | null;
  inworld?: string | null;
  respeecher?: string | null;
}
