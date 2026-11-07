import { fileURLToPath } from "node:url";
import { defineConfig } from "vitest/config";

// Unit tests (no database). Database tests live in tests/db and run via `npm run test:db`.
export default defineConfig({
  resolve: { alias: { "@": fileURLToPath(new URL(".", import.meta.url)) } },
  test: {
    include: ["lib/**/*.test.ts", "components/**/*.test.ts", "app/**/*.test.ts"],
  },
});
