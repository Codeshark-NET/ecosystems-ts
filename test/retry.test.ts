import { describe, expect, it } from "vitest";

import {
  backoffDelay,
  createRetryingFetch,
  DEFAULT_RETRY_MAX_DELAY_MS,
  RETRYABLE_METHODS,
  RETRYABLE_STATUS,
  retryAfterDelay,
} from "../src/retry.js";

describe("backoffDelay", () => {
  // Port of TestBackoffDelayHonorsMaxDelay.
  it("never exceeds maxDelay", () => {
    for (let i = 0; i < 100; i++) {
      expect(backoffDelay(10, 100, 1000)).toBeLessThanOrEqual(1000);
    }
  });

  it("grows exponentially from the base delay", () => {
    const noJitter = () => 0;
    expect(backoffDelay(1, 200, 10_000, noJitter)).toBe(200);
    expect(backoffDelay(2, 200, 10_000, noJitter)).toBe(400);
    expect(backoffDelay(3, 200, 10_000, noJitter)).toBe(800);
  });

  it("adds at most delay/4 of jitter", () => {
    const maxRandom = () => 0.999999;
    expect(backoffDelay(1, 200, 10_000, maxRandom)).toBeLessThanOrEqual(250);
    expect(backoffDelay(1, 200, 10_000, maxRandom)).toBeGreaterThan(200);
  });

  it("falls back to defaults for non-positive inputs", () => {
    expect(backoffDelay(1, 0, 0, () => 0)).toBe(200);
    expect(backoffDelay(99, 200, 0, () => 0)).toBe(DEFAULT_RETRY_MAX_DELAY_MS);
  });
});

describe("retryAfterDelay", () => {
  it("returns the fallback when absent or unparseable", () => {
    expect(retryAfterDelay(null, 123, 10_000)).toBe(123);
    expect(retryAfterDelay("", 123, 10_000)).toBe(123);
    expect(retryAfterDelay("soon", 123, 10_000)).toBe(123);
  });

  it("parses delta-seconds", () => {
    expect(retryAfterDelay("2", 123, 10_000)).toBe(2000);
  });

  it("parses an HTTP-date", () => {
    const now = Date.parse("2026-08-16T00:00:00Z");
    expect(retryAfterDelay("Sun, 16 Aug 2026 00:00:05 GMT", 123, 10_000, now)).toBe(5000);
  });

  it("treats a past HTTP-date as no delay", () => {
    const now = Date.parse("2026-08-16T00:00:10Z");
    expect(retryAfterDelay("Sun, 16 Aug 2026 00:00:05 GMT", 123, 10_000, now)).toBe(0);
  });

  it("caps at maxDelay", () => {
    expect(retryAfterDelay("3600", 123, 2000)).toBe(2000);
  });
});

describe("retry policy", () => {
  it("retries exactly the statuses ecosystems-go retries", () => {
    expect([...RETRYABLE_STATUS].sort()).toEqual([429, 502, 503, 504]);
  });

  // 500 is load-bearing: this API returns 500 for a malformed PURL, so retrying it would
  // hammer the service for an input error that can never succeed.
  it("does not retry 500", () => {
    expect(RETRYABLE_STATUS.has(500)).toBe(false);
  });

  it("only retries idempotent methods", () => {
    expect([...RETRYABLE_METHODS].sort()).toEqual(["GET", "HEAD"]);
  });
});

describe("createRetryingFetch", () => {
  const nap = () => Promise.resolve();

  it("retries a GET until it succeeds", async () => {
    let calls = 0;
    const fetchImpl = async () => {
      calls++;
      return new Response("", { status: calls < 3 ? 503 : 200 });
    };
    const retrying = createRetryingFetch({ fetch: fetchImpl as typeof fetch, sleep: nap });

    const res = await retrying(new Request("http://x.test/"));
    expect(res.status).toBe(200);
    expect(calls).toBe(3);
  });

  it("gives up after the attempt budget and returns the last response", async () => {
    let calls = 0;
    const fetchImpl = async () => {
      calls++;
      return new Response("", { status: 503 });
    };
    const retrying = createRetryingFetch({ fetch: fetchImpl as typeof fetch, sleep: nap });

    const res = await retrying(new Request("http://x.test/"));
    expect(res.status).toBe(503);
    expect(calls).toBe(3);
  });

  it("does not retry a POST", async () => {
    let calls = 0;
    const fetchImpl = async () => {
      calls++;
      return new Response("", { status: 503 });
    };
    const retrying = createRetryingFetch({ fetch: fetchImpl as typeof fetch, sleep: nap });

    await retrying(new Request("http://x.test/", { method: "POST", body: "{}" }));
    expect(calls).toBe(1);
  });

  it("rethrows a transport error after exhausting attempts", async () => {
    let calls = 0;
    const fetchImpl = async () => {
      calls++;
      throw new TypeError("fetch failed");
    };
    const retrying = createRetryingFetch({ fetch: fetchImpl as typeof fetch, sleep: nap });

    await expect(retrying(new Request("http://x.test/"))).rejects.toThrow("fetch failed");
    expect(calls).toBe(3);
  });

  it("honours Retry-After over computed backoff", async () => {
    const delays: number[] = [];
    let calls = 0;
    const fetchImpl = async () => {
      calls++;
      return calls === 1
        ? new Response("", { status: 429, headers: { "retry-after": "1" } })
        : new Response("", { status: 200 });
    };
    const retrying = createRetryingFetch({
      fetch: fetchImpl as typeof fetch,
      sleep: async (ms) => {
        delays.push(ms);
      },
    });

    await retrying(new Request("http://x.test/"));
    expect(delays).toEqual([1000]);
  });
});

describe("abort reporting", () => {
  it("reports the abort reason rather than a stale transport error", async () => {
    // DIVERGENCE FROM ecosystems-go: Go returns the previous attempt's error, which
    // reports a network failure for a call that actually timed out.
    const controller = new AbortController();
    const fetchImpl = async () => {
      throw new TypeError("fetch failed");
    };
    const retrying = createRetryingFetch({
      fetch: fetchImpl as unknown as typeof globalThis.fetch,
      baseDelayMs: 1,
      maxDelayMs: 2,
      sleep: async () => controller.abort(new Error("deadline exceeded")),
    });

    await expect(
      retrying(new Request("http://127.0.0.1:1/", { signal: controller.signal })),
    ).rejects.toThrow(/deadline exceeded/);
  });
});
