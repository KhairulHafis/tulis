import { describe, expect, it } from "vitest";
import { createProductNameMatcher } from "../markdown/product-names.js";
import {
  prepareDoc,
  type PreparedDoc,
  type PrepareOptions,
} from "./prepare-doc.js";
import type { MarkdownSyntax } from "../markdown/parse-markdown.js";

function prepared(
  text: string,
  syntax: MarkdownSyntax = "markdown",
  options?: PrepareOptions,
): PreparedDoc {
  const result = prepareDoc(text, syntax, options);
  if (result.kind !== "prepared") {
    throw new Error("expected a prepared doc, got " + result.reason);
  }
  return result;
}

function sentenceTexts(doc: PreparedDoc): string[][] {
  return doc.blocks.map((block) => block.sentences.map((s) => s.text));
}

const bom = String.fromCodePoint(0xfeff);

describe("blocks and sentences", () => {
  it("prepares a plain doc with positions across a hard wrap", () => {
    const doc = prepared(
      "First one here. Second sentence\nwraps here.\n\nThird.\n",
    );
    expect(sentenceTexts(doc)).toEqual([
      ["First one here.", "Second sentence\nwraps here."],
      ["Third."],
    ]);
    const [first, second] = doc.blocks[0]?.sentences ?? [];
    expect(first?.start).toEqual({ line: 1, column: 1 });
    expect(first?.end).toEqual({ line: 1, column: 16 });
    expect(second?.start).toEqual({ line: 1, column: 17 });
    expect(second?.end).toEqual({ line: 2, column: 12 });
    expect(second?.tokens.map((t) => t.text)).toEqual([
      "Second",
      "sentence",
      "wraps",
      "here",
      ".",
    ]);
    expect(doc.blocks[1]?.sentences[0]?.start).toEqual({ line: 4, column: 1 });
  });

  it("makes a heading one sentence", () => {
    const doc = prepared("## Set up the tool. Then go\n");
    expect(doc.blocks).toHaveLength(1);
    expect(doc.blocks[0]?.kind).toBe("heading");
    expect(doc.blocks[0]?.sentences).toHaveLength(1);
  });

  it("makes each table cell its own block", () => {
    const doc = prepared("| A | B |\n| - | - |\n| c | d |\n");
    expect(doc.blocks.map((b) => b.kind)).toEqual([
      "tableCell",
      "tableCell",
      "tableCell",
      "tableCell",
    ]);
    expect(sentenceTexts(doc)).toEqual([["A"], ["B"], ["c"], ["d"]]);
  });

  it("masks product names", () => {
    const productNames = createProductNameMatcher(["Acme Cloud"]);
    const doc = prepared("Open Acme Cloud now.\n", "markdown", {
      productNames,
    });
    expect(doc.blocks[0]?.sentences[0]?.text).toBe("Open {PRODUCT} now.");
  });

  it("gives the same blocks and lines for a BOM and CRLF input", () => {
    const lf = prepared("One here.\n\nTwo wraps\nhere.\n");
    const crlf = prepared(bom + "One here.\r\n\r\nTwo wraps\r\nhere.\r\n");
    expect(
      sentenceTexts(crlf).map((s) => s.map((t) => t.replace("\r", ""))),
    ).toEqual(sentenceTexts(lf));
    expect(crlf.parsed.hasBom).toBe(true);
    expect(crlf.blocks.map((b) => b.sentences[0]?.start.line)).toEqual([1, 3]);
    expect(crlf.blocks[1]?.sentences[0]?.end.line).toBe(4);
  });
});

describe("ignore comments", () => {
  it("drops the block after an every-check next comment", () => {
    const doc = prepared(
      "Keep one.\n\n<!-- tulis-ignore -->\nDrop this.\n\nKeep two.\n",
    );
    expect(sentenceTexts(doc)).toEqual([["Keep one."], ["Keep two."]]);
  });

  it("drops what is between start and end comments", () => {
    const doc = prepared(
      "Keep one.\n\n<!-- tulis-ignore-start -->\n\nDrop a.\n\nDrop b.\n\n<!-- tulis-ignore-end -->\n\nKeep two.\n",
    );
    expect(sentenceTexts(doc)).toEqual([["Keep one."], ["Keep two."]]);
  });

  it("drops text inside a long range even after a short range nested in it", () => {
    const doc = prepared(
      "<!-- tulis-ignore-start -->\n\nDrop a.\n\n<!-- tulis-ignore -->\nDrop b.\n\nDrop c.\n\n<!-- tulis-ignore-end -->\n\nKeep.\n",
    );
    expect(sentenceTexts(doc)).toEqual([["Keep."]]);
  });

  it("keeps text under a check-ID ignore and passes it through", () => {
    const doc = prepared("<!-- tulis-ignore term.sign-in -->\nSign in here.\n");
    expect(sentenceTexts(doc)).toEqual([["Sign in here."]]);
    expect(doc.checkIgnores).toHaveLength(1);
    expect(doc.checkIgnores[0]?.checks).toEqual(["term.sign-in"]);
  });

  it("reports ignore warnings and frontmatter warnings with their source", () => {
    const doc = prepared(
      "---\ntitle: A\ntitle: B\n---\n\n<!-- tulis-ignore-end -->\n\nText.\n",
    );
    expect(doc.warnings.map((w) => w.from)).toEqual(["frontmatter", "ignore"]);
    expect(doc.warnings[0]).toMatchObject({ code: "invalid-yaml" });
    expect(doc.warnings[1]).toMatchObject({
      code: "stray-end",
      line: 6,
      column: 1,
    });
    expect(doc.moreWarnings).toBe(0);
  });
});

describe("title", () => {
  it("takes the first H1", () => {
    const doc = prepared("Intro.\n\n# Main  title\n\n# Other\n");
    expect(doc.title).toEqual({ from: "h1", text: "Main  title", line: 3 });
  });

  it("trims the H1 text like the frontmatter title", () => {
    const doc = prepared("#   Spaced   \n");
    expect(doc.title).toMatchObject({ from: "h1", text: "Spaced" });
  });

  it("takes the title from frontmatter when there is no H1", () => {
    const doc = prepared("---\ntitle:  From front \n---\n\n## Sub\n");
    expect(doc.title).toEqual({
      from: "frontmatter",
      text: "From front",
      line: 1,
    });
  });

  it("prefers the H1 over frontmatter", () => {
    const doc = prepared("---\ntitle: Front\n---\n\n# Heading\n");
    expect(doc.title).toMatchObject({ from: "h1", text: "Heading", line: 5 });
  });

  it("has no title when there is neither", () => {
    expect(prepared("Just text.\n").title).toBeUndefined();
  });

  it("works with TOML frontmatter", () => {
    const doc = prepared('+++\ntitle = "Toml title"\n+++\n\nText.\n');
    expect(doc.title).toEqual({
      from: "frontmatter",
      text: "Toml title",
      line: 1,
    });
  });

  it("finds an H1 even when its text is ignored", () => {
    const doc = prepared("<!-- tulis-ignore -->\n# Hidden\n\nText.\n");
    expect(doc.title).toMatchObject({ from: "h1", text: "Hidden" });
    expect(sentenceTexts(doc)).toEqual([["Text."]]);
  });
});

describe("skipping", () => {
  it("skips a non-English doc", () => {
    const result = prepareDoc("---\nlang: ja\n---\n\nText.\n", "markdown");
    expect(result).toMatchObject({ kind: "skipped", reason: "non-english" });
  });

  it("does not skip lang: en", () => {
    expect(prepared("---\nlang: en\n---\n\nText.\n").blocks).toHaveLength(1);
  });

  it("skips an MDX doc that does not parse", () => {
    const result = prepareDoc("Text.\n\n<div>\n\nMore.\n", "mdx");
    expect(result.kind).toBe("skipped");
    if (result.kind === "skipped") {
      expect(result.reason).toBe("invalid-mdx");
      expect(result.syntax).toBe("mdx");
      expect(result.message).toEqual(expect.any(String));
      expect(result.line).toEqual(expect.any(Number));
    }
  });
});

describe("MDX", () => {
  it("keeps prose outside JSX components and drops what is inside", () => {
    const doc = prepared(
      "Before text.\n\n<Tabs>\n  <Tab>\n\n  Inside prose.\n\n  </Tab>\n</Tabs>\n\nAfter text.\n",
      "mdx",
    );
    expect(sentenceTexts(doc)).toEqual([["Before text."], ["After text."]]);
  });
});

describe("plain data", () => {
  it("survives structuredClone unchanged", () => {
    const doc = prepared(
      "---\ntitle: T\n---\n\n# Head\n\nSome `code` text. More here.\n\n| a | b |\n| - | - |\n| c | d |\n\n<!-- tulis-ignore term.sign-in -->\nSign in.\n",
    );
    expect(structuredClone(doc)).toEqual(doc);
  });
});
