import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import type { Measurement, MeasurementResult } from "./harness.ts";
import { reportToJson, resultFileName } from "./report.ts";
import type { BenchReport, MachineInfo } from "./report.ts";
import {
  createChildRunner,
  parseMeasurementResult,
  runBench,
  saveReport,
} from "./run-bench.ts";

function goodResult(name = "a-one"): MeasurementResult {
  return {
    name,
    description: "d",
    timing: { runs: 3, minMs: 1, medianMs: 2, maxMs: 3 },
    peakMemoryBytes: 1000,
  };
}

const machine: MachineInfo = {
  platform: "test",
  arch: "x64",
  cpuModel: "cpu",
  cpuCount: 1,
  totalMemoryBytes: 1,
  nodeVersion: "v22",
};

function measurement(name: string): Measurement {
  return { name, description: "d", warmups: 0, iterations: 1, run: () => {} };
}

describe("parseMeasurementResult", () => {
  it("accepts a good result", () => {
    const result = goodResult();
    expect(parseMeasurementResult("a-one", JSON.stringify(result))).toEqual(
      result,
    );
  });

  it("rejects bad JSON", () => {
    expect(() => parseMeasurementResult("a-one", "{nope")).toThrow(/a-one/);
  });

  it("rejects a missing field", () => {
    const rest = { ...goodResult(), description: undefined };
    expect(() => parseMeasurementResult("a-one", JSON.stringify(rest))).toThrow(
      /description/,
    );
  });

  it("rejects a string number", () => {
    const bad = { ...goodResult(), peakMemoryBytes: "1000" };
    expect(() => parseMeasurementResult("a-one", JSON.stringify(bad))).toThrow(
      /peakMemoryBytes/,
    );
  });

  it("rejects a negative time", () => {
    const bad = {
      ...goodResult(),
      timing: { runs: 3, minMs: -1, medianMs: 2, maxMs: 3 },
    };
    expect(() => parseMeasurementResult("a-one", JSON.stringify(bad))).toThrow(
      /timing.minMs/,
    );
  });

  it("rejects runs of 0", () => {
    const bad = {
      ...goodResult(),
      timing: { runs: 0, minMs: 1, medianMs: 2, maxMs: 3 },
    };
    expect(() => parseMeasurementResult("a-one", JSON.stringify(bad))).toThrow(
      /timing.runs/,
    );
  });

  it("rejects negative memory and non-finite numbers", () => {
    const negative = { ...goodResult(), peakMemoryBytes: -1 };
    expect(() =>
      parseMeasurementResult("a-one", JSON.stringify(negative)),
    ).toThrow(/peakMemoryBytes/);
    const infinite = JSON.stringify(goodResult()).replace(
      '"maxMs":3',
      '"maxMs":1e999',
    );
    expect(() => parseMeasurementResult("a-one", infinite)).toThrow(
      /timing.maxMs/,
    );
  });
});

describe("runBench", () => {
  const startedAt = new Date("2026-11-26T09:05:03.120Z");

  it("runs one at a time, in order, and builds the report", async () => {
    const events: string[] = [];
    const started: string[] = [];
    const report = await runBench({
      measurements: [measurement("a-one"), measurement("b-two")],
      runChild: async (name) => {
        events.push(`start ${name}`);
        await new Promise((resolve) => setTimeout(resolve, 10));
        events.push(`end ${name}`);
        return JSON.stringify(goodResult(name));
      },
      startedAt,
      tulisCommit: "a".repeat(40),
      machine,
      onStart: (m) => {
        started.push(m.name);
      },
    });
    expect(events).toEqual([
      "start a-one",
      "end a-one",
      "start b-two",
      "end b-two",
    ]);
    expect(started).toEqual(["a-one", "b-two"]);
    expect(report.formatVersion).toBe(1);
    expect(report.startedAt).toBe("2026-11-26T09:05:03.120Z");
    expect(report.tulisCommit).toBe("a".repeat(40));
    expect(report.machine).toEqual(machine);
    expect(report.results.map((r) => r.name)).toEqual(["a-one", "b-two"]);
  });

  it("rejects when a result has a different name", async () => {
    await expect(
      runBench({
        measurements: [measurement("a-one")],
        runChild: () => Promise.resolve(JSON.stringify(goodResult("other"))),
        startedAt,
        tulisCommit: null,
        machine,
      }),
    ).rejects.toThrow(/a-one/);
  });
});

describe("saveReport", () => {
  let tmp: string;
  const report: BenchReport = {
    formatVersion: 1,
    startedAt: "2026-11-26T09:05:03.120Z",
    tulisCommit: null,
    machine,
    results: [goodResult()],
  };

  beforeEach(() => {
    tmp = mkdtempSync(join(tmpdir(), "tulis-bench-"));
  });
  afterEach(() => {
    rmSync(tmp, { recursive: true, force: true });
  });

  it("writes the file with the right name and content", () => {
    const path = saveReport(report, tmp);
    expect(path).toBe(join(tmp, resultFileName(new Date(report.startedAt))));
    expect(readFileSync(path, "utf8")).toBe(reportToJson(report));
  });

  it("creates a missing folder", () => {
    const dir = join(tmp, "a", "b");
    const path = saveReport(report, dir);
    expect(existsSync(path)).toBe(true);
  });

  it("refuses an existing file", () => {
    const path = saveReport(report, tmp);
    expect(() => saveReport(report, tmp)).toThrow();
    expect(readFileSync(path, "utf8")).toBe(reportToJson(report));
  });

  it("refuses a symbolic link folder", () => {
    const target = join(tmp, "target");
    mkdirSync(target);
    const link = join(tmp, "link");
    symlinkSync(target, link, "junction");
    expect(() => saveReport(report, link)).toThrow(/link/);
    expect(
      existsSync(join(target, resultFileName(new Date(report.startedAt)))),
    ).toBe(false);
  });

  it("refuses when the path is a file", () => {
    const file = join(tmp, "file");
    writeFileSync(file, "x");
    expect(() => saveReport(report, file)).toThrow();
  });
});

describe("createChildRunner end to end", () => {
  const runOnePath = fileURLToPath(new URL("./run-one.ts", import.meta.url));

  it("runs placeholder-sort in a fresh process", async () => {
    const stdout = await createChildRunner(runOnePath)("placeholder-sort");
    const result = parseMeasurementResult("placeholder-sort", stdout);
    expect(result.timing.runs).toBe(5);
  }, 60_000);

  it("rejects an unknown name", async () => {
    await expect(
      createChildRunner(runOnePath)("no-such-thing"),
    ).rejects.toThrow(/no-such-thing/);
  }, 60_000);
});
