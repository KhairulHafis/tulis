import { describe, expect, it } from "vitest";
import { RangeIndex } from "./range-index.js";

function range(start: number, end: number): { start: number; end: number } {
  return { start, end };
}

describe("RangeIndex", () => {
  it("an empty index overlaps and contains nothing", () => {
    const index = new RangeIndex([]);
    expect(index.overlaps(range(0, 10))).toBe(false);
    expect(index.contains(range(0, 10))).toBe(false);
  });

  it("ranges that only touch do not overlap (end exclusive)", () => {
    const index = new RangeIndex([range(10, 20)]);
    expect(index.overlaps(range(0, 10))).toBe(false);
    expect(index.overlaps(range(20, 30))).toBe(false);
    expect(index.overlaps(range(0, 11))).toBe(true);
    expect(index.overlaps(range(19, 30))).toBe(true);
  });

  it("contains needs the whole range inside, edges included", () => {
    const index = new RangeIndex([range(10, 20)]);
    expect(index.contains(range(10, 20))).toBe(true);
    expect(index.contains(range(12, 15))).toBe(true);
    expect(index.contains(range(9, 15))).toBe(false);
    expect(index.contains(range(15, 21))).toBe(false);
  });

  it("handles nested and unsorted ranges", () => {
    const index = new RangeIndex([range(50, 60), range(0, 100), range(10, 20)]);
    expect(index.overlaps(range(70, 80))).toBe(true);
    expect(index.contains(range(70, 80))).toBe(true);
    expect(index.contains(range(70, 101))).toBe(false);
    expect(index.overlaps(range(100, 110))).toBe(false);
  });

  it("a gap between ranges is not covered", () => {
    const index = new RangeIndex([range(0, 10), range(20, 30)]);
    expect(index.overlaps(range(10, 20))).toBe(false);
    expect(index.contains(range(5, 25))).toBe(false);
  });
});
