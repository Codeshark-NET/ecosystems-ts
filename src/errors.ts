import type { RateLimit } from "./ratelimit.js";

/**
 * Appended when the transport reports a failure before any response arrived.
 *
 * Port of `streamErrHint` in ecosystems-go. These are not rate limits -- the server
 * closes the connection without a status code, often because the request is too large
 * or the shared pool is overloaded.
 */
export const NETWORK_HINT =
  " (the request was rejected before a response; try identifying with `from` (email)" +
  " or `apiKey`, or a smaller `batchSize`)";

/** Appended to HTTP 429 responses, which ecosyste.ms returns for rate-limited requests. */
export const RATE_LIMIT_HINT =
  " (rate limited; try identifying with `from` (email) or `apiKey`)";

export interface EcosystemsErrorOptions {
  status?: number | undefined;
  url?: string | undefined;
  hint?: string | undefined;
  rateLimit?: RateLimit | null | undefined;
  cause?: unknown;
}

/** Every error this SDK throws. `cause` preserves the underlying failure. */
export class EcosystemsError extends Error {
  override readonly name = "EcosystemsError";
  readonly status: number | undefined;
  readonly url: string | undefined;
  /** Actionable remediation, when we can offer one. Already included in `message`. */
  readonly hint: string | undefined;
  readonly rateLimit: RateLimit | null | undefined;

  constructor(message: string, options: EcosystemsErrorOptions = {}) {
    super(message + (options.hint ?? ""), { cause: options.cause });
    this.status = options.status;
    this.url = options.url;
    this.hint = options.hint;
    this.rateLimit = options.rateLimit;
  }
}

const STREAM_MARKERS = ["stream error", "INTERNAL_ERROR", "GOAWAY", "ENHANCE_YOUR_CALM"];

const SOCKET_CODES = new Set([
  "ECONNRESET",
  "ECONNREFUSED",
  "EPIPE",
  "ETIMEDOUT",
  "UND_ERR_SOCKET",
  "UND_ERR_CONNECT_TIMEOUT",
  "ERR_HTTP2_STREAM_ERROR",
]);

/**
 * True when a thrown error looks like the server dropped the connection rather than
 * answering. Port of `looksLikeStreamErr`, widened for how undici and browsers surface
 * the same conditions (Go sees the HTTP/2 stream error text directly; `fetch` does not).
 */
export function looksLikeNetworkError(err: unknown): boolean {
  if (err == null) return false;

  const code = (err as { cause?: { code?: unknown } })?.cause?.code;
  if (typeof code === "string" && SOCKET_CODES.has(code)) return true;

  const message = err instanceof Error ? err.message : String(err);
  if (STREAM_MARKERS.some((marker) => message.includes(marker))) return true;

  // undici: "fetch failed"; browsers: "Failed to fetch" / "Load failed" (Safari).
  return /fetch failed|failed to fetch|load failed|network error/i.test(message);
}

/** Wraps a thrown transport error, adding the network hint when it looks like one. */
export function networkError(what: string, err: unknown): EcosystemsError {
  if (err instanceof EcosystemsError) return err;
  const message = err instanceof Error ? err.message : String(err);
  return new EcosystemsError(`${what}: ${message}`, {
    cause: err,
    ...(looksLikeNetworkError(err) ? { hint: NETWORK_HINT } : {}),
  });
}

/**
 * Builds an error for a non-2xx response, adding the rate-limit hint on 429.
 *
 * Mirrors `errBulkLookupStatus`: when the body carried an `{"error": "..."}` detail we
 * report that instead of the bare status code.
 */
export function statusError(
  what: string,
  response: Response,
  detail?: string | undefined,
  rateLimit?: RateLimit | null,
): EcosystemsError {
  const base = detail
    ? `${what} failed: ${detail}`
    : `${what} failed with status ${response.status}`;
  return new EcosystemsError(base, {
    status: response.status,
    url: response.url,
    rateLimit,
    ...(response.status === 429 ? { hint: RATE_LIMIT_HINT } : {}),
  });
}

/** Pulls `{"error": "..."}` out of an error body. Every service returns this shape. */
export function errorDetail(body: unknown): string | undefined {
  if (body && typeof body === "object" && "error" in body) {
    const detail = (body as { error?: unknown }).error;
    if (typeof detail === "string" && detail.length > 0) return detail;
  }
  return undefined;
}
