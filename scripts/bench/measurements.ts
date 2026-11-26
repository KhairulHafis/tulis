import type { Measurement } from "./harness.ts";

const SAMPLE_COUNT = 1_000_000;
const SEED = 12345;

/** A plain linear congruential generator. Returns `count` numbers in [0, 1), the same ones every call. */
export function generateNumbers(count: number, seed: number): Float64Array {
  const values = new Float64Array(count);
  let state = seed >>> 0;
  for (let i = 0; i < count; i++) {
    // Math.imul and >>> 0 keep the arithmetic exact in 32 bits.
    state = (Math.imul(state, 1664525) + 1013904223) >>> 0;
    values[i] = state / 2 ** 32;
  }
  return values;
}

const placeholderSort: Measurement = {
  name: "placeholder-sort",
  description:
    "Placeholder: sorts 1,000,000 pseudo-random numbers. Real measurements replace it from session 1-31.",
  warmups: 1,
  iterations: 5,
  run(): void {
    generateNumbers(SAMPLE_COUNT, SEED).sort();
  },
};

export const MEASUREMENTS: readonly Measurement[] = [placeholderSort];

/** The measurement with this name, or undefined. */
export function findMeasurement(name: string): Measurement | undefined {
  return MEASUREMENTS.find((measurement) => measurement.name === name);
}
