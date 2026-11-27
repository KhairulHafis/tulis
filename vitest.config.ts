import { fileURLToPath } from "node:url";
import { defineConfig } from "vitest/config";

export default defineConfig({
  resolve: {
    alias: {
      // Use the packages' source so tests pass without a prior build.
      "@tulis/pena": fileURLToPath(
        new URL("./packages/pena/src/index.ts", import.meta.url),
      ),
      "@tulis/testkit": fileURLToPath(
        new URL("./packages/testkit/src/index.ts", import.meta.url),
      ),
    },
  },
  test: {
    // Worker threads started by tests need this hook to load Pena's .ts source.
    execArgv: [
      // Pena's source uses parameter properties, which type stripping rejects.
      "--experimental-transform-types",
      "--disable-warning=ExperimentalWarning",
      "--import",
      new URL("./tests/setup/ts-source-hook.js", import.meta.url).href,
    ],
    include: [
      "packages/*/src/**/*.test.ts",
      "tests/**/*.test.ts",
      "scripts/**/*.test.ts",
    ],
  },
});
