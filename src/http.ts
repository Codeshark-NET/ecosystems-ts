import { parseRateLimit, type RateLimit } from "./ratelimit.js";
import { createRetryingFetch, type FetchLike, type RetryOptions } from "./retry.js";

export interface Identity {
  /** Required. Identifies your application, e.g. `"my-app/1.0"`. */
  userAgent: string;
  /** Email address. Moves you from the anonymous pool (~5000/hr) to polite (~15000/hr). */
  from?: string | undefined;
  /** Sent as `Authorization: Bearer`. Undocumented by ecosyste.ms; see README. */
  apiKey?: string | undefined;
}

/**
 * Applies identification headers.
 *
 * What actually earns the polite pool is the email in the **User-Agent**. Measured live
 * on 2026-08-16, every sample a `cf-cache-status: MISS`:
 *
 * ```
 * plain UA             anonymous  5000
 * From: you@example    anonymous  5000   <-- no effect
 * UA "(mailto:you@…)"  polite    15000
 * ?mailto=you@example  polite    15000
 * ```
 *
 * So the `From` header ecosystems-go relies on does not work, and that library is in the
 * anonymous pool despite `WithFrom`. We send `From` anyway because it is the polite HTTP
 * convention and costs nothing, but the User-Agent suffix is what does the work.
 *
 * The `?mailto=` query parameter also works and is deliberately not used: the CDN sends
 * `Vary: Origin` only, so a URL parameter creates a per-email cache entry and fragments
 * the shared cache for everyone, while a User-Agent carries no cache cost at all.
 */
export function applyIdentity(headers: Headers, identity: Identity): void {
  const { userAgent, from, apiKey } = identity;

  headers.set("User-Agent", from ? `${userAgent} (mailto:${from})` : userAgent);
  if (from) headers.set("From", from);
  if (apiKey) headers.set("Authorization", `Bearer ${apiKey}`);
  if (!headers.has("Accept")) headers.set("Accept", "application/json");
}

/**
 * `AbortSignal.any` where available (Node >= 20.3), hand-rolled where it is not.
 *
 * Returns a `dispose` because the fallback attaches listeners to signals it does not own:
 * a caller who holds one long-lived AbortController across many requests would otherwise
 * accumulate a listener per request for the lifetime of that controller.
 */
export function anySignal(signals: AbortSignal[]): {
  signal: AbortSignal;
  dispose: () => void;
} {
  if (typeof AbortSignal.any === "function") {
    return { signal: AbortSignal.any(signals), dispose: () => {} };
  }

  const controller = new AbortController();
  const listeners: Array<() => void> = [];

  for (const signal of signals) {
    if (signal.aborted) {
      controller.abort(signal.reason);
      break;
    }
    const onAbort = () => controller.abort(signal.reason);
    signal.addEventListener("abort", onAbort, { once: true });
    listeners.push(() => signal.removeEventListener("abort", onAbort));
  }

  return {
    signal: controller.signal,
    dispose: () => {
      for (const remove of listeners) remove();
      listeners.length = 0;
    },
  };
}

export interface EcosystemsFetchOptions {
  identity: Identity;
  /**
   * Deadline for one HTTP request, including its retries and backoff sleeps. `0` disables.
   *
   * Placed here rather than in the facade so that it matches Go's `http.Client.Timeout`,
   * which covers a single `Do` call: every bulk batch and every followed page gets its
   * own budget. A whole-operation deadline is the caller's to impose, with
   * `{ signal: AbortSignal.timeout(ms) }` -- the analogue of `context.WithTimeout`.
   */
  timeoutMs?: number;
  retry?: RetryOptions | false;
  fetch?: typeof globalThis.fetch;
  /** Called for every response, including manually-followed pagination requests. */
  onResponse?: (rateLimit: RateLimit | null, response: Response) => void;
}

/**
 * Builds the single fetch used by all five service clients *and* by the pagination
 * follower.
 *
 * Doing identity and rate-limit capture here rather than in an openapi-fetch middleware
 * is a deliberate, small divergence from ecosystems-go, which duplicates its header logic
 * between `addHeaders` (for the generated clients) and `setHeaders` (for manual
 * `Link`-followed requests) -- and has a test guarding against the two drifting apart.
 * One layer, one implementation, no drift possible.
 */
export function createEcosystemsFetch(options: EcosystemsFetchOptions): FetchLike {
  const { identity, retry, onResponse, timeoutMs = 0 } = options;
  const baseFetch = options.fetch ?? globalThis.fetch;

  const transport: FetchLike =
    retry === false
      ? (request) => baseFetch(request)
      : createRetryingFetch({ ...retry, fetch: baseFetch });

  return async function ecosystemsFetch(request: Request): Promise<Response> {
    // Headers are mutated in place rather than rebuilt. Do NOT reach for
    // `new Request(url, { ...request, headers })` here: Request exposes its properties as
    // prototype getters, so the spread yields `{}` and silently drops method, body and
    // signal -- turning `POST /packages/bulk_lookup` into a bodyless GET. Passing the
    // Request itself as init works, because init is read by property access.
    applyIdentity(request.headers, identity);

    // The deadline starts here, so it covers this request's retries and the sleeps
    // between them, and nothing else.
    let outgoing = request;
    let dispose = () => {};
    if (timeoutMs > 0) {
      const combined = anySignal([request.signal, AbortSignal.timeout(timeoutMs)]);
      dispose = combined.dispose;
      outgoing = new Request(request, { signal: combined.signal });
    }

    try {
      const response = await transport(outgoing);
      onResponse?.(parseRateLimit(response.headers), response);
      return response;
    } finally {
      dispose();
    }
  };
}
