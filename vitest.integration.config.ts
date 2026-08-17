import { defineConfig } from "vitest/config";

/** Hits the live ecosyste.ms API. Not run in the default suite or on PRs. */
export default defineConfig({
  test: {
    include: ["test/integration/**/*.test.ts"],
    testTimeout: 30_000,
  },
});
