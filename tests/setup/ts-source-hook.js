// Test-only module hook. Worker threads do not go through Vitest's transform,
// and Pena's source imports siblings as "./x.js" although only "./x.ts"
// exists next to it. This maps such an import to the .ts file, but only when
// the .ts file exists and the .js file does not. It covers imports from a
// .ts file and the worker's own entry file (which has no importing file).
// Vitest loads it with --import, and worker threads inherit that option.
import { existsSync } from "node:fs";
import { registerHooks } from "node:module";
import { fileURLToPath, URL } from "node:url";

function candidateFor(specifier, parent) {
  if (!specifier.endsWith(".js")) {
    return undefined;
  }
  if (parent === undefined) {
    return specifier.startsWith("file:") ? specifier : undefined;
  }
  if (
    parent.startsWith("file:") &&
    parent.endsWith(".ts") &&
    (specifier.startsWith("./") || specifier.startsWith("../"))
  ) {
    return new URL(specifier, parent).href;
  }
  return undefined;
}

registerHooks({
  resolve(specifier, context, nextResolve) {
    const js = candidateFor(specifier, context.parentURL);
    if (js !== undefined) {
      const ts = js.slice(0, -3) + ".ts";
      if (!existsSync(fileURLToPath(js)) && existsSync(fileURLToPath(ts))) {
        return nextResolve(ts, context);
      }
    }
    return nextResolve(specifier, context);
  },
});
