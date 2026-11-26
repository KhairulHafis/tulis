import { readFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { findNetworkUse } from "./find-network-use.js";
import { listCodeFiles } from "./list-code-files.js";

// Repo-relative paths of developer scripts that may use the network, such as
// the corpus fetch script. Every entry needs Code Lead review.
const ALLOWED_NETWORK_FILES: readonly string[] = [];

const repoRoot = fileURLToPath(new URL("../..", import.meta.url));
const codeFiles = listCodeFiles(repoRoot);

describe("network guard", () => {
  it("scans the repo code files", () => {
    expect(codeFiles.length).toBeGreaterThan(0);
    expect(codeFiles).toContain("packages/pena/src/index.ts");
  });

  it("has no stale allowlist entries", () => {
    const missing = ALLOWED_NETWORK_FILES.filter(
      (path) => !codeFiles.includes(path),
    );
    expect(missing).toEqual([]);
  });

  it("finds no network use outside the allowlist", () => {
    const problems: string[] = [];
    for (const path of codeFiles) {
      if (ALLOWED_NETWORK_FILES.includes(path)) continue;
      const text = readFileSync(join(repoRoot, path), "utf8");
      for (const use of findNetworkUse(path, text)) {
        problems.push(
          `${path}:${String(use.line)}:${String(use.column)} ${use.what}`,
        );
      }
    }
    expect(problems).toEqual([]);
  });
});
