import { describe, expect, it } from "vitest";
import { MaskedTextBuilder, type MaskedText } from "../markdown/masked-text.js";
import { createProductNameMatcher } from "../markdown/product-names.js";
import { parseMarkdown } from "../markdown/parse-markdown.js";
import { collectProseBlocks, proseUnit } from "../markdown/prose-units.js";
import type { Sentence } from "../markdown/sentences.js";
import { SourceLines } from "../markdown/source-lines.js";
import { tokenizeSentence, type Token } from "./tokens.js";

interface Unit {
  readonly source: string;
  readonly masked: MaskedText;
  readonly sentences: readonly Sentence[];
}

/** All prose units of a Markdown text, in document order. */
function unitsOf(markdown: string): Unit[] {
  const parsed = parseMarkdown(markdown, "markdown");
  if (parsed.kind !== "parsed") {
    throw new Error("did not parse");
  }
  return collectProseBlocks(parsed.tree).map((block) => {
    const unit = proseUnit(block, parsed, {
      productNames: createProductNameMatcher(["Acme"]),
    });
    return {
      source: parsed.source,
      masked: unit.masked,
      sentences: unit.sentences,
    };
  });
}

function tokensOf(markdown: string, unit = 0, sentence = 0): Token[] {
  const found = unitsOf(markdown)[unit];
  const target = found?.sentences[sentence];
  if (found === undefined || target === undefined) {
    throw new Error("missing sentence");
  }
  return tokenizeSentence(found.masked, target);
}

/** A masked text that is plain: masked offsets equal source offsets. */
function plain(text: string): { masked: MaskedText; sentence: Sentence } {
  const builder = new MaskedTextBuilder();
  builder.appendRuns(text, [
    {
      valueStart: 0,
      valueEnd: text.length,
      sourceStart: 0,
      sourceEnd: text.length,
      atomic: false,
    },
  ]);
  const masked = builder.build();
  return {
    masked,
    sentence: {
      text,
      maskedStart: 0,
      maskedEnd: text.length,
      source: { start: 0, end: text.length },
    },
  };
}

function split(text: string): Token[] {
  const { masked, sentence } = plain(text);
  return tokenizeSentence(masked, sentence);
}

function texts(text: string): string[] {
  return split(text).map((token) => token.text);
}

function kinds(text: string): string[] {
  return split(text).map((token) => token.kind);
}

describe("words and numbers", () => {
  it.each([
    "set-up",
    "don't",
    "don’t",
    "Node.js",
    "v1.2.3",
    "snake_case",
    "naïve",
    "日本語",
    "naïve",
  ])("keeps %s as one word", (word) => {
    expect(texts(word)).toEqual([word]);
    expect(kinds(word)).toEqual(["word"]);
  });

  it("drops a trailing joiner", () => {
    expect(texts("end.")).toEqual(["end", "."]);
    expect(kinds("end.")).toEqual(["word", "punctuation"]);
  });

  it("splits double joiners", () => {
    expect(texts("rock--solid")).toEqual(["rock", "-", "-", "solid"]);
  });

  it("splits quotes around a word", () => {
    expect(texts("'quoted'")).toEqual(["'", "quoted", "'"]);
  });

  it("splits e.g.", () => {
    expect(texts("e.g.")).toEqual(["e.g", "."]);
  });

  it("calls digit-only runs numbers", () => {
    expect(texts("42 3.14 10_000")).toEqual(["42", "3.14", "10_000"]);
    expect(kinds("42 3.14 10_000")).toEqual(["number", "number", "number"]);
  });

  it("splits 10,000 at the comma", () => {
    expect(texts("10,000")).toEqual(["10", ",", "000"]);
    expect(kinds("10,000")).toEqual(["number", "punctuation", "number"]);
  });

  it("splits a leading joiner", () => {
    expect(texts("-x")).toEqual(["-", "x"]);
  });
});

describe("punctuation and symbols", () => {
  it("separates punctuation from symbols", () => {
    expect(texts("a > b + c = $")).toEqual(["a", ">", "b", "+", "c", "=", "$"]);
    expect(kinds("> + = $ ! ?")).toEqual([
      "symbol",
      "symbol",
      "symbol",
      "symbol",
      "punctuation",
      "punctuation",
    ]);
  });

  it("keeps an astral character whole", () => {
    const tokens = split("go \u{1F600}!");
    expect(tokens.map((token) => token.text)).toEqual(["go", "\u{1F600}", "!"]);
    expect(tokens[1]?.kind).toBe("symbol");
    expect(tokens[1]?.maskedEnd).toBe(
      tokens[1] ? tokens[1].maskedStart + 2 : 0,
    );
  });

  it("makes lone surrogates one-unit symbols", () => {
    const tokens = split("a\ud83d b\ude00");
    expect(tokens.map((token) => token.text)).toEqual([
      "a",
      "\ud83d",
      "b",
      "\ude00",
    ]);
    expect(tokens[1]?.kind).toBe("symbol");
  });

  it("treats whitespace, newlines and tabs as gaps", () => {
    expect(texts(" a\n\tb" + String.fromCodePoint(0xa0) + "c ")).toEqual([
      "a",
      "b",
      "c",
    ]);
  });

  it("gives nothing for an empty or blank sentence", () => {
    expect(split("")).toEqual([]);
    expect(split(" \n ")).toEqual([]);
  });

  it("tokenises a sentence of only punctuation", () => {
    const tokens = split("...");
    expect(tokens.map((token) => token.text)).toEqual([".", ".", "."]);
    expect(tokens.map((token) => token.kind)).toEqual([
      "punctuation",
      "punctuation",
      "punctuation",
    ]);
  });

  it("keeps order, no overlap, exact text", () => {
    const text = "Don't over-think it: 3.5x (maybe) \u{1F600}...";
    const { masked, sentence } = plain(text);
    let previousEnd = 0;
    for (const token of tokenizeSentence(masked, sentence)) {
      expect(token.maskedStart).toBeGreaterThanOrEqual(previousEnd);
      expect(token.maskedEnd).toBeGreaterThan(token.maskedStart);
      expect(token.text).toBe(
        masked.text.slice(token.maskedStart, token.maskedEnd),
      );
      previousEnd = token.maskedEnd;
    }
  });
});

describe("range errors", () => {
  it("throws when the sentence is outside the masked text", () => {
    const { masked } = plain("abc");
    expect(() =>
      tokenizeSentence(masked, {
        text: "abcd",
        maskedStart: 0,
        maskedEnd: 4,
        source: { start: 0, end: 4 },
      }),
    ).toThrow(RangeError);
    expect(() =>
      tokenizeSentence(masked, {
        text: "",
        maskedStart: -1,
        maskedEnd: 0,
        source: { start: 0, end: 0 },
      }),
    ).toThrow(RangeError);
  });

  it("throws when the text differs from the slice", () => {
    const { masked } = plain("abc");
    expect(() =>
      tokenizeSentence(masked, {
        text: "abd",
        maskedStart: 0,
        maskedEnd: 3,
        source: { start: 0, end: 3 },
      }),
    ).toThrow(RangeError);
  });

  it("does not put the text in the message", () => {
    const { masked } = plain("secret");
    try {
      tokenizeSentence(masked, {
        text: "other",
        maskedStart: 0,
        maskedEnd: 5,
        source: { start: 0, end: 5 },
      });
      expect.unreachable();
    } catch (error) {
      expect(error).toBeInstanceOf(RangeError);
      expect((error as RangeError).message).not.toContain("secret");
    }
  });
});

describe("tokens from Markdown", () => {
  it("maps tokens of a wrapped sentence to their lines", () => {
    const markdown = "Wrap this sentence\nover two lines.\n";
    const tokens = tokensOf(markdown);
    const lines = new SourceLines(markdown);
    const over = tokens.find((token) => token.text === "over");
    expect(over).toBeDefined();
    if (over === undefined) {
      return;
    }
    expect(lines.at(over.source.start)).toEqual({ line: 2, column: 1 });
    expect(lines.at(over.source.end)).toEqual({ line: 2, column: 5 });
    const lineTwo = tokens.find((token) => token.text === "lines");
    expect(lineTwo && lines.at(lineTwo.source.start)).toEqual({
      line: 2,
      column: 10,
    });
    expect(tokens.map((token) => token.text)).toEqual([
      "Wrap",
      "this",
      "sentence",
      "over",
      "two",
      "lines",
      ".",
    ]);
  });

  it("covers the whole source of inline code, a UI label and a product", () => {
    const markdown = "Run `npm test` or press **Save** in Acme now.\n";
    const tokens = tokensOf(markdown);
    expect(tokens.map((token) => token.text)).toEqual([
      "Run",
      "{CODE}",
      "or",
      "press",
      "{UI}",
      "in",
      "{PRODUCT}",
      "now",
      ".",
    ]);
    const slice = (token: Token | undefined): string =>
      token === undefined
        ? ""
        : markdown.slice(token.source.start, token.source.end);
    expect(slice(tokens[1])).toBe("`npm test`");
    expect(tokens[1]?.kind).toBe("placeholder");
    expect(tokens[1]?.placeholder).toBe("CODE");
    expect(slice(tokens[4])).toBe("**Save**");
    expect(tokens[4]?.placeholder).toBe("UI");
    expect(tokens[6]?.placeholder).toBe("PRODUCT");
    expect(tokens[0]?.placeholder).toBeUndefined();
  });

  it("maps a link text that stays prose", () => {
    const markdown = "Read [the guide](https://example.com/x) now.\n";
    const tokens = tokensOf(markdown);
    expect(tokens.map((token) => token.text)).toEqual([
      "Read",
      "the",
      "guide",
      "now",
      ".",
    ]);
    const guide = tokens[2];
    expect(guide && markdown.slice(guide.source.start, guide.source.end)).toBe(
      "guide",
    );
  });

  it("splits a word from the placeholder it touches", () => {
    const tokens = tokensOf("Use `x`s and a`y` too.\n");
    expect(tokens.map((token) => token.text)).toEqual([
      "Use",
      "{CODE}",
      "s",
      "and",
      "a",
      "{CODE}",
      "too",
      ".",
    ]);
    expect(tokens.map((token) => token.kind)).toEqual([
      "word",
      "placeholder",
      "word",
      "word",
      "word",
      "placeholder",
      "word",
      "punctuation",
    ]);
  });

  it("tokenises a heading", () => {
    const markdown = "## Set-up `now`\n";
    const tokens = tokensOf(markdown);
    expect(tokens.map((token) => token.text)).toEqual(["Set-up", "{CODE}"]);
    expect(
      tokens[0] && markdown.slice(tokens[0].source.start, tokens[0].source.end),
    ).toBe("Set-up");
  });

  it("tokenises a table cell", () => {
    const markdown = "| A | B |\n| - | - |\n| one two | `c` |\n";
    const units = unitsOf(markdown);
    const index = units.findIndex(
      (unit) => unit.masked.text.trim() === "one two",
    );
    expect(index).toBeGreaterThan(-1);
    const tokens = tokensOf(markdown, index);
    expect(tokens.map((token) => token.text)).toEqual(["one", "two"]);
    const two = tokens[1];
    expect(two && markdown.slice(two.source.start, two.source.end)).toBe("two");
  });

  it("documents current behaviour: an escape token has the unescaped text and the whole escape as source", () => {
    const markdown = "Use \\*star\\* &amp; more.\n";
    const tokens = tokensOf(markdown);
    expect(tokens.map((token) => token.text)).toEqual([
      "Use",
      "*",
      "star",
      "*",
      "&",
      "more",
      ".",
    ]);
    const slices = tokens.map((token) =>
      markdown.slice(token.source.start, token.source.end),
    );
    expect(slices).toEqual(["Use", "*", "star", "*", "&amp;", "more", "."]);
  });

  it("keeps offsets relative to the block for a later sentence", () => {
    const markdown = "First one. Second `code` here.\n";
    const found = unitsOf(markdown)[0];
    const sentence = found?.sentences[1];
    expect(sentence?.text).toBe("Second {CODE} here.");
    const tokens = tokensOf(markdown, 0, 1);
    expect(tokens[0]?.maskedStart).toBe(sentence?.maskedStart);
    expect(tokens[0]?.maskedStart).toBe(11);
    const code = tokens[1];
    expect(code && markdown.slice(code.source.start, code.source.end)).toBe(
      "`code`",
    );
    expect(code?.maskedStart).toBe(18);
    expect(found?.masked.text.slice(code?.maskedStart, code?.maskedEnd)).toBe(
      "{CODE}",
    );
  });
});
