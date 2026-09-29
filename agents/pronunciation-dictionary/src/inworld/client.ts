import { ApiError, requestJson } from "../http.ts";
import type {
  ListPronunciationDictionariesResponse,
  PronunciationDictionary,
  PronunciationDictionaryUpdateField,
  SynthesizeSpeechRequest,
  SynthesizeSpeechResponse,
} from "./types.ts";

export interface InworldClientOptions {
  /** Base64 credential copied from the Inworld Portal, already base64(key_id:secret). */
  apiKey: string;
  /** Workspace ID that owns the dictionaries, e.g. "default-abc123". */
  workspace: string;
  baseUrl?: string;
}

/**
 * Minimal client for the Inworld pronunciation dictionary API
 * (/pronunciations/v1) and the TTS synthesis endpoint (/tts/v1/voice).
 */
export class InworldClient {
  private readonly apiKey: string;
  private readonly baseUrl: string;
  readonly workspace: string;

  constructor(options: InworldClientOptions) {
    this.apiKey = options.apiKey;
    this.workspace = options.workspace;
    this.baseUrl = options.baseUrl ?? "https://api.inworld.ai";
  }

  private request<T>(method: string, path: string, body?: unknown): Promise<T> {
    // The Portal credential is already base64-encoded; send it as-is.
    return requestJson<T>("Inworld", method, `${this.baseUrl}${path}`, {
      Authorization: `Basic ${this.apiKey}`,
    }, body);
  }

  private get parent(): string {
    return `workspaces/${this.workspace}`;
  }

  /** Lists every dictionary in the workspace, following pagination. */
  async listDictionaries(): Promise<PronunciationDictionary[]> {
    const all: PronunciationDictionary[] = [];
    let pageToken = "";
    do {
      // The service caps pageSize at 5 because each item carries its full contents.
      const query = new URLSearchParams({ pageSize: "5" });
      if (pageToken) query.set("pageToken", pageToken);
      const page = await this.request<ListPronunciationDictionariesResponse>(
        "GET",
        `/pronunciations/v1/${this.parent}/pronunciationDictionaries?${query}`,
      );
      all.push(...(page.pronunciationDictionaries ?? []));
      pageToken = page.nextPageToken ?? "";
    } while (pageToken);
    return all;
  }

  /**
   * Turns a dictionary ID into its full resource name. Accepts the bare ID
   * (the UUID at the end of the name) or a full
   * "workspaces/{ws}/pronunciationDictionaries/{uuid}" name, returned as-is.
   */
  dictionaryName(idOrName: string): string {
    return idOrName.startsWith("workspaces/")
      ? idOrName
      : `${this.parent}/pronunciationDictionaries/${idOrName}`;
  }

  /** Gets one dictionary by resource name ("workspaces/{ws}/pronunciationDictionaries/{uuid}"). */
  getDictionary(name: string): Promise<PronunciationDictionary> {
    return this.request<PronunciationDictionary>("GET", `/pronunciations/v1/${name}`);
  }

  /**
   * Finds a dictionary by display name. Display names aren't unique, so this
   * throws if more than one matches.
   */
  async findDictionaryByDisplayName(displayName: string): Promise<PronunciationDictionary | undefined> {
    const matches = (await this.listDictionaries()).filter((d) => d.displayName === displayName);
    if (matches.length > 1) {
      throw new Error(
        `${matches.length} dictionaries are named "${displayName}" ` +
          `(${matches.map((d) => d.name).join(", ")}). Delete the extras or use a unique name.`,
      );
    }
    return matches[0];
  }

  /**
   * Creates a dictionary with its complete contents. The service assigns the
   * resource name and validates every entry; one invalid entry fails the whole
   * request and nothing is saved.
   */
  async createDictionary(dictionary: PronunciationDictionary): Promise<PronunciationDictionary> {
    try {
      return await this.request<PronunciationDictionary>(
        "POST",
        `/pronunciations/v1/${this.parent}/pronunciationDictionaries`,
        dictionary,
      );
    } catch (error) {
      if (error instanceof ApiError) throw error;
      // Create has no idempotency key. If the connection failed before a response
      // arrived, the dictionary may have been saved anyway: check before anyone retries.
      const committed = await this.findDictionaryByDisplayName(dictionary.displayName);
      if (committed) return committed;
      throw error;
    }
  }

  /**
   * Updates the fields named in `fields`. `dictionary` must carry `name` and
   * the current `etag`. Updating "pronunciations" replaces every entry; any
   * entry left out is deleted. A stale etag returns HTTP 409.
   */
  updateDictionary(
    dictionary: PronunciationDictionary,
    fields: PronunciationDictionaryUpdateField[],
  ): Promise<PronunciationDictionary> {
    return this.request<PronunciationDictionary>(
      "PATCH",
      `/pronunciations/v1/${dictionary.name}?updateMask=${fields.join(",")}`,
      dictionary,
    );
  }

  /** Deletes a dictionary and all of its entries. `etag` must be current. */
  async deleteDictionary(name: string, etag: string, allowMissing = false): Promise<void> {
    const query = new URLSearchParams({ etag });
    if (allowMissing) query.set("allowMissing", "true");
    await this.request<unknown>("DELETE", `/pronunciations/v1/${name}?${query}`);
  }

  /** Synthesizes speech and returns the decoded audio bytes. */
  async synthesize(body: SynthesizeSpeechRequest): Promise<Buffer> {
    const response = await this.request<SynthesizeSpeechResponse>("POST", "/tts/v1/voice", body);
    return Buffer.from(response.audioContent, "base64");
  }
}
