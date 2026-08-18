/**
 * Loaded instead of the real entry point when a bundler resolves the `browser` export
 * condition. Throws on import, because failing at build time beats failing silently at
 * runtime.
 *
 * ecosyste.ms sends an empty `Access-Control-Expose-Headers`, so a browser lets page
 * scripts read only the six CORS-safelisted response headers. This client needs `Link`
 * to follow pagination and `x-ratelimit-*` to report quota, and neither is readable:
 * every paginating method would return the first page and report success. Chrome also
 * drops a `User-Agent` override, so `from` cannot reach the polite pool there.
 *
 * Node, Deno, Bun and Cloudflare Workers are unaffected -- CORS is a browser policy.
 */
throw new Error(
  "@ecosyste-ms/ecosystems-ts does not run in browsers: the ecosyste.ms API does not " +
    "expose the Link or x-ratelimit-* response headers to cross-origin scripts, so " +
    "pagination would silently return only the first page. Call it from your server " +
    "(Node, Deno, Bun, Cloudflare Workers) and proxy the results to the browser.",
);
