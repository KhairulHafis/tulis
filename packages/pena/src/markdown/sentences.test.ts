import type { Root, RootContent } from "mdast";
import { describe, expect, it } from "vitest";
import { maskBlock, type MaskableBlock } from "./mask-block.js";
import { parseMarkdown, type MarkdownSyntax } from "./parse-markdown.js";
import { ABBREVIATIONS, splitSentences } from "./sentences.js";

function isBlock(node: Root | RootContent): node is MaskableBlock {
  return (
    node.type === "paragraph" ||
    node.type === "heading" ||
    node.type === "tableCell"
  );
}

function firstBlock(node: Root | RootContent): MaskableBlock | undefined {
  if (isBlock(node)) {
    return node;
  }
  if ("children" in node) {
    for (const child of node.children) {
      const found = firstBlock(child);
      if (found !== undefined) {
        return found;
      }
    }
  }
  return undefined;
}

/** Sentence texts of the first block of a Markdown string. */
function split(md: string, syntax: MarkdownSyntax = "markdown"): string[] {
  const parsed = parseMarkdown(md, syntax);
  if (parsed.kind !== "parsed") {
    throw new Error("did not parse");
  }
  const block = firstBlock(parsed.tree);
  if (block === undefined) {
    return [];
  }
  return splitSentences(maskBlock(block, parsed)).map((s) => s.text);
}

/** Original source slices of each sentence of the first block. */
function sources(md: string): string[] {
  const parsed = parseMarkdown(md, "markdown");
  if (parsed.kind !== "parsed") {
    throw new Error("did not parse");
  }
  const block = firstBlock(parsed.tree);
  if (block === undefined) {
    return [];
  }
  const masked = maskBlock(block, parsed);
  return splitSentences(masked).map((s) => {
    expect(s.text).toBe(masked.text.slice(s.maskedStart, s.maskedEnd));
    return parsed.source.slice(s.source.start, s.source.end);
  });
}

describe("splitSentences basics", () => {
  it("splits three plain sentences", () => {
    expect(split("One is here. Two is here. Three is here.")).toEqual([
      "One is here.",
      "Two is here.",
      "Three is here.",
    ]);
  });

  it("handles ?, !, ?! and ...", () => {
    expect(split("Why? Because! Really?! Yes... Fine.")).toEqual([
      "Why?",
      "Because!",
      "Really?!",
      "Yes...",
      "Fine.",
    ]);
  });

  it("handles the ellipsis character", () => {
    expect(split("Wait\u2026 Go on.")).toEqual(["Wait\u2026", "Go on."]);
  });

  it("keeps closers with the sentence", () => {
    expect(split('He said "Stop." Then he left.')).toEqual([
      'He said "Stop."',
      "Then he left.",
    ]);
    expect(split("It works (see below.) Next one.")).toEqual([
      "It works (see below.)",
      "Next one.",
    ]);
  });

  it("does not split quote then lowercase", () => {
    expect(split('"Stop!" and left.')).toEqual(['"Stop!" and left.']);
  });

  it("splits before a digit or an opening quote", () => {
    expect(split("Done. 3 files remain. (Maybe.) \u201CHi.\u201D")).toEqual([
      "Done.",
      "3 files remain.",
      "(Maybe.)",
      "\u201CHi.\u201D",
    ]);
  });

  it("returns nothing for empty and whitespace-only blocks", () => {
    expect(split("")).toEqual([]);
    expect(split("   \n")).toEqual([]);
    expect(split("&#32;")).toEqual([]);
  });

  it("returns a sentence without a terminator", () => {
    expect(split("No end here")).toEqual(["No end here"]);
  });
});

describe("splitSentences abbreviations", () => {
  it("does not split after abbreviations", () => {
    expect(split("Use tools, e.g. Docker or Podman.")).toEqual([
      "Use tools, e.g. Docker or Podman.",
    ]);
    expect(split("Use one, i.e. Docker. Done.")).toEqual([
      "Use one, i.e. Docker.",
      "Done.",
    ]);
    expect(split("Cats vs. Dogs are fun.")).toEqual(["Cats vs. Dogs are fun."]);
    expect(split("Ask Dr. Smith today.")).toEqual(["Ask Dr. Smith today."]);
    expect(split("See Fig. 3 for more.")).toEqual(["See Fig. 3 for more."]);
    expect(split("See Smith et al. Then go.")).toEqual([
      "See Smith et al. Then go.",
    ]);
  });

  it("covers every listed abbreviation", () => {
    for (const word of ABBREVIATIONS) {
      expect(split("Word " + word + ". Next part.")).toEqual([
        "Word " + word + ". Next part.",
      ]);
    }
  });

  it("splits after etc. before a capital", () => {
    expect(split("Pods, nodes, etc. Then more.")).toEqual([
      "Pods, nodes, etc.",
      "Then more.",
    ]);
  });

  it("does not split U.S. or initials", () => {
    expect(split("The U.S. Army came.")).toEqual(["The U.S. Army came."]);
    expect(split("Ask A.B.C. Corp now.")).toEqual(["Ask A.B.C. Corp now."]);
    expect(split("Meet J. Smith now.")).toEqual(["Meet J. Smith now."]);
  });

  it("splits on a lowercase letter that is not an initial", () => {
    expect(split("It was a. Then more.")).toEqual(["It was a.", "Then more."]);
  });
});

describe("splitSentences other punctuation", () => {
  it("does not split decimals and versions", () => {
    expect(split("Pi is 3.14 and v1.2.3 ships.")).toEqual([
      "Pi is 3.14 and v1.2.3 ships.",
    ]);
  });

  it("does not split before a lowercase word", () => {
    expect(split("Wait. then go. Fine.")).toEqual(["Wait. then go.", "Fine."]);
  });

  it("does not split on a colon, semicolon or dash", () => {
    expect(split("Note: Do this; Then that - Also this.")).toEqual([
      "Note: Do this; Then that - Also this.",
    ]);
  });
});

describe("splitSentences line breaks", () => {
  it("keeps a soft wrap inside one sentence", () => {
    const md = "This sentence runs\nacross two lines.";
    expect(split(md)).toEqual(["This sentence runs\nacross two lines."]);
    expect(sources(md)).toEqual([md]);
  });

  it("splits at a soft wrap after a sentence end", () => {
    const md = "First one.\nSecond one.";
    expect(split(md)).toEqual(["First one.", "Second one."]);
    expect(sources(md)).toEqual(["First one.", "Second one."]);
  });

  it("splits at a hard break with two spaces", () => {
    const md = "Line one  \nLine two";
    expect(split(md)).toEqual(["Line one", "Line two"]);
    expect(sources(md)).toEqual(["Line one", "Line two"]);
  });

  it("splits at a hard break with a backslash", () => {
    const md = "Line one\\\nLine two";
    expect(split(md)).toEqual(["Line one", "Line two"]);
    expect(sources(md)).toEqual(["Line one", "Line two"]);
  });

  it("splits at <br>", () => {
    expect(split("Line one<br>Line two")).toEqual(["Line one", "Line two"]);
    expect(split("Line one<br/>Line two")).toEqual(["Line one", "Line two"]);
  });

  it("maps source ranges with CRLF line endings", () => {
    const md = "Runs on\r\ntwo lines. Next one.\r\nLast one.";
    expect(sources(md)).toEqual([
      "Runs on\r\ntwo lines.",
      "Next one.",
      "Last one.",
    ]);
  });

  it("maps source ranges inside a blockquote", () => {
    const md = "> Runs on\n> two lines. Next one.";
    expect(sources(md)).toEqual(["Runs on\n> two lines.", "Next one."]);
  });
});

describe("splitSentences placeholders", () => {
  it("does not split on dots inside inline code", () => {
    expect(split("Run `npm.cmd` now. Then wait.")).toEqual([
      "Run {CODE} now.",
      "Then wait.",
    ]);
    expect(split("Run `a. B` now.")).toEqual(["Run {CODE} now."]);
  });

  it("splits after a sentence ending in code", () => {
    const md = "Run `ls`. Then stop.";
    expect(split(md)).toEqual(["Run {CODE}.", "Then stop."]);
    expect(sources(md)).toEqual(["Run `ls`.", "Then stop."]);
  });

  it("splits before a sentence starting with code", () => {
    const md = "Done. `kubectl` lists pods.";
    expect(split(md)).toEqual(["Done.", "{CODE} lists pods."]);
    expect(sources(md)).toEqual(["Done.", "`kubectl` lists pods."]);
  });

  it("splits before a bold UI label", () => {
    expect(split("Done. **Save** the file.")).toEqual([
      "Done.",
      "{UI} the file.",
    ]);
  });

  it("handles a link whose text has a dot", () => {
    expect(split("See [the v1.2 docs. really](https://x.io) now. Go.")).toEqual(
      ["See the v1.2 docs. really now.", "Go."],
    );
  });

  it("does not treat a literal brace as a placeholder start", () => {
    expect(split("Done. {not a placeholder}")).toEqual([
      "Done. {not a placeholder}",
    ]);
    expect(split("Done. {Not a placeholder}")).toEqual([
      "Done. {Not a placeholder}",
    ]);
  });

  it("ends the sentence at a placeholder-only block", () => {
    expect(split("`a`")).toEqual(["{CODE}"]);
  });
});

describe("splitSentences blocks", () => {
  it("splits a heading", () => {
    expect(split("# Install it. Then run it")).toEqual([
      "Install it.",
      "Then run it",
    ]);
  });

  it("splits a table cell", () => {
    const parsed = parseMarkdown("| One. Two. |\n| - |\n", "markdown");
    if (parsed.kind !== "parsed") {
      throw new Error("did not parse");
    }
    const block = firstBlock(parsed.tree);
    if (block?.type !== "tableCell") {
      throw new Error("not a cell");
    }
    const found = splitSentences(maskBlock(block, parsed));
    expect(found.map((s) => s.text)).toEqual(["One.", "Two."]);
    expect(
      found.map((s) => parsed.source.slice(s.source.start, s.source.end)),
    ).toEqual(["One.", "Two."]);
  });
});

describe("splitSentences Unicode spaces", () => {
  it("trims a trailing non-breaking space", () => {
    expect(split("Last one.\u00A0")).toEqual(["Last one."]);
    expect(split("\u00A0Lead and end\u00A0")).toEqual(["Lead and end"]);
  });

  it("splits after a dot and a non-breaking space", () => {
    expect(split("Done.\u00A0Next step.")).toEqual(["Done.", "Next step."]);
  });

  it("splits after a thin or ideographic space", () => {
    expect(split("Done.\u2009Next step.")).toEqual(["Done.", "Next step."]);
    expect(split("Done.\u3000Next step.")).toEqual(["Done.", "Next step."]);
    expect(split("Done.\u202FNext step.")).toEqual(["Done.", "Next step."]);
  });
});
