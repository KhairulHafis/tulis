import { arch, availableParallelism, cpus, platform, totalmem } from "node:os";
import type { MeasurementResult } from "./harness.ts";

export interface MachineInfo {
  readonly platform: string;
  readonly arch: string;
  /** First CPU model, trimmed, or "unknown". */
  readonly cpuModel: string;
  readonly cpuCount: number;
  readonly totalMemoryBytes: number;
  readonly nodeVersion: string;
}

export interface BenchReport {
  /** Format version of this JSON file. */
  readonly formatVersion: 1;
  /** ISO 8601 time the run started. */
  readonly startedAt: string;
  /** Full SHA of the Tulis commit, or null if unknown. */
  readonly tulisCommit: string | null;
  readonly machine: MachineInfo;
  readonly results: readonly MeasurementResult[];
}

export function describeMachine(): MachineInfo {
  const model = cpus()[0]?.model.trim() ?? "";
  return {
    platform: platform(),
    arch: arch(),
    cpuModel: model === "" ? "unknown" : model,
    cpuCount: availableParallelism(),
    totalMemoryBytes: totalmem(),
    nodeVersion: process.version,
  };
}

/** JSON.stringify(report, null, 2) followed by one newline. */
export function reportToJson(report: BenchReport): string {
  return `${JSON.stringify(report, null, 2)}\n`;
}

/** For example 2026-11-26T09:05:03.120Z -> "bench-2026-11-26T09-05-03Z.json". Uses UTC. */
export function resultFileName(startedAt: Date): string {
  const stamp = startedAt.toISOString().slice(0, 19).replaceAll(":", "-");
  return `bench-${stamp}Z.json`;
}

const HEADERS = [
  "Measurement",
  "Runs",
  "Min (ms)",
  "Median (ms)",
  "Max (ms)",
  "Peak memory (MB)",
] as const;

function formatMs(value: number): string {
  return value.toFixed(1);
}

function formatMegabytes(bytes: number): string {
  return (bytes / 1024 / 1024).toFixed(1);
}

/** A plain-text table with one row per result. */
export function formatTable(results: readonly MeasurementResult[]): string {
  const rows: string[][] = results.map((result) => [
    result.name,
    String(result.timing.runs),
    formatMs(result.timing.minMs),
    formatMs(result.timing.medianMs),
    formatMs(result.timing.maxMs),
    formatMegabytes(result.peakMemoryBytes),
  ]);

  const widths = HEADERS.map((header, column) =>
    Math.max(header.length, ...rows.map((row) => row[column]?.length ?? 0)),
  );

  const formatRow = (cells: readonly string[]): string =>
    cells
      .map((cell, column) => {
        const width = widths[column] ?? 0;
        return column === 0 ? cell.padEnd(width) : cell.padStart(width);
      })
      .join("  ")
      .trimEnd();

  const lines = [
    formatRow(HEADERS),
    formatRow(widths.map((width) => "-".repeat(width))),
    ...rows.map(formatRow),
  ];
  return `${lines.join("\n")}\n`;
}
