import { describe, expect, it } from "vitest";
import { visit } from "unist-util-visit";
import {
  alignText,
  MaskedTextBuilder,
  PLACEHOLDER_KINDS,
  placeholderText,
  sliceRuns,
  toSourceOffset,
  toSourceRange,
  type TextRun,
} from "./masked-text.js";
import { parseMarkdown } from "./parse-markdown.js";

interface TextPiece {
  readonly value: string;
  readonly source: string;
  readonly start: number;
  readonly end: number;
}

/** Every text node of a real parse, with the source range it claims. */
function textPieces(text: string): TextPiece[] {
  const result = parseMarkdown(text, "markdown");
  if (result.kind !== "parsed") {
    throw new Error("failed to parse");
  }
  const pieces: TextPiece[] = [];
  visit(result.tree, "text", (node) => {
    const start = node.position?.start.offset;
    const end = node.position?.end.offset;
    if (start === undefined || end === undefined) {
      throw new Error("no position");
    }
    pieces.push({ value: node.value, source: result.source, start, end });
  });
  return pieces;
}

/** The invariant every alignment must keep. */
function expectValid(piece: TextPiece, runs: readonly TextRun[]): void {
  let expected = 0;
  let sourceFloor = piece.start;
  for (const run of runs) {
    expect(run.valueStart).toBe(expected);
    expect(run.valueEnd).toBeGreaterThan(run.valueStart);
    expect(run.sourceStart).toBeGreaterThanOrEqual(sourceFloor);
    expect(run.sourceEnd).toBeLessThanOrEqual(piece.end);
    if (!run.atomic) {
      expect(piece.value.slice(run.valueStart, run.valueEnd)).toBe(
        piece.source.slice(run.sourceStart, run.sourceEnd),
      );
    }
    expected = run.valueEnd;
    sourceFloor = run.sourceEnd;
  }
  expect(expected).toBe(piece.value.length);
}

function align(piece: TextPiece): TextRun[] {
  const runs = alignText(piece.value, piece.source, piece.start, piece.end);
  expectValid(piece, runs);
  return runs;
}

function alignOnly(text: string): { piece: TextPiece; runs: TextRun[] } {
  const piece = textPieces(text)[0];
  if (piece === undefined) {
    throw new Error("no text node");
  }
  return { piece, runs: align(piece) };
}

function atomicRuns(runs: readonly TextRun[]): TextRun[] {
  return runs.filter((run) => run.atomic);
}

describe("placeholderText", () => {
  it("wraps each kind in braces", () => {
    expect(placeholderText("CODE")).toBe("{CODE}");
    expect(PLACEHOLDER_KINDS.map(placeholderText)).toEqual([
      "{CODE}",
      "{UI}",
      "{PRODUCT}",
      "{SHORTCODE}",
      "{URL}",
      "{IMAGE}",
      "{HTML}",
    ]);
  });
});

describe("alignText on real parses", () => {
  it("gives one linear run for a plain paragraph", () => {
    const { piece, runs } = alignOnly("Hello there, world.\n");
    expect(runs).toEqual([
      {
        valueStart: 0,
        valueEnd: 19,
        sourceStart: 0,
        sourceEnd: 19,
        atomic: false,
      },
    ]);
    expect(piece.value).toBe("Hello there, world.");
  });

  it("returns no runs for an empty value", () => {
    expect(alignText("", "abc", 1, 2)).toEqual([]);
  });

  it("skips a backslash escape", () => {
    const { runs } = alignOnly("a\\*b\n");
    expect(runs).toEqual([
      {
        valueStart: 0,
        valueEnd: 1,
        sourceStart: 0,
        sourceEnd: 1,
        atomic: false,
      },
      {
        valueStart: 1,
        valueEnd: 3,
        sourceStart: 2,
        sourceEnd: 4,
        atomic: false,
      },
    ]);
  });

  it("handles an escaped backslash and an escaped ampersand", () => {
    const first = alignOnly("a\\\\b\n");
    expect(first.piece.value).toBe("a\\b");
    expect(first.runs.length).toBe(2);
    const second = alignOnly("x \\&amp; y\n");
    expect(second.piece.value).toBe("x &amp; y");
    expect(atomicRuns(second.runs)).toEqual([]);
  });

  it("maps each kind of character reference to one atomic run", () => {
    const cases: [string, string][] = [
      ["&amp;", "&"],
      ["&#65;", "A"],
      ["&#x41;", "A"],
      ["&#X41;", "A"],
      ["&nbsp;", "\u00A0"],
      ["&#x1F600;", "\u{1f600}"],
      ["&ngE;", "\u2267\u0338"],
    ];
    for (const [reference, decoded] of cases) {
      const { piece, runs } = alignOnly(`a ${reference} b\n`);
      expect(piece.value).toBe(`a ${decoded} b`);
      if (reference === "&ngE;") {
        // Two characters from one name: coarser, but still valid.
        expect(atomicRuns(runs).length).toBeGreaterThan(0);
        continue;
      }
      expect(atomicRuns(runs)).toEqual([
        {
          valueStart: 2,
          valueEnd: 2 + decoded.length,
          sourceStart: 2,
          sourceEnd: 2 + reference.length,
          atomic: true,
        },
      ]);
      expect(runs.length).toBe(3);
    }
  });

  it("handles invalid code points", () => {
    for (const reference of ["&#0;", "&#xD800;", "&#x110000;", "&#1114112;"]) {
      const { piece, runs } = alignOnly(`a ${reference} b\n`);
      expect(piece.value).toBe("a \uFFFD b");
      expect(atomicRuns(runs)).toEqual([
        {
          valueStart: 2,
          valueEnd: 3,
          sourceStart: 2,
          sourceEnd: 2 + reference.length,
          atomic: true,
        },
      ]);
    }
  });

  it("keeps entity-like text that is not a reference linear", () => {
    for (const text of ["AT&T rocks\n", "a & b\n", "x &#; y &#x; z &;\n"]) {
      const { runs } = alignOnly(text);
      expect(runs.length).toBe(1);
    }
  });

  it("keeps a reference-shaped name the parser left alone linear", () => {
    const { piece, runs } = alignOnly("a &notareference; b\n");
    expect(piece.value).toBe("a &notareference; b");
    expect(runs.length).toBe(1);
  });

  it("strips the marker after each line ending in a blockquote", () => {
    const { piece, runs } = alignOnly("> foo\n> bar\n> baz\n");
    expect(piece.value).toBe("foo\nbar\nbaz");
    expect(runs).toEqual([
      {
        valueStart: 0,
        valueEnd: 4,
        sourceStart: 2,
        sourceEnd: 6,
        atomic: false,
      },
      {
        valueStart: 4,
        valueEnd: 8,
        sourceStart: 8,
        sourceEnd: 12,
        atomic: false,
      },
      {
        valueStart: 8,
        valueEnd: 11,
        sourceStart: 14,
        sourceEnd: 17,
        atomic: false,
      },
    ]);
  });

  it("strips several markers in a nested blockquote", () => {
    const { piece, runs } = alignOnly("> > foo\n> > bar\n");
    expect(piece.value).toBe("foo\nbar");
    expect(runs.length).toBe(2);
    expect(runs[1]?.sourceStart).toBe(12);
  });

  it("handles a lazy continuation line", () => {
    const { piece, runs } = alignOnly("> foo\nbar\n");
    expect(piece.value).toBe("foo\nbar");
    expect(atomicRuns(runs)).toEqual([]);
  });

  it("strips indentation in a list item", () => {
    const { piece, runs } = alignOnly("- foo\n  bar\n   baz\n");
    expect(piece.value).toBe("foo\nbar\nbaz");
    expect(runs.length).toBe(3);
  });

  it("strips a list inside a blockquote", () => {
    const { piece, runs } = alignOnly("> - foo\n>   bar\n");
    expect(piece.value).toBe("foo\nbar");
    expect(runs.length).toBe(2);
    expect(runs[1]?.sourceStart).toBe(12);
  });

  it("strips a blockquote inside a list", () => {
    const { piece, runs } = alignOnly("- > foo\n  > bar\n");
    expect(piece.value).toBe("foo\nbar");
    expect(runs.length).toBe(2);
  });

  it("keeps an escaped or encoded marker character at a line start", () => {
    // The value holds "\n>" here, so the line-start skip must stop before it.
    for (const text of [
      "a\n\\> b\n",
      "> a\n> \\> b\n",
      "- a\n  \\> b\n",
      "a\n&gt; b\n",
      "> a\n> &gt; b\n",
    ]) {
      const { piece, runs } = alignOnly(text);
      expect(piece.value).toBe("a\n> b");
      // The value ">" (offset 2) must map to the source ">" or "&gt;" itself,
      // not to a quote marker the skip passed over.
      const run = runs.find((item) => item.valueEnd > 2);
      if (run === undefined) {
        throw new Error("no run for the value >");
      }
      const from = run.atomic
        ? run.sourceStart
        : run.sourceStart + (2 - run.valueStart);
      expect(piece.source.slice(from, from + 1)).toBe(
        text.includes("&gt;") ? "&" : ">",
      );
      if (!text.includes("&gt;")) {
        expect(piece.source.charAt(from - 1)).toBe("\\");
      }
      const lastRun = runs.at(-1);
      expect(lastRun?.sourceEnd).toBe(piece.end);
      if (text.includes("&gt;")) {
        expect(
          atomicRuns(runs).map((run) => run.sourceEnd - run.sourceStart),
        ).toEqual([4]);
      } else {
        expect(atomicRuns(runs)).toEqual([]);
      }
    }
  });

  it("strips a marker followed by a tab", () => {
    const { piece, runs } = alignOnly("> a\n>\tb\n");
    expect(piece.value).toBe("a\nb");
    expect(runs.length).toBe(2);
  });

  it("handles CRLF line endings, with and without containers", () => {
    const plain = alignOnly("foo\r\nbar\r\n");
    expect(plain.piece.value).toBe("foo\r\nbar");
    expect(plain.runs.length).toBe(1);
    const quoted = alignOnly("> foo\r\n> bar\r\n");
    expect(quoted.piece.value).toBe("foo\r\nbar");
    expect(quoted.runs.length).toBe(2);
  });

  it("skips a CR when the value has only LF", () => {
    const runs = alignText("a\nb", "a\r\nb", 0, 4);
    expect(runs).toEqual([
      {
        valueStart: 0,
        valueEnd: 1,
        sourceStart: 0,
        sourceEnd: 1,
        atomic: false,
      },
      {
        valueStart: 1,
        valueEnd: 3,
        sourceStart: 2,
        sourceEnd: 4,
        atomic: false,
      },
    ]);
  });

  it("skips spaces the parser trimmed before a line ending", () => {
    for (const text of ["foo \nbar\n", "foo\t\nbar\n", "foo   \r\nbar\n"]) {
      for (const piece of textPieces(text)) {
        align(piece);
      }
    }
    const runs = alignText("foo\nbar", "foo  \nbar", 0, 9);
    expect(atomicRuns(runs)).toEqual([]);
    expect(runs[1]?.sourceStart).toBe(5);
  });

  it("works when the document started with a BOM", () => {
    const result = parseMarkdown("\uFEFF> foo\n> bar\n", "markdown");
    if (result.kind !== "parsed") {
      throw new Error("failed to parse");
    }
    expect(result.hasBom).toBe(true);
    const pieces = textPieces("\uFEFF> foo\n> bar\n");
    const piece = pieces[0];
    expect(piece?.source).toBe("> foo\n> bar\n");
    if (piece === undefined) {
      throw new Error("no text node");
    }
    const runs = align(piece);
    const builder = new MaskedTextBuilder();
    builder.appendRuns(piece.value, runs);
    const masked = builder.build();
    expect(toSourceRange(masked, 4, 7)).toEqual({ start: 8, end: 11 });
    expect(piece.source.slice(8, 11)).toBe("bar");
  });

  it("aligns every text node of a mixed document", () => {
    const doc = [
      "# Title &amp; more\n",
      "",
      "> quote with \\_escape\\_ and *emphasis*\n> second &#65; line\n",
      "",
      "- item one\n  continues &copy; here\n",
      "",
      "| a | b |\n| - | - |\n| x &lt; y | z |\n",
    ].join("\n");
    for (const piece of textPieces(doc)) {
      align(piece);
    }
  });
});

describe("alignText fallback", () => {
  it("makes one atomic run for what no rule explains", () => {
    const value = "abc XYZ";
    const source = "abc 12345";
    const piece: TextPiece = { value, source, start: 0, end: source.length };
    const runs = align(piece);
    expect(runs).toEqual([
      {
        valueStart: 0,
        valueEnd: 4,
        sourceStart: 0,
        sourceEnd: 4,
        atomic: false,
      },
      {
        valueStart: 4,
        valueEnd: 7,
        sourceStart: 4,
        sourceEnd: 9,
        atomic: true,
      },
    ]);
  });

  it("marks an equal-length mismatch atomic and maps it coarsely", () => {
    const piece: TextPiece = { value: "abd", source: "abc", start: 0, end: 3 };
    const runs = align(piece);
    expect(runs).toEqual([
      {
        valueStart: 0,
        valueEnd: 2,
        sourceStart: 0,
        sourceEnd: 2,
        atomic: false,
      },
      {
        valueStart: 2,
        valueEnd: 3,
        sourceStart: 2,
        sourceEnd: 3,
        atomic: true,
      },
    ]);
    const unmatched: TextPiece = {
      value: "xyz",
      source: "abc",
      start: 0,
      end: 3,
    };
    const all = align(unmatched);
    expect(all).toEqual([
      {
        valueStart: 0,
        valueEnd: 3,
        sourceStart: 0,
        sourceEnd: 3,
        atomic: true,
      },
    ]);
    const builder = new MaskedTextBuilder();
    builder.appendRuns("xyz", all);
    const masked = builder.build();
    expect(masked.segments[0]?.atomic).toBe(true);
    expect(toSourceOffset(masked, 1, "start")).toBe(0);
    expect(toSourceOffset(masked, 2, "end")).toBe(3);
  });

  it("makes one atomic run when the source runs out", () => {
    const piece: TextPiece = {
      value: "abcdef",
      source: "abc",
      start: 0,
      end: 3,
    };
    const runs = align(piece);
    expect(runs[1]).toEqual({
      valueStart: 3,
      valueEnd: 6,
      sourceStart: 3,
      sourceEnd: 3,
      atomic: true,
    });
  });

  it("rejects a range outside the source", () => {
    expect(() => alignText("a", "a", 0, 2)).toThrow(RangeError);
    expect(() => alignText("a", "a", 1, 0)).toThrow(RangeError);
  });
});

describe("alignText timing", () => {
  it("is fast on 1 MB with many escapes and prefixed lines", () => {
    const sourceLine = "a\\*b&amp;c\\_d  \n> ";
    const valueLine = "a*b&c_d\n";
    const count = Math.floor(1_000_000 / sourceLine.length);
    const source = sourceLine.repeat(count);
    const value = valueLine.repeat(count);
    const started = performance.now();
    const runs = alignText(value, source, 0, source.length);
    const elapsed = performance.now() - started;
    expect(runs.length).toBeGreaterThan(count);
    expect(elapsed).toBeLessThan(500);
  });

  it("is fast on a long run of ampersands and spaces", () => {
    const source = "&aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa".repeat(25_000);
    const started = performance.now();
    const runs = alignText(source, source, 0, source.length);
    expect(performance.now() - started).toBeLessThan(500);
    expect(runs.length).toBe(1);
    const spaces = " ".repeat(500_000) + "x";
    const started2 = performance.now();
    alignText("\nx", "\n" + spaces, 0, spaces.length + 1);
    expect(performance.now() - started2).toBeLessThan(500);
  });
});

describe("sliceRuns", () => {
  const runs: TextRun[] = [
    {
      valueStart: 0,
      valueEnd: 4,
      sourceStart: 10,
      sourceEnd: 14,
      atomic: false,
    },
    {
      valueStart: 4,
      valueEnd: 5,
      sourceStart: 14,
      sourceEnd: 19,
      atomic: true,
    },
    {
      valueStart: 5,
      valueEnd: 9,
      sourceStart: 21,
      sourceEnd: 25,
      atomic: false,
    },
  ];

  it("cuts a linear run exactly", () => {
    expect(sliceRuns(runs, 1, 3)).toEqual([
      {
        valueStart: 1,
        valueEnd: 3,
        sourceStart: 11,
        sourceEnd: 13,
        atomic: false,
      },
    ]);
    expect(sliceRuns(runs, 6, 8)).toEqual([
      {
        valueStart: 6,
        valueEnd: 8,
        sourceStart: 22,
        sourceEnd: 24,
        atomic: false,
      },
    ]);
  });

  it("keeps an overlapping atomic run whole", () => {
    expect(sliceRuns(runs, 3, 6)).toEqual([
      {
        valueStart: 3,
        valueEnd: 4,
        sourceStart: 13,
        sourceEnd: 14,
        atomic: false,
      },
      runs[1],
      {
        valueStart: 5,
        valueEnd: 6,
        sourceStart: 21,
        sourceEnd: 22,
        atomic: false,
      },
    ]);
  });

  it("returns nothing for an empty or outside range", () => {
    expect(sliceRuns(runs, 2, 2)).toEqual([]);
    expect(sliceRuns(runs, 20, 30)).toEqual([]);
  });
});

describe("MaskedTextBuilder", () => {
  it("merges a plain text node into one segment", () => {
    const builder = new MaskedTextBuilder();
    const source = "Hello world.";
    builder.appendText(source, source, 0, source.length);
    const masked = builder.build();
    expect(masked.text).toBe(source);
    expect(masked.segments).toEqual([
      {
        maskedStart: 0,
        maskedEnd: 12,
        sourceStart: 0,
        sourceEnd: 12,
        atomic: false,
        placeholder: undefined,
      },
    ]);
    for (let offset = 0; offset <= 12; offset++) {
      expect(toSourceOffset(masked, offset, "start")).toBe(offset);
      expect(toSourceOffset(masked, offset, "end")).toBe(offset);
    }
  });

  it("builds text, placeholder, text", () => {
    const source = "Select **Save**, then run `ls`.";
    const builder = new MaskedTextBuilder();
    builder.appendText("Select ", source, 0, 7);
    builder.appendPlaceholder("UI", 7, 15);
    builder.appendText(", then run ", source, 15, 26);
    builder.appendPlaceholder("CODE", 26, 30);
    builder.appendText(".", source, 30, 31);
    const masked = builder.build();
    expect(masked.text).toBe("Select {UI}, then run {CODE}.");
    expect(masked.placeholders).toEqual([
      {
        kind: "UI",
        maskedStart: 7,
        maskedEnd: 11,
        source: { start: 7, end: 15 },
      },
      {
        kind: "CODE",
        maskedStart: 22,
        maskedEnd: 28,
        source: { start: 26, end: 30 },
      },
    ]);
    expect(masked.segments.map((s) => s.placeholder)).toEqual([
      undefined,
      "UI",
      undefined,
      "CODE",
      undefined,
    ]);
    // Contiguous and covering the text.
    let at = 0;
    for (const segment of masked.segments) {
      expect(segment.maskedStart).toBe(at);
      at = segment.maskedEnd;
    }
    expect(at).toBe(masked.text.length);
    // Boundaries.
    expect(toSourceOffset(masked, 7, "start")).toBe(7);
    expect(toSourceOffset(masked, 7, "end")).toBe(7);
    expect(toSourceOffset(masked, 11, "start")).toBe(15);
    expect(toSourceOffset(masked, 11, "end")).toBe(15);
    // Inside an atomic placeholder.
    expect(toSourceOffset(masked, 9, "start")).toBe(7);
    expect(toSourceOffset(masked, 9, "end")).toBe(15);
    expect(toSourceRange(masked, 5, 9)).toEqual({ start: 5, end: 15 });
    expect(toSourceRange(masked, 0, masked.text.length)).toEqual({
      start: 0,
      end: 31,
    });
  });

  it("never merges placeholders", () => {
    const builder = new MaskedTextBuilder();
    builder.appendPlaceholder("CODE", 0, 4);
    builder.appendPlaceholder("CODE", 4, 8);
    expect(builder.build().segments.length).toBe(2);
  });

  it("adds a replacement as an atomic segment", () => {
    const source = "one  \ntwo";
    const builder = new MaskedTextBuilder();
    builder.appendText("one", source, 0, 3);
    builder.appendReplacement("\n", 3, 6);
    builder.appendText("two", source, 6, 9);
    const masked = builder.build();
    expect(masked.text).toBe("one\ntwo");
    expect(masked.segments.length).toBe(3);
    expect(masked.placeholders).toEqual([]);
    expect(toSourceOffset(masked, 3, "start")).toBe(3);
    expect(toSourceOffset(masked, 4, "end")).toBe(6);
    expect(toSourceOffset(masked, 4, "start")).toBe(6);
  });

  it("treats an equal-length replacement as atomic", () => {
    const builder = new MaskedTextBuilder();
    builder.appendReplacement("ab", 5, 7);
    const masked = builder.build();
    expect(masked.segments[0]?.atomic).toBe(true);
    expect(toSourceOffset(masked, 1, "start")).toBe(5);
    expect(toSourceOffset(masked, 1, "end")).toBe(7);
  });

  it("rejects a linear run with unequal lengths", () => {
    const builder = new MaskedTextBuilder();
    expect(() => {
      builder.appendRuns("abc", [
        {
          valueStart: 0,
          valueEnd: 3,
          sourceStart: 0,
          sourceEnd: 5,
          atomic: false,
        },
      ]);
    }).toThrow(RangeError);
    expect(builder.build().text).toBe("");
  });

  it("keeps linear segments equal to their source slices", () => {
    const source = "a\\*b &amp; c";
    const builder = new MaskedTextBuilder();
    builder.appendText("a*b & c", source, 0, source.length);
    const masked = builder.build();
    for (const segment of masked.segments) {
      if (!segment.atomic) {
        expect(masked.text.slice(segment.maskedStart, segment.maskedEnd)).toBe(
          source.slice(segment.sourceStart, segment.sourceEnd),
        );
      }
    }
    expect(masked.segments.some((segment) => segment.atomic)).toBe(true);
  });

  it("does not merge a replacement into its neighbours", () => {
    const builder = new MaskedTextBuilder();
    builder.appendReplacement("a", 0, 1);
    builder.appendReplacement("b", 1, 2);
    expect(builder.build().segments.length).toBe(2);
  });

  it("maps a wrapped quoted paragraph from a real parse", () => {
    const text = "> foo &amp; bar\n> baz\n";
    const piece = textPieces(text)[0];
    if (piece === undefined) {
      throw new Error("no text node");
    }
    const builder = new MaskedTextBuilder();
    builder.appendText(piece.value, piece.source, piece.start, piece.end);
    const masked = builder.build();
    expect(masked.text).toBe("foo & bar\nbaz");
    const baz = masked.text.indexOf("baz");
    expect(toSourceRange(masked, baz, baz + 3)).toEqual({
      start: text.indexOf("baz"),
      end: text.indexOf("baz") + 3,
    });
    const amp = masked.text.indexOf("&");
    expect(toSourceRange(masked, amp, amp + 1)).toEqual({
      start: text.indexOf("&amp;"),
      end: text.indexOf("&amp;") + 5,
    });
    const bar = masked.text.indexOf("bar");
    expect(toSourceRange(masked, bar, bar + 3)).toEqual({
      start: text.indexOf("bar"),
      end: text.indexOf("bar") + 3,
    });
  });

  it("appends a sliced run list", () => {
    const source = "ab\\*cd";
    const value = "ab*cd";
    const runs = alignText(value, source, 0, source.length);
    const builder = new MaskedTextBuilder();
    builder.appendRuns(value, sliceRuns(runs, 3, 5));
    const masked = builder.build();
    expect(masked.text).toBe("cd");
    expect(toSourceRange(masked, 0, 2)).toEqual({ start: 4, end: 6 });
  });

  it("rejects runs that are not contiguous or out of range", () => {
    const builder = new MaskedTextBuilder();
    expect(() => {
      builder.appendRuns("abcd", [
        {
          valueStart: 0,
          valueEnd: 1,
          sourceStart: 0,
          sourceEnd: 1,
          atomic: false,
        },
        {
          valueStart: 2,
          valueEnd: 3,
          sourceStart: 2,
          sourceEnd: 3,
          atomic: false,
        },
      ]);
    }).toThrow(RangeError);
    expect(() => {
      builder.appendRuns("ab", [
        {
          valueStart: 0,
          valueEnd: 5,
          sourceStart: 0,
          sourceEnd: 5,
          atomic: false,
        },
      ]);
    }).toThrow(RangeError);
  });

  it("rejects source offsets that go backwards", () => {
    const builder = new MaskedTextBuilder();
    builder.appendPlaceholder("URL", 5, 10);
    expect(() => {
      builder.appendPlaceholder("URL", 2, 4);
    }).toThrow(RangeError);
  });
});

describe("toSourceOffset errors and ends", () => {
  it("throws for an empty text", () => {
    const masked = new MaskedTextBuilder().build();
    expect(() => toSourceOffset(masked, 0, "start")).toThrow(RangeError);
    expect(() => toSourceRange(masked, 0, 0)).toThrow(RangeError);
  });

  it("throws outside [0, text.length]", () => {
    const builder = new MaskedTextBuilder();
    builder.appendText("abc", "abc", 0, 3);
    const masked = builder.build();
    expect(() => toSourceOffset(masked, -1, "start")).toThrow(RangeError);
    expect(() => toSourceOffset(masked, 4, "end")).toThrow(RangeError);
    expect(() => toSourceOffset(masked, 1.5, "end")).toThrow(RangeError);
  });

  it("handles offsets 0 and text.length on both sides", () => {
    const builder = new MaskedTextBuilder();
    builder.appendText("abc", "xxabcxx", 2, 5);
    builder.appendPlaceholder("IMAGE", 5, 9);
    const masked = builder.build();
    expect(toSourceOffset(masked, 0, "start")).toBe(2);
    expect(toSourceOffset(masked, 0, "end")).toBe(2);
    expect(toSourceOffset(masked, masked.text.length, "start")).toBe(9);
    expect(toSourceOffset(masked, masked.text.length, "end")).toBe(9);
  });

  it("uses a segment that begins at a boundary for start and the one that ends there for end", () => {
    const builder = new MaskedTextBuilder();
    builder.appendText("ab", "ab--cd", 0, 2);
    builder.appendText("cd", "ab--cd", 4, 6);
    const masked = builder.build();
    expect(masked.segments.length).toBe(2);
    expect(toSourceOffset(masked, 2, "start")).toBe(4);
    expect(toSourceOffset(masked, 2, "end")).toBe(2);
    expect(toSourceRange(masked, 2, 2)).toEqual({ start: 4, end: 4 });
    expect(toSourceRange(masked, 0, 4)).toEqual({ start: 0, end: 6 });
  });
});
