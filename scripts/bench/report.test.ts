import { describe, expect, it } from "vitest";
import type { MeasurementResult } from "./harness.ts";
import {
  describeMachine,
  formatTable,
  reportToJson,
  resultFileName,
  type BenchReport,
} from "./report.ts";

const MB = 1024 * 1024;

const RESULTS: readonly MeasurementResult[] = [
  {
    name: "sort",
    description: "Sorts.",
    timing: { runs: 5, minMs: 1.23, medianMs: 2.5, maxMs: 10 },
    peakMemoryBytes: 100 * MB,
  },
  {
    name: "placeholder-sort",
    description: "Sorts placeholders.",
    timing: { runs: 10, minMs: 100.04, medianMs: 120, maxMs: 1234.56 },
    peakMemoryBytes: 5.5 * MB,
  },
];

describe("resultFileName", () => {
  it("formats the example time", () => {
    expect(resultFileName(new Date("2026-11-26T09:05:03.120Z"))).toBe(
      "bench-2026-11-26T09-05-03Z.json",
    );
  });

  it("zero-pads single-digit parts", () => {
    expect(resultFileName(new Date("2026-02-03T04:05:06.000Z"))).toBe(
      "bench-2026-02-03T04-05-06Z.json",
    );
  });
});

describe("formatTable", () => {
  it("formats two results exactly", () => {
    const expected = [
      "Measurement       Runs  Min (ms)  Median (ms)  Max (ms)  Peak memory (MB)",
      "----------------  ----  --------  -----------  --------  ----------------",
      "sort                 5       1.2          2.5      10.0             100.0",
      "placeholder-sort    10     100.0        120.0    1234.6               5.5",
      "",
    ].join("\n");
    expect(formatTable(RESULTS)).toBe(expected);
  });

  it("gives header and separator for an empty list", () => {
    expect(formatTable([])).toBe(
      [
        "Measurement  Runs  Min (ms)  Median (ms)  Max (ms)  Peak memory (MB)",
        "-----------  ----  --------  -----------  --------  ----------------",
        "",
      ].join("\n"),
    );
  });

  it("has no trailing spaces", () => {
    const lines = formatTable(RESULTS).split("\n");
    for (const line of lines) {
      expect(line).toBe(line.trimEnd());
    }
  });
});

describe("reportToJson", () => {
  it("round-trips and ends with exactly one newline", () => {
    const report: BenchReport = {
      formatVersion: 1,
      startedAt: "2026-11-26T09:05:03.120Z",
      tulisCommit: null,
      machine: describeMachine(),
      results: RESULTS,
    };
    const json = reportToJson(report);
    expect(JSON.parse(json)).toEqual(report);
    expect(json.endsWith("}\n")).toBe(true);
    expect(json.endsWith("\n\n")).toBe(false);
  });
});

describe("describeMachine", () => {
  it("returns fields of the right types", () => {
    const machine = describeMachine();
    expect(typeof machine.platform).toBe("string");
    expect(typeof machine.arch).toBe("string");
    expect(machine.cpuModel.length).toBeGreaterThan(0);
    expect(machine.cpuCount).toBeGreaterThanOrEqual(1);
    expect(machine.totalMemoryBytes).toBeGreaterThan(0);
    expect(machine.nodeVersion).toBe(process.version);
  });
});
