import type { SourceRange } from "./ignored-ranges.js";

export const PLACEHOLDER_KINDS = [
  "CODE",
  "UI",
  "PRODUCT",
  "SHORTCODE",
  "URL",
  "IMAGE",
  "HTML",
] as const;

export type PlaceholderKind = (typeof PLACEHOLDER_KINDS)[number];

export function placeholderText(kind: PlaceholderKind): string {
  return "{" + kind + "}";
}

/**
 * A piece of a text node's value and the source it came from.
 * Linear (`atomic` false): both lengths are equal and value char i maps to
 * sourceStart + i - valueStart. Atomic: the whole value piece maps to the
 * whole source piece, whatever the lengths.
 */
export interface TextRun {
  readonly valueStart: number;
  readonly valueEnd: number;
  readonly sourceStart: number;
  readonly sourceEnd: number;
  readonly atomic: boolean;
}

const MAX_REFERENCE_LENGTH = 32;
const MAX_CODE_POINT = 0x10ffff;
const REPLACEMENT_CHARACTER = "\uFFFD";

function isAsciiPunctuation(code: number): boolean {
  return (
    (code >= 33 && code <= 47) ||
    (code >= 58 && code <= 64) ||
    (code >= 91 && code <= 96) ||
    (code >= 123 && code <= 126)
  );
}

function isReferenceChar(code: number): boolean {
  return (
    (code >= 48 && code <= 57) ||
    (code >= 65 && code <= 90) ||
    (code >= 97 && code <= 122) ||
    code === 35
  );
}

function isLineSpace(char: string | undefined): boolean {
  return char === " " || char === "\t";
}

/**
 * The end (exclusive) of a character reference that starts at `from` (the
 * ampersand): `&`, 1 to 32 letters, digits or `#`, then `;`. Undefined if
 * there is none before `limit`.
 */
function referenceEnd(
  source: string,
  from: number,
  limit: number,
): number | undefined {
  const last = Math.min(limit, from + MAX_REFERENCE_LENGTH + 2);
  for (let k = from + 1; k < last; k++) {
    const code = source.charCodeAt(k);
    if (code === 59) {
      return k > from + 1 ? k + 1 : undefined;
    }
    if (!isReferenceChar(code)) {
      return undefined;
    }
  }
  return undefined;
}

function digitValue(code: number): number {
  if (code >= 48 && code <= 57) {
    return code - 48;
  }
  if (code >= 65 && code <= 70) {
    return code - 55;
  }
  if (code >= 97 && code <= 102) {
    return code - 87;
  }
  return -1;
}

/** Decodes the body of `&#...;` (without `&` and `;`). Undefined if malformed. */
function decodeNumeric(body: string): string | undefined {
  const hex = body.charAt(1) === "x" || body.charAt(1) === "X";
  const radix = hex ? 16 : 10;
  const digitsFrom = hex ? 2 : 1;
  if (body.length === digitsFrom) {
    return undefined;
  }
  let codePoint = 0;
  for (let k = digitsFrom; k < body.length; k++) {
    const digit = digitValue(body.charCodeAt(k));
    if (digit < 0 || digit >= radix) {
      return undefined;
    }
    // Stop growing once the number is out of range, so it cannot overflow.
    codePoint = Math.min(codePoint * radix + digit, MAX_CODE_POINT + 1);
  }
  if (
    codePoint === 0 ||
    codePoint > MAX_CODE_POINT ||
    (codePoint >= 0xd800 && codePoint <= 0xdfff)
  ) {
    return REPLACEMENT_CHARACTER;
  }
  return String.fromCodePoint(codePoint);
}

/**
 * How many value characters a character reference at source[from, to) made,
 * or undefined when the value does not look like it came from one.
 */
function referenceValueLength(
  value: string,
  at: number,
  body: string,
): number | undefined {
  if (body.charAt(0) === "#") {
    const decoded = decodeNumeric(body);
    if (decoded === undefined) {
      return undefined;
    }
    if (value.startsWith(decoded, at)) {
      return decoded.length;
    }
    // The parser maps some valid numbers (such as controls) to U+FFFD too.
    return value.startsWith(REPLACEMENT_CHARACTER, at) ? 1 : undefined;
  }
  const code = value.codePointAt(at);
  if (code === undefined) {
    return undefined;
  }
  return code > 0xffff ? 2 : 1;
}

/**
 * Aligns `value` (a text node's value) with source.slice(start, end).
 *
 * Whatever the walk cannot explain becomes one atomic run for the rest of the
 * value, so the map may be coarse but is never wrong.
 */
export function alignText(
  value: string,
  source: string,
  start: number,
  end: number,
): TextRun[] {
  if (start < 0 || end < start || end > source.length) {
    throw new RangeError("The source range is outside the source.");
  }
  const runs: TextRun[] = [];
  // Index of the last run when it is a literal run that may still grow.
  let open = -1;
  let i = 0;
  let j = start;
  let atLineStart = false;

  const pushLiteral = (length: number): void => {
    const last = open >= 0 ? runs[open] : undefined;
    if (last !== undefined) {
      runs[open] = {
        valueStart: last.valueStart,
        valueEnd: i + length,
        sourceStart: last.sourceStart,
        sourceEnd: j + length,
        atomic: false,
      };
    } else {
      runs.push({
        valueStart: i,
        valueEnd: i + length,
        sourceStart: j,
        sourceEnd: j + length,
        atomic: false,
      });
      open = runs.length - 1;
    }
    i += length;
    j += length;
  };

  while (i < value.length) {
    if (atLineStart) {
      atLineStart = false;
      const before = j;
      while (j < end && (isLineSpace(source[j]) || source[j] === ">")) {
        j++;
      }
      if (j > before) {
        open = -1;
      }
    }
    if (j >= end) {
      break;
    }
    const v = value.charAt(i);
    const s = source.charAt(j);

    if (s === "\\" && j + 1 < end && v === source.charAt(j + 1)) {
      if (isAsciiPunctuation(source.charCodeAt(j + 1))) {
        j++;
        open = -1;
        continue;
      }
    }

    if (s === "&") {
      const stop = referenceEnd(source, j, end);
      if (stop !== undefined) {
        const text = source.slice(j, stop);
        if (value.startsWith(text, i)) {
          pushLiteral(text.length);
          continue;
        }
        const length = referenceValueLength(
          value,
          i,
          text.slice(1, text.length - 1),
        );
        if (length !== undefined) {
          runs.push({
            valueStart: i,
            valueEnd: i + length,
            sourceStart: j,
            sourceEnd: stop,
            atomic: true,
          });
          open = -1;
          i += length;
          j = stop;
          continue;
        }
      }
    }

    if (v === s) {
      pushLiteral(1);
      atLineStart = v === "\n";
      continue;
    }

    if (s === "\r" && v === "\n" && source.charAt(j + 1) === "\n") {
      j++;
      open = -1;
      continue;
    }

    if (isLineSpace(s)) {
      // Spaces and tabs the parser trimmed before a line ending.
      let k = j;
      while (k < end && isLineSpace(source[k])) {
        k++;
      }
      const next = source.charAt(k);
      if (v === "\n" && (next === "\n" || next === "\r")) {
        j = k;
        open = -1;
        continue;
      }
    }

    break;
  }

  if (i < value.length) {
    runs.push({
      valueStart: i,
      valueEnd: value.length,
      sourceStart: j,
      sourceEnd: end,
      atomic: true,
    });
  }
  return runs;
}

/**
 * The runs restricted to value offsets [valueStart, valueEnd). Linear runs are
 * cut exactly; an atomic run that overlaps the range is kept whole.
 */
export function sliceRuns(
  runs: readonly TextRun[],
  valueStart: number,
  valueEnd: number,
): TextRun[] {
  const result: TextRun[] = [];
  if (valueEnd <= valueStart) {
    return result;
  }
  for (const run of runs) {
    if (run.valueEnd <= valueStart || run.valueStart >= valueEnd) {
      continue;
    }
    if (run.atomic) {
      result.push(run);
      continue;
    }
    const from = Math.max(run.valueStart, valueStart);
    const to = Math.min(run.valueEnd, valueEnd);
    result.push({
      valueStart: from,
      valueEnd: to,
      sourceStart: run.sourceStart + (from - run.valueStart),
      sourceEnd: run.sourceStart + (to - run.valueStart),
      atomic: false,
    });
  }
  return result;
}

export interface MaskedSegment {
  readonly maskedStart: number;
  readonly maskedEnd: number;
  readonly sourceStart: number;
  readonly sourceEnd: number;
  /**
   * Linear (false): equal masked and source lengths, offsets map one to one.
   * Atomic (true): the whole masked piece maps to the whole source piece.
   * Placeholders and replacements are always atomic.
   */
  readonly atomic: boolean;
  /** Set for placeholder segments. */
  readonly placeholder: PlaceholderKind | undefined;
}

export interface Placeholder {
  readonly kind: PlaceholderKind;
  readonly maskedStart: number;
  readonly maskedEnd: number;
  readonly source: SourceRange;
}

export interface MaskedText {
  readonly text: string;
  /** Contiguous, in order, covering [0, text.length). Source offsets never go backwards. */
  readonly segments: readonly MaskedSegment[];
  readonly placeholders: readonly Placeholder[];
}

export class MaskedTextBuilder {
  private text = "";
  private readonly entries: MaskedSegment[] = [];
  private readonly placeholders: Placeholder[] = [];
  private lastSourceEnd = 0;

  /**
   * Appends value pieces with their runs (from alignText or sliceRuns).
   * `value` is the whole text node value the runs index into. The text added
   * is value.slice(first run start, last run end), so a sliced run list adds
   * only that part (an atomic run kept whole adds all of it). The runs must be
   * contiguous in the value.
   */
  appendRuns(value: string, runs: readonly TextRun[]): void {
    const first = runs[0];
    const last = runs[runs.length - 1];
    if (first === undefined || last === undefined) {
      return;
    }
    if (last.valueEnd > value.length) {
      throw new RangeError("A run is outside the value.");
    }
    let expected = first.valueStart;
    for (const run of runs) {
      if (run.valueStart !== expected || run.valueEnd < run.valueStart) {
        throw new RangeError("The runs are not contiguous in the value.");
      }
      if (
        !run.atomic &&
        run.valueEnd - run.valueStart !== run.sourceEnd - run.sourceStart
      ) {
        throw new RangeError("A linear run must have equal lengths.");
      }
      expected = run.valueEnd;
    }
    const base = this.text.length - first.valueStart;
    this.text += value.slice(first.valueStart, last.valueEnd);
    for (const run of runs) {
      if (run.valueEnd > run.valueStart) {
        this.addSegment(
          base + run.valueStart,
          base + run.valueEnd,
          run.sourceStart,
          run.sourceEnd,
          undefined,
          run.atomic,
        );
      }
    }
  }

  /** alignText then appendRuns. */
  appendText(value: string, source: string, start: number, end: number): void {
    this.appendRuns(value, alignText(value, source, start, end));
  }

  /**
   * Atomic text that stands for a source span, for example "\n" for a hard
   * line break.
   */
  appendReplacement(
    text: string,
    sourceStart: number,
    sourceEnd: number,
  ): void {
    if (text.length === 0) {
      return;
    }
    const maskedStart = this.text.length;
    this.text += text;
    this.addSegment(
      maskedStart,
      this.text.length,
      sourceStart,
      sourceEnd,
      undefined,
      true,
    );
  }

  appendPlaceholder(
    kind: PlaceholderKind,
    sourceStart: number,
    sourceEnd: number,
  ): void {
    const maskedStart = this.text.length;
    this.text += placeholderText(kind);
    this.addSegment(
      maskedStart,
      this.text.length,
      sourceStart,
      sourceEnd,
      kind,
      true,
    );
    this.placeholders.push({
      kind,
      maskedStart,
      maskedEnd: this.text.length,
      source: { start: sourceStart, end: sourceEnd },
    });
  }

  build(): MaskedText {
    return {
      text: this.text,
      segments: [...this.entries],
      placeholders: [...this.placeholders],
    };
  }

  private addSegment(
    maskedStart: number,
    maskedEnd: number,
    sourceStart: number,
    sourceEnd: number,
    placeholder: PlaceholderKind | undefined,
    atomic: boolean,
  ): void {
    if (sourceEnd < sourceStart || sourceStart < this.lastSourceEnd) {
      throw new RangeError("Source offsets must not go backwards.");
    }
    this.lastSourceEnd = sourceEnd;
    const previous = this.entries[this.entries.length - 1];
    if (
      !atomic &&
      previous?.atomic === false &&
      previous.maskedEnd === maskedStart &&
      previous.sourceEnd === sourceStart
    ) {
      this.entries[this.entries.length - 1] = {
        ...previous,
        maskedEnd,
        sourceEnd,
      };
      return;
    }
    this.entries.push({
      maskedStart,
      maskedEnd,
      sourceStart,
      sourceEnd,
      atomic,
      placeholder,
    });
  }
}

/**
 * side "start": the source offset where the masked char at `offset` begins;
 * side "end": the source offset where the masked char before `offset` ends.
 * Inside an atomic segment, "start" gives its sourceStart and "end" its
 * sourceEnd. Throws RangeError outside [0, text.length] or when the text is
 * empty.
 */
export function toSourceOffset(
  masked: MaskedText,
  offset: number,
  side: "start" | "end",
): number {
  const segments = masked.segments;
  const firstSegment = segments[0];
  const lastSegment = segments[segments.length - 1];
  if (
    firstSegment === undefined ||
    lastSegment === undefined ||
    !Number.isInteger(offset) ||
    offset < 0 ||
    offset > masked.text.length
  ) {
    throw new RangeError("The masked offset is out of range.");
  }
  if (side === "start") {
    if (offset === masked.text.length) {
      return lastSegment.sourceEnd;
    }
    // The last segment that begins at or before the offset.
    let low = 0;
    let high = segments.length - 1;
    while (low < high) {
      const middle = (low + high + 1) >> 1;
      const candidate = segments[middle];
      if (candidate !== undefined && candidate.maskedStart <= offset) {
        low = middle;
      } else {
        high = middle - 1;
      }
    }
    const segment = segments[low];
    if (segment === undefined) {
      throw new RangeError("The masked offset is out of range.");
    }
    return !segment.atomic
      ? segment.sourceStart + (offset - segment.maskedStart)
      : segment.sourceStart;
  }
  if (offset === 0) {
    return firstSegment.sourceStart;
  }
  // The first segment that ends at or after the offset.
  let low = 0;
  let high = segments.length - 1;
  while (low < high) {
    const middle = (low + high) >> 1;
    const candidate = segments[middle];
    if (candidate !== undefined && candidate.maskedEnd >= offset) {
      high = middle;
    } else {
      low = middle + 1;
    }
  }
  const segment = segments[low];
  if (segment === undefined) {
    throw new RangeError("The masked offset is out of range.");
  }
  return !segment.atomic
    ? segment.sourceStart + (offset - segment.maskedStart)
    : segment.sourceEnd;
}

/** Maps a masked range [start, end) to a source range (start side, end side). */
export function toSourceRange(
  masked: MaskedText,
  start: number,
  end: number,
): SourceRange {
  const sourceStart = toSourceOffset(masked, start, "start");
  const sourceEnd = toSourceOffset(masked, end, "end");
  return { start: sourceStart, end: Math.max(sourceStart, sourceEnd) };
}
