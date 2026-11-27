import { expect } from "vitest";

/** Repeats `unit` and cuts the result to exactly `size` characters. */
export function repeatToSize(unit: string, size: number): string {
  return unit.repeat(Math.ceil(size / unit.length)).slice(0, size);
}

/** Milliseconds for one call. */
export function timeOnce(run: () => unknown): number {
  const started = performance.now();
  run();
  return performance.now() - started;
}

export interface BestTimeOptions {
  /** How many runs to take the best of. Default 3. */
  readonly runs?: number;
  /** Stop early once a run takes longer than this many ms. Default 1000. */
  readonly stopAfterMs?: number;
}

/**
 * Best (smallest) time of several runs, to damp noise. A run that is already
 * over `stopAfterMs` is a failure anyway, so a slow regression is not repeated.
 */
export function bestTime(
  run: () => unknown,
  options: BestTimeOptions = {},
): number {
  const runs = options.runs ?? 3;
  const stopAfterMs = options.stopAfterMs ?? 1000;
  let fastest = timeOnce(run);
  for (let count = 1; count < runs && fastest <= stopAfterMs; count += 1) {
    fastest = Math.min(fastest, timeOnce(run));
  }
  return fastest;
}

export interface LinearTimeCheck {
  /** Builds the input for a size outside the timer and returns the call to time. */
  readonly prepare: (size: number) => () => unknown;
  /** A small first run with a tight limit, so a quadratic regression fails fast. */
  readonly probe: { readonly size: number; readonly limitMs: number };
  /** Increasing sizes: the smallest, any middle ones, then the largest. */
  readonly sizes: readonly [small: number, ...rest: number[], large: number];
  /** Absolute limit for the smallest size. */
  readonly smallLimitMs: number;
  /** Absolute limit for the largest size. */
  readonly largeLimitMs: number;
  /** Allowed time growth over linear between the smallest size and each larger one. */
  readonly slack: number;
  /** Floor for growth limits, so tiny timings do not fail on noise. */
  readonly floorMs: number;
}

function describeTime(label: string, measured: number): string {
  return label + ": measured " + measured.toFixed(1) + " ms";
}

/**
 * Probe first (best of two), then every size (best of three). Each size must
 * stay under its limit and grow no faster than linear times `slack`.
 */
export function expectLinearTime(check: LinearTimeCheck): void {
  const { probe, sizes } = check;
  const probeTime = bestTime(check.prepare(probe.size), { runs: 2 });
  expect(
    probeTime,
    describeTime("probe, size " + String(probe.size), probeTime) +
      ", allowed under " +
      String(probe.limitMs) +
      " ms",
  ).toBeLessThan(probe.limitMs);

  const smallSize = sizes[0];
  const largeSize = sizes[sizes.length - 1];
  const smallTime = bestTime(check.prepare(smallSize));
  expect(
    smallTime,
    describeTime("size " + String(smallSize), smallTime) +
      ", allowed under " +
      String(check.smallLimitMs) +
      " ms",
  ).toBeLessThan(check.smallLimitMs);

  for (const size of sizes.slice(1)) {
    const measured = bestTime(check.prepare(size));
    const growthLimit = Math.max(
      smallTime * (size / smallSize) * check.slack,
      check.floorMs,
    );
    const allowed =
      size === largeSize
        ? Math.min(check.largeLimitMs, growthLimit)
        : growthLimit;
    expect(
      measured,
      describeTime("size " + String(size), measured) +
        ", allowed under " +
        allowed.toFixed(1) +
        " ms",
    ).toBeLessThan(allowed);
  }
}
