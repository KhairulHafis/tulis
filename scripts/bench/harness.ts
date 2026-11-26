export interface Measurement {
  /** Lower-case id with hyphens, for example "placeholder-sort". */
  readonly name: string;
  /** One plain sentence saying what is measured. */
  readonly description: string;
  /** Untimed runs before timing starts. 0 or more. */
  readonly warmups: number;
  /** Timed runs. 1 or more. */
  readonly iterations: number;
  run(): void | Promise<void>;
}

export interface TimingSummary {
  readonly runs: number;
  readonly minMs: number;
  readonly medianMs: number;
  readonly maxMs: number;
}

export interface MeasurementResult {
  readonly name: string;
  readonly description: string;
  readonly timing: TimingSummary;
  /** Peak resident memory of the whole process, in bytes. */
  readonly peakMemoryBytes: number;
}

const NAME_PATTERN = /^[a-z0-9]+(-[a-z0-9]+)*$/;

/** Throws if `samples` is empty. Median of an even count is the mean of the two middle values. Does not mutate the input. */
export function summariseTimings(samples: readonly number[]): TimingSummary {
  if (samples.length === 0) {
    throw new Error("samples must not be empty");
  }
  const sorted = [...samples].sort((a, b) => a - b);
  const middle = Math.floor(sorted.length / 2);
  const low = sorted[middle - 1] ?? 0;
  const high = sorted[middle] ?? 0;
  const medianMs = sorted.length % 2 === 1 ? high : (low + high) / 2;
  return {
    runs: sorted.length,
    minMs: sorted[0] ?? 0,
    medianMs,
    maxMs: sorted[sorted.length - 1] ?? 0,
  };
}

function validateMeasurement(measurement: Measurement): void {
  if (measurement.name.length > 100 || !NAME_PATTERN.test(measurement.name)) {
    throw new Error(
      'name must be lower-case letters, digits and single hyphens, for example "placeholder-sort"',
    );
  }
  if (!Number.isInteger(measurement.warmups) || measurement.warmups < 0) {
    throw new Error("warmups must be an integer of 0 or more");
  }
  if (!Number.isInteger(measurement.iterations) || measurement.iterations < 1) {
    throw new Error("iterations must be an integer of 1 or more");
  }
}

function defaultPeakMemoryBytes(): number {
  // Node reports maxRSS in kilobytes.
  return process.resourceUsage().maxRSS * 1024;
}

/** Validates the measurement, runs warmups then timed iterations one after another (awaiting each), and returns the result. */
export async function runMeasurement(
  measurement: Measurement,
  now: () => number = () => performance.now(),
  readPeakMemoryBytes: () => number = defaultPeakMemoryBytes,
): Promise<MeasurementResult> {
  validateMeasurement(measurement);

  for (let i = 0; i < measurement.warmups; i++) {
    await measurement.run();
  }

  const samples: number[] = [];
  for (let i = 0; i < measurement.iterations; i++) {
    const start = now();
    await measurement.run();
    samples.push(now() - start);
  }

  return {
    name: measurement.name,
    description: measurement.description,
    timing: summariseTimings(samples),
    peakMemoryBytes: readPeakMemoryBytes(),
  };
}
