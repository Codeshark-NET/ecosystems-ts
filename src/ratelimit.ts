/**
 * Rate-limit state parsed from the `x-ratelimit-*` response headers.
 *
 * None of these headers appear in any ecosyste.ms OpenAPI spec -- they were found by
 * inspecting live responses. ecosystems-go discards them entirely.
 *
 * IMPORTANT: do not build control flow on these values. Responses are CDN-cached
 * (`Cache-Control: public, max-age=86400`, Cloudflare + APISIX in front), so on a cache
 * HIT you receive the *cached* response's rate-limit headers, not your own. Observed
 * live: identical requests reporting contradictory tiers depending on cache state.
 *
 * For real backpressure, react to HTTP 429 and `Retry-After` -- which the retry layer
 * already does.
 */
export interface RateLimit {
  /** Requests allowed in the current window. */
  limit: number | null;
  /** Requests left in the current window. */
  remaining: number | null;
  /** When the window resets. */
  reset: Date | null;
  /** `"polite"` (identified, ~15000/hr) or `"anonymous"` (~5000/hr). */
  tier: string | null;
  /** `"anonymous"`, or an account identifier when authenticated. */
  consumer: string | null;
}

function int(headers: Headers, name: string): number | null {
  const raw = headers.get(name);
  if (raw === null) return null;
  const value = Number.parseInt(raw, 10);
  return Number.isFinite(value) ? value : null;
}

/** Parses `x-ratelimit-*` headers. Returns null when the response carries none. */
export function parseRateLimit(headers: Headers): RateLimit | null {
  const limit = int(headers, "x-ratelimit-limit");
  const remaining = int(headers, "x-ratelimit-remaining");
  const resetSeconds = int(headers, "x-ratelimit-reset");
  const tier = headers.get("x-ratelimit-tier");
  const consumer = headers.get("x-ratelimit-consumer");

  if (limit === null && remaining === null && resetSeconds === null && tier === null) {
    return null;
  }

  return {
    limit,
    remaining,
    reset: resetSeconds === null ? null : new Date(resetSeconds * 1000),
    tier,
    consumer,
  };
}
