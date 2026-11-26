import { describe, expect, it } from "vitest";
import { runMeasurement } from "./harness.ts";
import {
  MEASUREMENTS,
  findMeasurement,
  generateNumbers,
} from "./measurements.ts";

describe("MEASUREMENTS", () => {
  it("has unique names", () => {
    const names = MEASUREMENTS.map((measurement) => measurement.name);
    expect(new Set(names).size).toBe(names.length);
  });

  it("has measurements that runMeasurement accepts", async () => {
    for (const measurement of MEASUREMENTS) {
      const result = await runMeasurement({
        ...measurement,
        warmups: 0,
        iterations: 1,
      });
      expect(result.name).toBe(measurement.name);
      expect(result.timing.runs).toBe(1);
    }
  });
});

describe("findMeasurement", () => {
  it("finds placeholder-sort", () => {
    expect(findMeasurement("placeholder-sort")?.name).toBe("placeholder-sort");
  });

  it("returns undefined for an unknown name", () => {
    expect(findMeasurement("nope")).toBeUndefined();
  });
});

describe("generateNumbers", () => {
  it("gives the same numbers every time", () => {
    const first = generateNumbers(10, 12345);
    const second = generateNumbers(10, 12345);
    expect(Array.from(first)).toEqual(Array.from(second));
    expect(first[0]).not.toBe(first[1]);
  });

  it("sorts ascending", () => {
    const sorted = generateNumbers(1000, 12345).sort();
    for (let i = 1; i < sorted.length; i++) {
      expect(sorted[i - 1] ?? 0).toBeLessThanOrEqual(sorted[i] ?? 0);
    }
  });
});
