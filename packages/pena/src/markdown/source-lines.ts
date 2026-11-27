export interface LineColumn {
  /** 1-based. */
  readonly line: number;
  /** 1-based, in UTF-16 code units, like unist positions. */
  readonly column: number;
}

/** Maps offsets in a source text to lines and columns. */
export class SourceLines {
  readonly #length: number;
  /** Offset of the first character of each line. */
  readonly #starts: number[] = [0];

  constructor(source: string) {
    this.#length = source.length;
    for (let i = 0; i < source.length; i++) {
      if (source.charCodeAt(i) === 10) {
        this.#starts.push(i + 1);
      }
    }
  }

  at(offset: number): LineColumn {
    if (!Number.isInteger(offset) || offset < 0 || offset > this.#length) {
      throw new RangeError("The offset is out of range.");
    }
    let low = 0;
    let high = this.#starts.length - 1;
    while (low < high) {
      const middle = (low + high + 1) >> 1;
      if ((this.#starts[middle] ?? 0) <= offset) {
        low = middle;
      } else {
        high = middle - 1;
      }
    }
    return { line: low + 1, column: offset - (this.#starts[low] ?? 0) + 1 };
  }
}
