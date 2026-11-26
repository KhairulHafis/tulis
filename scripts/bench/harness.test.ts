import { describe, expect, it } from "vitest";
import {
  runMeasurement,
  summariseTimings,
  type Measurement,
} from "./harness.ts";

function measurement(overrides: Partial<Measurement> = {}): Measurement {
  return {
    name: "placeholder-sort",
    description: "Sorts placeholders.",
    warmups: 0,
    iterations: 1,
    run: () => undefined,
    ...overrides,
  };
}

describe("summariseTimings", () => {
  it("uses the middle value for an odd count", () => {
    expect(summariseTimings([5, 1, 3])).toEqual({
      runs: 3,
      minMs: 1,
      medianMs: 3,
      maxMs: 5,
    });
  });

  it("averages the two middle values for an even count", () => {
    expect(summariseTimings([4, 1, 2, 10])).toEqual({
      runs: 4,
      minMs: 1,
      medianMs: 3,
      maxMs: 10,
    });
  });

  it("handles a single sample", () => {
    expect(summariseTimings([7])).toEqual({
      runs: 1,
      minMs: 7,
      medianMs: 7,
      maxMs: 7,
    });
  });

  it("does not mutate the input", () => {
    const samples = [3, 1, 2];
    summariseTimings(samples);
    expect(samples).toEqual([3, 1, 2]);
  });

  it("throws on empty input", () => {
    expect(() => summariseTimings([])).toThrow(Error);
  });
});

describe("runMeasurement", () => {
  it("does not time warmups and counts timed runs exactly", async () => {
    let calls = 0;
    let clock = 0;
    const result = await runMeasurement(
      measurement({
        warmups: 2,
        iterations: 3,
        run: () => {
          calls++;
        },
      }),
      () => {
        clock += 10;
        return clock;
      },
      () => 1,
    );
    expect(calls).toBe(5);
    expect(result.timing.runs).toBe(3);
    // Two clock reads per timed run, 10 apart.
    expect(result.timing).toEqual({
      runs: 3,
      minMs: 10,
      medianMs: 10,
      maxMs: 10,
    });
  });

  it("awaits an async run before starting the next", async () => {
    const events: string[] = [];
    await runMeasurement(
      measurement({
        warmups: 1,
        iterations: 2,
        run: async () => {
          events.push("start");
          await new Promise<void>((resolve) => setTimeout(resolve, 5));
          events.push("end");
        },
      }),
    );
    expect(events).toEqual(["start", "end", "start", "end", "start", "end"]);
  });

  it("passes the injected peak memory through", async () => {
    const result = await runMeasurement(
      measurement(),
      () => 0,
      () => 123456,
    );
    expect(result.peakMemoryBytes).toBe(123456);
    expect(result.name).toBe("placeholder-sort");
    expect(result.description).toBe("Sorts placeholders.");
  });

  it.each([
    ["Bad Name", "name"],
    ["", "name"],
    ["-x", "name"],
  ])("rejects name %j", async (name) => {
    await expect(runMeasurement(measurement({ name }))).rejects.toThrow(/name/);
  });

  it("rejects iterations of 0", async () => {
    await expect(
      runMeasurement(measurement({ iterations: 0 })),
    ).rejects.toThrow(/iterations/);
  });

  it("rejects fractional iterations", async () => {
    await expect(
      runMeasurement(measurement({ iterations: 1.5 })),
    ).rejects.toThrow(/iterations/);
  });

  it("rejects negative warmups", async () => {
    await expect(runMeasurement(measurement({ warmups: -1 }))).rejects.toThrow(
      /warmups/,
    );
  });

  it("works with the real clock and memory reader", async () => {
    const result = await runMeasurement(measurement({ iterations: 2 }));
    expect(result.peakMemoryBytes).toBeGreaterThan(0);
    expect(result.timing.minMs).toBeGreaterThanOrEqual(0);
    expect(result.timing.runs).toBe(2);
  });
});
