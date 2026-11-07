import { defineConfig } from "vitest/config";

// Database tests: run by scripts/db-test.sh after it has built a throwaway Postgres.
export default defineConfig({
  test: {
    include: ["tests/db/**/*.test.ts"],
    fileParallelism: false,
    testTimeout: 20_000,
  },
});
