import { defineConfig } from "vitest/config";

/**
 * Unit tests only. Integration tests hit the live API and are excluded here, the same way
 * ecosystems-go puts them behind a `//go:build integration` tag so `go test ./...` never
 * touches the network. Run them with `npm run test:integration`.
 */
export default defineConfig({
  test: {
    include: ["test/**/*.test.ts"],
    exclude: ["test/integration/**"],
  },
});
