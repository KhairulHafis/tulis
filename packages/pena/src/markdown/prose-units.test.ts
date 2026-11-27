import { describe, expect, it } from "vitest";
import {
  parseMarkdown,
  type MarkdownSyntax,
  type ParsedMarkdown,
} from "./parse-markdown.js";
import { collectProseBlocks, proseUnit } from "./prose-units.js";

function parse(text: string, syntax: MarkdownSyntax = "markdown") {
  const result = parseMarkdown(text, syntax);
  if (result.kind !== "parsed") {
    throw new Error("did not parse: " + result.message);
  }
  return result;
}

function units(parsed: ParsedMarkdown) {
  return collectProseBlocks(parsed.tree).map((block) =>
    proseUnit(block, parsed),
  );
}

function texts(parsed: ParsedMarkdown): string[] {
  return units(parsed).map((unit) => unit.masked.text);
}

describe("collectProseBlocks", () => {
  it("returns blocks in document order across containers", () => {
    const parsed = parse(
      [
        "# Head",
        "",
        "- item one",
        "- item two",
        "",
        "> quoted",
        "",
        "Text.[^n]",
        "",
        "[^n]: The note.",
        "",
        ":::note",
        "Inside the note.",
        ":::",
        "",
        "| A | B |",
        "| - | - |",
        "| c | d |",
        "",
        "Last.",
        "",
      ].join("\n"),
    );
    expect(texts(parsed)).toEqual([
      "Head",
      "item one",
      "item two",
      "quoted",
      "Text.",
      "The note.",
      "Inside the note.",
      "A",
      "B",
      "c",
      "d",
      "Last.",
    ]);
    expect(units(parsed).map((unit) => unit.kind)).toEqual([
      "heading",
      "paragraph",
      "paragraph",
      "paragraph",
      "paragraph",
      "paragraph",
      "paragraph",
      "tableCell",
      "tableCell",
      "tableCell",
      "tableCell",
      "paragraph",
    ]);
  });

  it("collects nothing from code, HTML or frontmatter", () => {
    const parsed = parse(
      "---\ntitle: Hello. World.\n---\n\n```\nCode. Here.\n```\n\n<div>\nHtml. Here.\n</div>\n\nProse.\n",
    );
    expect(texts(parsed)).toEqual(["Prose."]);
  });

  it("skips JSX components in MDX but keeps the paragraphs around them", () => {
    const parsed = parse(
      "Before.\n\n<Tabs>\n  <Tab>\n\n  Inside the tab.\n\n  </Tab>\n</Tabs>\n\nAfter.\n",
      "mdx",
    );
    expect(texts(parsed)).toEqual(["Before.", "After."]);
  });

  it("does not recurse, so a deep tree does not overflow", () => {
    const parsed = parse("> ".repeat(90) + "deep\n");
    expect(texts(parsed)).toEqual(["deep"]);
  });
});

describe("proseUnit", () => {
  it("keeps a heading with a dot as one sentence", () => {
    const parsed = parse("## Step 1. Install the agent\n");
    const [unit] = units(parsed);
    expect(unit?.sentences.map((s) => s.text)).toEqual([
      "Step 1. Install the agent",
    ]);
    expect(unit?.sentences[0]?.source).toEqual({ start: 3, end: 28 });
  });

  it("gives an empty heading no sentences", () => {
    const [unit] = units(parse("##\n"));
    expect(unit?.kind).toBe("heading");
    expect(unit?.sentences).toEqual([]);
  });

  it("splits each table cell on its own", () => {
    const parsed = parse(
      "| A | B |\n| - | - |\n| One. Two. | Three. Four. |\n",
    );
    const cells = units(parsed).filter((unit) => unit.kind === "tableCell");
    expect(cells.map((c) => c.sentences.map((s) => s.text))).toEqual([
      ["A"],
      ["B"],
      ["One.", "Two."],
      ["Three.", "Four."],
    ]);
  });

  it("splits a paragraph into sentences", () => {
    const [unit] = units(parse("One. Two.\n"));
    expect(unit?.sentences.map((s) => s.text)).toEqual(["One.", "Two."]);
  });
});
