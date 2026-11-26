import { mkdirSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { fetchAllCorpora, createGitRunner } from "./fetch-corpus.ts";
import { loadCorpusList } from "./corpus-list.ts";

const root = fileURLToPath(new URL("../..", import.meta.url));

try {
  const corpora = loadCorpusList(
    join(root, "scripts", "corpora", "corpora.json"),
  );
  const cacheDir = join(root, ".cache", "corpora");
  mkdirSync(cacheDir, { recursive: true });
  await fetchAllCorpora(corpora, cacheDir, createGitRunner(), console.log);
} catch (error) {
  const message = error instanceof Error ? error.message : "unknown error";
  console.error(`Corpus fetch failed: ${message}`);
  process.exitCode = 1;
}
