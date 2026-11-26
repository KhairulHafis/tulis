import { readdirSync } from "node:fs";
import { join } from "node:path";

const CODE_EXTENSIONS: readonly string[] = [
  ".ts",
  ".tsx",
  ".mts",
  ".cts",
  ".js",
  ".jsx",
  ".mjs",
  ".cjs",
];

const SKIPPED_DIRECTORIES: readonly string[] = [
  "node_modules",
  "dist",
  "coverage",
  ".cache",
  ".git",
];

function isCodeFile(name: string): boolean {
  return CODE_EXTENSIONS.some((extension) => name.endsWith(extension));
}

function walk(rootDir: string, relativeDir: string, found: string[]): void {
  const entries = readdirSync(join(rootDir, relativeDir), {
    withFileTypes: true,
  });
  for (const entry of entries) {
    // Never follow links, so the walk cannot leave the repo.
    if (entry.isSymbolicLink()) continue;
    const relativePath =
      relativeDir === "" ? entry.name : `${relativeDir}/${entry.name}`;
    if (entry.isDirectory()) {
      if (!SKIPPED_DIRECTORIES.includes(entry.name)) {
        walk(rootDir, relativePath, found);
      }
    } else if (entry.isFile() && isCodeFile(entry.name)) {
      found.push(relativePath);
    }
  }
}

export function listCodeFiles(rootDir: string): string[] {
  const found: string[] = [];
  walk(rootDir, "", found);
  return found.sort();
}
