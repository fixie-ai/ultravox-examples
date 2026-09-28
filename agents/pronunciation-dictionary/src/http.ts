import type { InworldErrorBody } from "./inworld/types.ts";

/** A non-2xx HTTP response. `body` is the raw response text. */
export class ApiError extends Error {
  constructor(
    readonly service: string,
    readonly status: number,
    readonly body: string,
  ) {
    super(`${service} API returned HTTP ${status}: ${describeErrorBody(body)}`);
  }
}

/**
 * Renders google.rpc.Status errors with their field violations, for example:
 *   Pronunciation request is invalid
 *     - pronunciation_dictionary.pronunciations[7].phone_symbols[5]: Invalid value
 */
function describeErrorBody(body: string): string {
  try {
    const parsed = JSON.parse(body) as InworldErrorBody;
    if (typeof parsed.message !== "string") return body;
    const violations = (parsed.details ?? [])
      .flatMap((detail) => detail.fieldViolations ?? [])
      .map((v) => `\n  - ${v.field}${v.description ? `: ${v.description}` : ""}`)
      .join("");
    return `${parsed.message}${violations}`;
  } catch {
    return body;
  }
}

/** Sends a JSON request and parses the JSON response; throws ApiError on non-2xx. */
export async function requestJson<T>(
  service: string,
  method: string,
  url: string,
  headers: Record<string, string>,
  body?: unknown,
): Promise<T> {
  const response = await fetch(url, {
    method,
    headers: { ...headers, ...(body === undefined ? {} : { "Content-Type": "application/json" }) },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const text = await response.text();
  if (!response.ok) throw new ApiError(service, response.status, text);
  return (text ? JSON.parse(text) : {}) as T;
}
