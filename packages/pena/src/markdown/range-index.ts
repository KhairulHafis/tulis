import type { SourceRange } from "./ignored-ranges.js";

/**
 * Answers "does a range overlap, or sit inside, one of these ranges" in
 * logarithmic time: ranges sorted by start, with the largest end so far.
 */
export class RangeIndex {
  readonly #starts: number[] = [];
  readonly #maxEnds: number[] = [];

  constructor(ranges: readonly SourceRange[]) {
    const sorted = [...ranges].sort((a, b) => a.start - b.start);
    let maxEnd = -1;
    for (const range of sorted) {
      maxEnd = Math.max(maxEnd, range.end);
      this.#starts.push(range.start);
      this.#maxEnds.push(maxEnd);
    }
  }

  /** How many ranges start before `limit` (or at it, when `inclusive`). */
  #countStartingBefore(limit: number, inclusive: boolean): number {
    let low = 0;
    let high = this.#starts.length;
    while (low < high) {
      const middle = (low + high) >> 1;
      const start = this.#starts[middle] ?? 0;
      if (inclusive ? start <= limit : start < limit) {
        low = middle + 1;
      } else {
        high = middle;
      }
    }
    return low;
  }

  overlaps(range: SourceRange): boolean {
    const count = this.#countStartingBefore(range.end, false);
    return count > 0 && (this.#maxEnds[count - 1] ?? -1) > range.start;
  }

  contains(range: SourceRange): boolean {
    const count = this.#countStartingBefore(range.start, true);
    return count > 0 && (this.#maxEnds[count - 1] ?? -1) >= range.end;
  }
}
