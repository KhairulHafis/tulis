import { fileURLToPath } from "node:url";
import { defineConfig } from "vitest/config";

export default defineConfig({
  resolve: {
    alias: {
      // Use Pena's source so tests pass without a prior build.
      "@tulis/pena": fileURLToPath(
        new URL("./packages/pena/src/index.ts", import.meta.url),
      ),
    },
  },
  test: {
    include: ["packages/*/src/**/*.test.ts", "tests/**/*.test.ts"],
  },
});
