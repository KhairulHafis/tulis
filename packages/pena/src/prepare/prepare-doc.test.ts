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
    expect(doc.title).toMatchObject({
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
    expect(doc.title).toMatchObject({
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

describe("heading IDs and titles", () => {
  it("drops a heading ID from the H1 title and the heading", () => {
    const doc = prepared("# Install {#install}\n");
    expect(doc.title).toEqual({ from: "h1", text: "Install", line: 1 });
    expect(sentenceTexts(doc)).toEqual([["Install"]]);
  });
});

describe("frontmatter title", () => {
  function title(doc: PreparedDoc) {
    if (doc.title?.from !== "frontmatter") {
      throw new Error("expected a frontmatter title");
    }
    return doc.title;
  }

  it("has tokens and a range", () => {
    const text = "---\ntitle: Install the Agent\n---\n\nText.\n";
    const doc = prepared(text);
    const found = title(doc);
    expect(found.line).toBe(1);
    expect(found.tokens.map((t) => t.text)).toEqual([
      "Install",
      "the",
      "Agent",
    ]);
    expect(found.masked.text).toBe("Install the Agent");
    expect(doc.parsed.source.slice(found.range.start, found.range.end)).toBe(
      "Install the Agent",
    );
    for (const token of found.tokens) {
      expect(found.text.slice(token.source.start, token.source.end)).toBe(
        token.text,
      );
    }
  });

  it("masks code and covers the raw text when not found literally", () => {
    const doc = prepared('---\ntitle: "Use `kubectl` here"\n---\n');
    const found = title(doc);
    expect(found.text).toBe("Use `kubectl` here");
    expect(found.tokens.map((t) => t.text)).toEqual(["Use", "{CODE}", "here"]);
    expect(found.tokens[1]?.placeholder).toBe("CODE");
    expect(
      found.text.slice(
        found.tokens[1]?.source.start,
        found.tokens[1]?.source.end,
      ),
    ).toBe("`kubectl`");
    expect(doc.parsed.source.slice(found.range.start, found.range.end)).toBe(
      "Use `kubectl` here",
    );
  });

  it("covers the whole line when the text is not found literally", () => {
    const doc = prepared("---\ntitle: 'It''s here'\n---\n");
    const found = title(doc);
    expect(found.text).toBe("It's here");
    expect(doc.parsed.source.slice(found.range.start, found.range.end)).toBe(
      "title: 'It''s here'",
    );
  });

  it("masks product names", () => {
    const doc = prepared(
      "---\ntitle: Install Acme Cloud now\n---\n",
      "markdown",
      {
        productNames: createProductNameMatcher(["Acme Cloud"]),
      },
    );
    const found = title(doc);
    expect(found.tokens.map((t) => t.text)).toEqual([
      "Install",
      "{PRODUCT}",
      "now",
    ]);
    expect(found.masked.placeholders).toHaveLength(1);
    expect(
      found.text.slice(
        found.tokens[1]?.source.start,
        found.tokens[1]?.source.end,
      ),
    ).toBe("Acme Cloud");
  });

  it("reads a block scalar title as one token list", () => {
    const doc = prepared("---\ntitle: |\n  First line\n  second line\n---\n");
    const found = title(doc);
    expect(found.text).toBe("First line\nsecond line");
    expect(found.tokens.map((t) => t.text)).toEqual([
      "First",
      "line",
      "second",
      "line",
    ]);
    for (const token of found.tokens) {
      expect(found.text.slice(token.source.start, token.source.end)).toBe(
        token.text,
      );
    }
    expect(doc.parsed.source.slice(found.range.start, found.range.end)).toBe(
      "title: |",
    );
  });

  it("finds the title on its own line after other fields, with CRLF", () => {
    const doc = prepared("---\r\nweight: 1\r\ntitle: Hello there\r\n---\r\n");
    const found = title(doc);
    expect(doc.parsed.source.slice(found.range.start, found.range.end)).toBe(
      "Hello there",
    );
  });

  it("ignores a nested title key above the real one", () => {
    const doc = prepared(
      "---\nparams:\n  title: Nested\ntitle: Real one\n---\n",
    );
    const found = title(doc);
    expect(found.text).toBe("Real one");
    expect(doc.parsed.source.slice(found.range.start, found.range.end)).toBe(
      "Real one",
    );
  });

  it("reads a TOML title and drops a heading ID in it", () => {
    const doc = prepared('+++\ntitle = "Toml title {#id}"\n+++\n');
    const found = title(doc);
    expect(found.tokens.map((t) => t.text)).toEqual(["Toml", "title"]);
    expect(doc.parsed.source.slice(found.range.start, found.range.end)).toBe(
      "Toml title {#id}",
    );
  });

  it("uses markdown parsing in an mdx doc", () => {
    const doc = prepared("---\ntitle: Use {braces} here\n---\n", "mdx");
    expect(title(doc).tokens.map((t) => t.text)).toEqual([
      "Use",
      "{",
      "braces",
      "}",
      "here",
    ]);
  });

  it("collapses Unicode line separators in the title", () => {
    const sep = String.fromCodePoint(0x2028);
    const doc = prepared('---\ntitle: "One' + sep + 'two"\n---\n');
    const found = title(doc);
    expect(found.tokens.map((t) => t.text)).toEqual(["One", "two"]);
    expect(found.text).toHaveLength(7);
  });

  it("stays plain data", () => {
    const doc = prepared("---\ntitle: Plain `data`\n---\n");
    expect(structuredClone(doc.title)).toEqual(doc.title);
  });
});

describe("Hugo highlight code", () => {
  const yaml =
    'Before.\n\n{{< highlight yaml "linenos=false,hl_lines=2-5" >}}\n---\n# CAUTION: this is an example.\napiVersion: v1\n{{< /highlight >}}\n\nAfter.\n\n## Real heading\n';

  function headings(doc: PreparedDoc): string[] {
    return doc.blocks
      .filter((b) => b.kind === "heading")
      .flatMap((b) => b.sentences.map((s) => s.text));
  }

  it("drops blocks inside the pair and keeps the rest", () => {
    const doc = prepared(yaml);
    expect(headings(doc)).toEqual(["Real heading"]);
    expect(JSON.stringify(sentenceTexts(doc))).not.toContain("CAUTION");
    expect(sentenceTexts(doc)).toEqual([
      ["Before."],
      ["After."],
      ["Real heading"],
    ]);
  });

  it("handles no spaces and percent delimiters", () => {
    for (const [open, close] of [
      ["{{<highlight yaml>}}", "{{</highlight>}}"],
      ["{{% highlight bash %}}", "{{% /highlight %}}"],
    ]) {
      const doc = prepared(
        `${open ?? ""}\n# CAUTION\nrun it\n${close ?? ""}\n\n## Real heading\n`,
      );
      expect(sentenceTexts(doc)).toEqual([["Real heading"]]);
    }
  });

  it("drops nothing for an unclosed opening tag", () => {
    const doc = prepared("{{< highlight yaml >}}\n\n# Kept\n\nText.\n");
    expect(headings(doc)).toEqual(["Kept"]);
  });

  it("leaves a mid-line mention alone", () => {
    const doc = prepared("Use {{< highlight >}} here.\n\n{{< /highlight >}}\n");
    expect(JSON.stringify(sentenceTexts(doc))).toContain("Use");
  });

  it("does not take the title from a code block", () => {
    const doc = prepared(
      "{{< highlight yaml >}}\n# CAUTION\n{{< /highlight >}}\n",
    );
    expect(doc.title).toBeUndefined();
    const real = prepared(
      "{{< highlight yaml >}}\n# CAUTION\n{{< /highlight >}}\n\n# Real\n",
    );
    expect(real.title).toMatchObject({ from: "h1", text: "Real" });
  });

  it("is not applied to an mdx doc", () => {
    // MDX cannot parse a line starting with `{{<`, so a Hugo pair can never
    // reach the scan there; the syntax guard is checked by the mutation run.
    const doc = prepared("# Title\n\nText.\n", "mdx");
    expect(doc.title).toMatchObject({ from: "h1", text: "Title" });
    expect(sentenceTexts(doc)).toEqual([["Title"], ["Text."]]);
  });
});
