import { describe, expect, it } from "vitest";
import {
  bestTime,
  expectLinearTime,
  repeatToSize,
  timeOnce,
} from "./timing.js";

/** Busy-waits so the duration does not depend on how fast the machine is. */
function spin(ms: number): void {
  const end = performance.now() + ms;
  while (performance.now() < end) {
    // wait
  }
}

describe("repeatToSize", () => {
  it("repeats the unit and cuts to the exact size", () => {
    expect(repeatToSize("abc", 7)).toBe("abcabca");
    expect(repeatToSize("abc", 6)).toBe("abcabc");
    expect(repeatToSize("abc", 2)).toBe("ab");
    expect(repeatToSize("abc", 0)).toBe("");
  });

  it("returns exactly the requested length for a long unit", () => {
    expect(repeatToSize("x".repeat(999), 5000)).toHaveLength(5000);
  });
});

describe("timeOnce and bestTime", () => {
  it("measures one call in milliseconds", () => {
    const took = timeOnce(() => {
      spin(5);
    });
    expect(took).toBeGreaterThanOrEqual(5);
    expect(took).toBeLessThan(200);
  });

  it("takes the best of the runs", () => {
    const durations = [20, 2, 10];
    let calls = 0;
    const best = bestTime(() => {
      spin(durations[calls] ?? 0);
      calls += 1;
    });
    expect(calls).toBe(3);
    expect(best).toBeGreaterThanOrEqual(2);
    expect(best).toBeLessThan(10);
  });

  it("stops early once a run is over stopAfterMs", () => {
    let calls = 0;
    const best = bestTime(
      () => {
        calls += 1;
        spin(15);
      },
      { stopAfterMs: 10 },
    );
    expect(calls).toBe(1);
    expect(best).toBeGreaterThanOrEqual(15);
  });

  it("honours the runs option", () => {
    let calls = 0;
    bestTime(
      () => {
        calls += 1;
      },
      { runs: 2 },
    );
    expect(calls).toBe(2);
  });
});

describe("expectLinearTime", () => {
  const base = {
    probe: { size: 100, limitMs: 50 },
    sizes: [200, 400, 800],
    smallLimitMs: 100,
    largeLimitMs: 500,
    slack: 1.5,
    floorMs: 1,
  } as const;

  it("passes for a linear function", () => {
    expectLinearTime({
      ...base,
      prepare: (size) => () => {
        spin(size / 50);
      },
    });
  });

  it("fails for a quadratic function and names the size", () => {
    const quadratic = {
      ...base,
      prepare: (size: number) => () => {
        spin((size * size) / 20000);
      },
    };
    expect(() => {
      expectLinearTime(quadratic);
    }).toThrow(/size (400|800): measured/);
  });

  it("fails at the probe for a very slow function", () => {
    const preparedSizes: number[] = [];
    const slow = {
      ...base,
      probe: { size: 100, limitMs: 5 },
      prepare: (size: number) => {
        preparedSizes.push(size);
        return () => {
          spin(20);
        };
      },
    };
    expect(() => {
      expectLinearTime(slow);
    }).toThrow(/probe, size 100: measured/);
    expect(preparedSizes).toEqual([100]);
  });

  it("builds the input outside the timer", () => {
    expectLinearTime({
      ...base,
      prepare: (size) => {
        spin(30);
        return () => {
          spin(size / 100);
        };
      },
    });
  });
});
