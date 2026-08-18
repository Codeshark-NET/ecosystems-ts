/**
 * Loaded instead of the real entry point when a bundler resolves the `browser` export
 * condition, so the failure is loud at build time rather than silent at runtime.
 *
 * ecosyste.ms sends an empty `Access-Control-Expose-Headers`. Node, Deno, Bun and
 * Cloudflare Workers are unaffected -- CORS is a browser policy. See FOLLOWUPS.md §4.
 */
throw new Error(
  "@ecosyste-ms/ecosystems-ts does not run in browsers: the ecosyste.ms API does not " +
    "expose the Link or x-ratelimit-* response headers to cross-origin scripts, so " +
    "pagination would silently return only the first page. Call it from your server " +
    "(Node, Deno, Bun, Cloudflare Workers) and proxy the results to the browser.",
);
