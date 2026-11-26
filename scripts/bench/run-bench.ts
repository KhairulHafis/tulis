import { execFile } from "node:child_process";
import { lstatSync, mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import type { Measurement, MeasurementResult } from "./harness.ts";
import { reportToJson, resultFileName } from "./report.ts";
import type { BenchReport, MachineInfo } from "./report.ts";

/** Runs one measurement in a fresh process and resolves with its stdout. */
export type ChildRunner = (measurementName: string) => Promise<string>;

const CHILD_TIMEOUT_MS = 10 * 60 * 1000;
const CHILD_MAX_BUFFER = 1024 * 1024;

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function fail(measurementName: string, field: string): never {
  throw new Error(
    `Bad result from measurement "${measurementName}": invalid ${field}`,
  );
}

function readString(
  measurementName: string,
  source: Record<string, unknown>,
  field: string,
): string {
  const value = source[field];
  if (typeof value !== "string") {
    return fail(measurementName, field);
  }
  return value;
}

function readNumber(
  measurementName: string,
  source: Record<string, unknown>,
  field: string,
  label: string,
): number {
  const value = source[field];
  if (typeof value !== "number" || !Number.isFinite(value) || value < 0) {
    return fail(measurementName, label);
  }
  return value;
}

/** Parses and strictly checks a child's stdout as a MeasurementResult. Throws an Error naming the measurement and the bad field. */
export function parseMeasurementResult(
  measurementName: string,
  stdout: string,
): MeasurementResult {
  let data: unknown;
  try {
    data = JSON.parse(stdout);
  } catch (error) {
    throw new Error(
      `Bad result from measurement "${measurementName}": output is not valid JSON`,
      { cause: error },
    );
  }
  if (!isRecord(data)) {
    return fail(measurementName, "result");
  }
  const name = readString(measurementName, data, "name");
  const description = readString(measurementName, data, "description");
  const timing = data["timing"];
  if (!isRecord(timing)) {
    return fail(measurementName, "timing");
  }
  const runs = readNumber(measurementName, timing, "runs", "timing.runs");
  if (!Number.isInteger(runs) || runs < 1) {
    return fail(measurementName, "timing.runs");
  }
  const minMs = readNumber(measurementName, timing, "minMs", "timing.minMs");
  const medianMs = readNumber(
    measurementName,
    timing,
    "medianMs",
    "timing.medianMs",
  );
  const maxMs = readNumber(measurementName, timing, "maxMs", "timing.maxMs");
  const peakMemoryBytes = readNumber(
    measurementName,
    data,
    "peakMemoryBytes",
    "peakMemoryBytes",
  );
  return {
    name,
    description,
    timing: { runs, minMs, medianMs, maxMs },
    peakMemoryBytes,
  };
}

export interface RunBenchOptions {
  readonly measurements: readonly Measurement[];
  readonly runChild: ChildRunner;
  readonly startedAt: Date;
  readonly tulisCommit: string | null;
  readonly machine: MachineInfo;
  /** Called before each measurement starts, for progress lines. */
  readonly onStart?: (measurement: Measurement) => void;
}

/** Runs every measurement one after another and builds the report. */
export async function runBench(options: RunBenchOptions): Promise<BenchReport> {
  const results: MeasurementResult[] = [];
  for (const measurement of options.measurements) {
    options.onStart?.(measurement);
    const stdout = await options.runChild(measurement.name);
    const result = parseMeasurementResult(measurement.name, stdout);
    if (result.name !== measurement.name) {
      throw new Error(
        `Measurement "${measurement.name}" returned a result named "${result.name}"`,
      );
    }
    results.push(result);
  }
  return {
    formatVersion: 1,
    startedAt: options.startedAt.toISOString(),
    tulisCommit: options.tulisCommit,
    machine: options.machine,
    results,
  };
}

function ensureDirectory(dir: string): void {
  const existing = lstatSync(dir, { throwIfNoEntry: false });
  if (existing === undefined) {
    mkdirSync(dir, { recursive: true });
    return;
  }
  if (existing.isSymbolicLink() || !existing.isDirectory()) {
    throw new Error(`${dir} must be a real folder, not a link or a file`);
  }
}

/** Writes the report into `dir` and returns the file path. Refuses to overwrite. */
export function saveReport(report: BenchReport, dir: string): string {
  ensureDirectory(dir);
  const filePath = join(dir, resultFileName(new Date(report.startedAt)));
  writeFileSync(filePath, reportToJson(report), { flag: "wx" });
  return filePath;
}

/** Real ChildRunner using a fresh Node process per measurement. */
export function createChildRunner(runOnePath: string): ChildRunner {
  return (measurementName) =>
    new Promise<string>((resolve, reject) => {
      execFile(
        process.execPath,
        [runOnePath, measurementName],
        {
          timeout: CHILD_TIMEOUT_MS,
          maxBuffer: CHILD_MAX_BUFFER,
          windowsHide: true,
        },
        (error, stdout, stderr) => {
          if (error === null) {
            resolve(stdout);
            return;
          }
          const detail = stderr.trim();
          reject(
            new Error(
              `Measurement "${measurementName}" failed${detail === "" ? "" : `: ${detail}`}`,
              { cause: error },
            ),
          );
        },
      );
    });
}
