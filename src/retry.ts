/**
 * Retry policy, ported constant-for-constant from ecosystems-go's `retryRoundTripper`.
 *
 * Placement matters: this wraps `fetch` itself and is handed to every openapi-fetch
 * client, so retries happen *below* the generated layer and every service gets them
 * without per-call code. That is exactly where Go put it (an `http.RoundTripper`).
 */

export const DEFAULT_RETRY_ATTEMPTS = 3;
export const DEFAULT_RETRY_BASE_DELAY_MS = 200;
export const DEFAULT_RETRY_MAX_DELAY_MS = 2_000;
export const BACKOFF_FACTOR = 2;
export const JITTER_DIVISOR = 4;

/**
 * Statuses worth retrying.
 *
 * 500 is deliberately absent. On this API a malformed PURL returns 500 rather than 400
 * (verified: `GET /packages/lookup?purl=garbage`), so retrying 5xx blindly would hammer
 * the service for an input error that can never succeed. ecosystems-go excludes it too.
 */
export const RETRYABLE_STATUS: ReadonlySet<number> = new Set([429, 502, 503, 504]);

/** Only idempotent methods are retried; `POST /packages/bulk_lookup` never is. */
export const RETRYABLE_METHODS: ReadonlySet<string> = new Set(["GET", "HEAD"]);

export type FetchLike = (request: Request) => Promise<Response>;

export interface RetryOptions {
  attempts?: number;
  baseDelayMs?: number;
  maxDelayMs?: number;
  /** Underlying fetch. Defaults to the global. */
  fetch?: typeof globalThis.fetch;
  /** Overridable for deterministic tests. Returns [0, 1). */
  random?: () => number;
  /** Overridable for deterministic tests. */
  sleep?: (ms: number, signal?: AbortSignal) => Promise<void>;
}

export function capDelay(delay: number, maxDelay: number): number {
  return maxDelay > 0 && delay > maxDelay ? maxDelay : delay;
}

export function jitter(delay: number, random: () => number = Math.random): number {
  if (delay <= 0) return 0;
  const spread = Math.floor(delay / JITTER_DIVISOR);
  if (spread <= 0) return delay;
  return delay + Math.floor(random() * spread);
}

/**
 * Exponential backoff with jitter.
 *
 * Note the Go behaviour this preserves: when the doubling saturates `maxDelay` we return
 * `maxDelay` *without* jitter, rather than jittering and then capping.
 */
export function backoffDelay(
  attempt: number,
  baseDelayMs = DEFAULT_RETRY_BASE_DELAY_MS,
  maxDelayMs = DEFAULT_RETRY_MAX_DELAY_MS,
  random: () => number = Math.random,
): number {
  const base = baseDelayMs > 0 ? baseDelayMs : DEFAULT_RETRY_BASE_DELAY_MS;
  const max = maxDelayMs > 0 ? maxDelayMs : DEFAULT_RETRY_MAX_DELAY_MS;

  let delay = base;
  for (let i = 0; i < attempt - 1; i++) {
    delay *= BACKOFF_FACTOR;
    if (delay >= max) return max;
  }
  return capDelay(jitter(delay, random), max);
}

/** Honours `Retry-After` in both the delta-seconds and HTTP-date forms. */
export function retryAfterDelay(
  header: string | null,
  fallbackMs: number,
  maxDelayMs: number,
  now: number = Date.now(),
): number {
  if (header === null || header.trim() === "") return fallbackMs;

  const seconds = Number(header.trim());
  if (Number.isInteger(seconds) && seconds >= 0) {
    return capDelay(seconds * 1000, maxDelayMs);
  }

  const at = Date.parse(header);
  if (!Number.isNaN(at)) {
    const delta = at - now;
    return delta > 0 ? capDelay(delta, maxDelayMs) : 0;
  }

  return fallbackMs;
}

export function sleep(ms: number, signal?: AbortSignal): Promise<void> {
  if (ms <= 0) return Promise.resolve();
  return new Promise((resolve, reject) => {
    if (signal?.aborted) {
      reject(signal.reason);
      return;
    }
    const timer = setTimeout(() => {
      signal?.removeEventListener("abort", onAbort);
      resolve();
    }, ms);
    function onAbort() {
      clearTimeout(timer);
      reject(signal?.reason);
    }
    signal?.addEventListener("abort", onAbort, { once: true });
  });
}

/** Releases the connection without buffering a response body we are about to discard. */
export async function drain(response: Response): Promise<void> {
  try {
    await response.body?.cancel();
  } catch {
    // Already closed; nothing to release.
  }
}

/**
 * Wraps a fetch implementation with the retry policy above.
 *
 * Cloning is trivially safe here because only GET/HEAD are retried, and those carry no
 * body -- the concern that forces `req.Clone()` in Go does not arise.
 */
export function createRetryingFetch(options: RetryOptions = {}): FetchLike {
  const {
    attempts = DEFAULT_RETRY_ATTEMPTS,
    baseDelayMs = DEFAULT_RETRY_BASE_DELAY_MS,
    maxDelayMs = DEFAULT_RETRY_MAX_DELAY_MS,
    fetch: baseFetch = globalThis.fetch,
    random = Math.random,
    sleep: sleepFn = sleep,
  } = options;

  const total = attempts > 0 ? attempts : DEFAULT_RETRY_ATTEMPTS;

  return async function retryingFetch(request: Request): Promise<Response> {
    if (!RETRYABLE_METHODS.has(request.method.toUpperCase())) {
      return baseFetch(request);
    }

    let lastError: unknown;

    for (let attempt = 1; attempt <= total; attempt++) {
      // DIVERGENCE FROM ecosystems-go: Go returns the previous attempt's transport error
      // in preference to the context error, which reports `connection reset` for a call
      // that was actually cancelled or timed out. The abort reason wins here, so callers
      // can tell cancellation from failure -- it matters more now that `timeoutMs` fires
      // per request.
      if (request.signal.aborted) {
        throw request.signal.reason ?? lastError;
      }

      let response: Response | undefined;
      let error: unknown;
      try {
        response = await baseFetch(request.clone());
      } catch (err) {
        error = err;
      }

      if (response && !RETRYABLE_STATUS.has(response.status)) {
        return response;
      }

      if (attempt === total) {
        if (response) return response;
        throw error;
      }

      let delay = backoffDelay(attempt, baseDelayMs, maxDelayMs, random);
      if (error) {
        lastError = error;
      } else if (response) {
        delay = retryAfterDelay(response.headers.get("retry-after"), delay, maxDelayMs);
        await drain(response);
      }

      await sleepFn(delay, request.signal);
    }

    throw lastError;
  };
}
