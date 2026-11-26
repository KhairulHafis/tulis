import { basename, join } from "node:path";
import { fileURLToPath } from "node:url";
import { createGitRunner } from "../corpora/fetch-corpus.ts";
import { MEASUREMENTS } from "./measurements.ts";
import { createChildRunner, runBench, saveReport } from "./run-bench.ts";
import { describeMachine, formatTable } from "./report.ts";

const root = fileURLToPath(new URL("../..", import.meta.url));
const COMMIT_PATTERN = /^[0-9a-f]{40}$/;

async function readTulisCommit(): Promise<string | null> {
  try {
    const output = await createGitRunner()(["rev-parse", "HEAD"], root, 10_000);
    const commit = output.trim();
    return COMMIT_PATTERN.test(commit) ? commit : null;
  } catch {
    return null;
  }
}

try {
  const startedAt = new Date();
  const report = await runBench({
    measurements: MEASUREMENTS,
    runChild: createChildRunner(join(root, "scripts", "bench", "run-one.ts")),
    startedAt,
    tulisCommit: await readTulisCommit(),
    machine: describeMachine(),
    onStart: (measurement) => {
      console.log(`Running ${measurement.name}...`);
    },
  });
  const filePath = saveReport(report, join(root, ".cache", "bench"));
  console.log("");
  console.log(formatTable(report.results));
  console.log(`Saved results to .cache/bench/${basename(filePath)}`);
} catch (error) {
  const message = error instanceof Error ? error.message : "unknown error";
  console.error(`Bench failed: ${message}`);
  process.exitCode = 1;
}
