import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import {
  findIgnoredRanges,
  MAX_IGNORE_WARNINGS,
  type IgnoreScan,
  type SourceRange,
} from "./ignored-ranges.js";
import {
  parseMarkdown,
  type MarkdownSyntax,
  type ParsedMarkdown,
} from "./parse-markdown.js";

function parse(text: string, syntax: MarkdownSyntax): ParsedMarkdown {
  const result = parseMarkdown(text, syntax);
  if (result.kind !== "parsed") {
    throw new Error("fixture failed to parse: " + result.problem);
  }
  return result;
}

interface Scanned {
  readonly scan: IgnoreScan;
  readonly parsed: ParsedMarkdown;
}

function scanText(text: string, syntax: MarkdownSyntax = "markdown"): Scanned {
  const parsed = parse(text, syntax);
  return { scan: findIgnoredRanges(parsed), parsed };
}

function slice(parsed: ParsedMarkdown, range: SourceRange): string {
  return parsed.source.slice(range.start, range.end);
}

function slices(s: Scanned): string[] {
  return s.scan.ignored.map((range) => slice(s.parsed, range));
}

function codes(s: Scanned): string[] {
  return s.scan.warnings.map((w) => `${w.code}@${String(w.line)}`);
}

function readFixture(name: string): string {
  const path = fileURLToPath(new URL("./fixtures/" + name, import.meta.url));
  return readFileSync(path, "utf8").replaceAll("\r\n", "\n");
}

describe("next comments in Markdown", () => {
  it("ignores the next block for each form", () => {
    const s = scanText(
      [
        "<!-- tulis-ignore -->",
        "One.",
        "",
        "<!-- tulis-ignore term.sign-in -->",
        "Two.",
        "",
        "<!-- tulis-ignore term.sign-in, style.passive -->",
        "Three.",
        "",
        "<!-- tulis-ignore: quoted -->",
        "Four.",
        "",
        "<!-- tulis-ignore term.sign-in: quoted -->",
        "Five.",
      ].join("\n"),
    );
    expect(slices(s)).toEqual(["One.", "Two.", "Three.", "Four.", "Five."]);
    expect(s.scan.ignored.map((r) => r.checks)).toEqual([
      [],
      ["term.sign-in"],
      ["term.sign-in", "style.passive"],
      [],
      ["term.sign-in"],
    ]);
    expect(s.scan.ignored.map((r) => r.reason)).toEqual([
      undefined,
      undefined,
      undefined,
      "quoted",
      "quoted",
    ]);
    expect(s.scan.ignored.map((r) => r.line)).toEqual([1, 4, 7, 10, 13]);
    expect(s.scan.ignored.every((r) => r.kind === "next")).toBe(true);
    expect(s.scan.warnings).toEqual([]);
  });

  it("works with no blank line after the comment", () => {
    const s = scanText("<!-- tulis-ignore -->\nNext line.\n\nAfter.");
    expect(slices(s)).toEqual(["Next line."]);
  });

  it.each([
    ["a heading", "## Heading", "## Heading"],
    ["a list", "- a\n- b", "- a\n- b"],
    ["a code block", "```js\nlet x;\n```", "```js\nlet x;\n```"],
    [
      "a table",
      "| a | b |\n| - | - |\n| 1 | 2 |",
      "| a | b |\n| - | - |\n| 1 | 2 |",
    ],
    ["a blockquote", "> quoted\n> more", "> quoted\n> more"],
  ])("covers %s", (_name, block, expected) => {
    const s = scanText(`<!-- tulis-ignore -->\n${block}\n\nAfter.`);
    expect(slices(s)).toEqual([expected]);
  });

  it("uses the sibling inside a list item", () => {
    const s = scanText("- item\n\n  <!-- tulis-ignore -->\n  inner\n\nouter");
    expect(slices(s)).toEqual(["inner"]);
  });

  it("uses the sibling inside a blockquote", () => {
    const s = scanText("> <!-- tulis-ignore -->\n> quoted\n\nouter");
    expect(slices(s)).toEqual(["quoted"]);
  });

  it("warns when a comment is the last child of a list item", () => {
    const s = scanText("- item\n\n  <!-- tulis-ignore -->\n\nouter");
    expect(slices(s)).toEqual([]);
    expect(codes(s)).toEqual(["nothing-to-ignore@3"]);
  });

  it("applies stacked comments to the same block", () => {
    const s = scanText(
      "<!-- tulis-ignore a.b -->\n<!-- tulis-ignore c.d: why -->\nBlock.\n",
    );
    expect(slices(s)).toEqual(["Block.", "Block."]);
    expect(s.scan.ignored.map((r) => r.checks)).toEqual([["a.b"], ["c.d"]]);
    expect(s.scan.ignored.map((r) => r.reason)).toEqual([undefined, "why"]);
    expect(s.scan.ignored.map((r) => r.line)).toEqual([1, 2]);
  });

  it("warns for each stacked comment at the end of the doc", () => {
    const s = scanText("Text.\n\n<!-- tulis-ignore -->\n<!-- tulis-ignore -->");
    expect(slices(s)).toEqual([]);
    expect(codes(s)).toEqual(["nothing-to-ignore@3", "nothing-to-ignore@4"]);
  });
});

describe("start and end comments", () => {
  it("ignores from the end of the start comment to the start of the end", () => {
    const s = scanText(
      "<!-- tulis-ignore-start -->\n\nInside.\n\n<!-- tulis-ignore-end -->\n\nOutside.",
    );
    expect(slices(s)).toEqual(["\n\nInside.\n\n"]);
    expect(s.scan.ignored[0]?.kind).toBe("range");
    expect(s.scan.warnings).toEqual([]);
  });

  it("keeps the checks and reason of the start comment", () => {
    const s = scanText(
      "<!-- tulis-ignore-start a.b, c.d: legacy -->\n\nIn.\n\n<!-- tulis-ignore-end -->",
    );
    expect(s.scan.ignored[0]).toMatchObject({
      checks: ["a.b", "c.d"],
      reason: "legacy",
      line: 1,
    });
  });

  it("nests ranges", () => {
    const s = scanText(
      [
        "<!-- tulis-ignore-start a.b -->",
        "",
        "outer one",
        "",
        "<!-- tulis-ignore-start c.d -->",
        "",
        "inner",
        "",
        "<!-- tulis-ignore-end -->",
        "",
        "outer two",
        "",
        "<!-- tulis-ignore-end -->",
      ].join("\n"),
    );
    expect(s.scan.ignored).toHaveLength(2);
    const [outer, inner] = s.scan.ignored;
    expect(outer?.checks).toEqual(["a.b"]);
    expect(inner?.checks).toEqual(["c.d"]);
    expect(slices(s)[1]).toBe("\n\ninner\n\n");
    expect(slices(s)[0]).toBe(
      "\n\nouter one\n\n<!-- tulis-ignore-start c.d -->\n\ninner\n\n<!-- tulis-ignore-end -->\n\nouter two\n\n",
    );
  });

  it("lets a range start in a list item and end at the root", () => {
    const s = scanText(
      "- item\n\n  <!-- tulis-ignore-start -->\n\n  inner\n\nouter\n\n<!-- tulis-ignore-end -->\n",
    );
    expect(slices(s)).toEqual(["\n\n  inner\n\nouter\n\n"]);
    expect(s.scan.warnings).toEqual([]);
  });

  it("runs an unclosed start to the end of the doc", () => {
    const s = scanText("Intro.\n\n<!-- tulis-ignore-start -->\n\nRest.\n");
    expect(slices(s)).toEqual(["\n\nRest.\n"]);
    expect(s.scan.ignored[0]?.end).toBe(s.parsed.source.length);
    expect(codes(s)).toEqual(["unclosed-start@3"]);
  });

  it("handles two unclosed starts", () => {
    const s = scanText(
      "<!-- tulis-ignore-start a.b -->\n\nOne.\n\n<!-- tulis-ignore-start c.d -->\n\nTwo.",
    );
    expect(s.scan.ignored.map((r) => r.end)).toEqual([
      s.parsed.source.length,
      s.parsed.source.length,
    ]);
    expect(codes(s)).toEqual(["unclosed-start@1", "unclosed-start@5"]);
  });

  it("warns about a stray end and does nothing", () => {
    const s = scanText("One.\n\n<!-- tulis-ignore-end -->\n\nTwo.");
    expect(s.scan.ignored).toEqual([]);
    expect(codes(s)).toEqual(["stray-end@3"]);
  });
});

describe("warnings", () => {
  it("does not apply inline comments in a paragraph or heading", () => {
    const s = scanText(
      "Text <!-- tulis-ignore --> more.\n\n# Head <!-- tulis-ignore-start --> x\n\n| a |\n| - |\n| <!-- tulis-ignore --> |\n",
    );
    expect(s.scan.ignored).toEqual([]);
    expect(codes(s)).toEqual([
      "inline-comment@1",
      "inline-comment@3",
      "inline-comment@7",
    ]);
  });

  it("gives only inline-comment for a malformed inline comment", () => {
    const s = scanText("Text <!-- tulis-ignore-bogus --> more.");
    expect(codes(s)).toEqual(["inline-comment@1"]);
  });

  it("reports the column of the comment", () => {
    const s = scanText("Text <!-- tulis-ignore --> more.");
    expect(s.scan.warnings).toEqual([
      { code: "inline-comment", line: 1, column: 6 },
    ]);
  });

  it("gives the problem code for malformed block comments", () => {
    const s = scanText(
      [
        "<!-- tulis-ignore-bogus -->",
        "",
        "<!-- tulis-ignore Bad_ID -->",
        "",
        "<!-- tulis-ignore a.b c.d e.f g.h i.j k.l m.n o.p q.r s.t u.v -->",
        "",
        "<!-- tulis-ignore-end a.b -->",
        "",
        `<!-- tulis-ignore ${"x".repeat(1100)} -->`,
        "",
        "Text.",
      ].join("\n"),
    );
    expect(s.scan.ignored).toEqual([]);
    expect(codes(s)).toEqual([
      "unknown-form@1",
      "bad-check-id@3",
      "too-many-checks@5",
      "end-with-checks@7",
      "too-long@9",
    ]);
  });

  it("warns not-alone when the comment shares its node", () => {
    const s = scanText(
      "<!-- tulis-ignore --> Login here\n\n<!-- tulis-ignore --><!-- x -->\n\n<!-- TULIS-IGNORE --> text",
    );
    expect(s.scan.ignored).toEqual([]);
    expect(codes(s)).toEqual(["not-alone@1", "not-alone@3", "not-alone@5"]);
  });

  it("ignores ordinary comments but lists them as html", () => {
    const s = scanText("<!-- TODO -->\n\nText.");
    expect(s.scan.ignored).toEqual([]);
    expect(s.scan.warnings).toEqual([]);
    expect(s.scan.htmlRanges.map((r) => slice(s.parsed, r))).toEqual([
      "<!-- TODO -->",
    ]);
  });

  it("caps warnings at 100 and counts the rest", () => {
    const text = Array.from(
      { length: 150 },
      () => "<!-- tulis-ignore-bogus -->",
    ).join("\n\n");
    const s = scanText(text);
    expect(s.scan.warnings).toHaveLength(MAX_IGNORE_WARNINGS);
    expect(s.scan.moreWarnings).toBe(50);
    expect(s.scan.warnings[0]?.line).toBe(1);
    expect(s.scan.warnings[99]?.line).toBe(199);
  });
});

describe("htmlRanges", () => {
  it("lists an HTML block", () => {
    const s = scanText("<div>\nhello\n</div>\n\nText.");
    expect(s.scan.htmlRanges.map((r) => slice(s.parsed, r))).toEqual([
      "<div>\nhello\n</div>",
    ]);
  });

  it("lists each inline tag", () => {
    const s = scanText("Press <kbd>Ctrl</kbd> now.");
    expect(s.scan.htmlRanges.map((r) => slice(s.parsed, r))).toEqual([
      "<kbd>",
      "</kbd>",
    ]);
  });

  it("lists ignore comments too", () => {
    const s = scanText("<!-- tulis-ignore -->\nText.");
    expect(s.scan.htmlRanges.map((r) => slice(s.parsed, r))).toEqual([
      "<!-- tulis-ignore -->",
    ]);
  });

  it("has none for MDX", () => {
    const s = scanText("{/* tulis-ignore */}\nText.\n", "mdx");
    expect(s.scan.htmlRanges).toEqual([]);
  });
});

describe("code is not a comment", () => {
  it("ignores examples in fenced and inline code", () => {
    const s = scanText(
      "```html\n<!-- tulis-ignore -->\n<!-- tulis-ignore-start -->\n```\n\nUse `<!-- tulis-ignore -->` here.\n\n    <!-- tulis-ignore-end -->\n",
    );
    expect(s.scan.ignored).toEqual([]);
    expect(s.scan.warnings).toEqual([]);
    expect(s.scan.htmlRanges).toEqual([]);
  });

  it("ignores examples in code in MDX", () => {
    const s = scanText(
      "```md\n{/* tulis-ignore */}\n```\n\nUse `{/* tulis-ignore */}` here.\n",
      "mdx",
    );
    expect(s.scan.ignored).toEqual([]);
    expect(s.scan.warnings).toEqual([]);
  });
});

describe("MDX", () => {
  it("handles each form", () => {
    const s = scanText(
      [
        "{/* tulis-ignore */}",
        "One.",
        "",
        "{/* tulis-ignore term.sign-in */}",
        "Two.",
        "",
        "{/* tulis-ignore term.sign-in, style.passive */}",
        "Three.",
        "",
        "{/* tulis-ignore: quoted */}",
        "Four.",
        "",
        "{/* tulis-ignore term.sign-in: quoted */}",
        "Five.",
        "",
        "{/* tulis-ignore-start a.b: why */}",
        "",
        "Six.",
        "",
        "{/* tulis-ignore-end */}",
      ].join("\n"),
      "mdx",
    );
    expect(slices(s)).toEqual([
      "One.",
      "Two.",
      "Three.",
      "Four.",
      "Five.",
      "\n\nSix.\n\n",
    ]);
    expect(s.scan.ignored[5]).toMatchObject({
      kind: "range",
      checks: ["a.b"],
      reason: "why",
    });
    expect(s.scan.warnings).toEqual([]);
  });

  it("does not apply an inline expression", () => {
    const s = scanText("Text {/* tulis-ignore */} more.\n", "mdx");
    expect(s.scan.ignored).toEqual([]);
    expect(codes(s)).toEqual(["inline-comment@1"]);
  });

  it("warns for malformed and not-alone expressions", () => {
    const s = scanText(
      "{/* tulis-ignore-bogus */}\n\n{/* tulis-ignore */ 1}\n",
      "mdx",
    );
    expect(codes(s)).toEqual(["unknown-form@1", "not-alone@3"]);
  });

  it("does nothing for an MDX comment in a .md file", () => {
    const s = scanText("{/* tulis-ignore */}\nText.\n");
    expect(s.scan.ignored).toEqual([]);
    expect(s.scan.warnings).toEqual([]);
  });
});

describe("fixtures", () => {
  const md = readFixture("ignore-comments.md");
  const mdx = readFixture("ignore-comments.mdx");

  it("reads the Markdown fixture", () => {
    const s = scanText(md);
    expect(slices(s)).toEqual([
      "Plain next block.",
      "Paragraph with one check.",
      "Paragraph with two checks.",
      "Paragraph with a reason.",
      "Paragraph with a check and a reason.",
      "\n\nInside the range.\n\n",
    ]);
    expect(codes(s)).toEqual(["inline-comment@26"]);
    expect(s.scan.ignored[3]?.reason).toBe("quoted from the vendor");
    expect(s.scan.ignored[5]).toMatchObject({
      checks: ["term.sign-in", "style.passive"],
      reason: "legacy section",
    });
    expect(s.scan.htmlRanges.map((r) => slice(s.parsed, r))).toContain(
      "<!-- TODO: an ordinary comment -->",
    );
  });

  it("reads the MDX fixture", () => {
    const s = scanText(mdx, "mdx");
    expect(slices(s)).toEqual([
      "Plain next block.",
      "Paragraph with one check.",
      "Paragraph with two checks.",
      "Paragraph with a reason.",
      "Paragraph with a check and a reason.",
      "\n\nInside the range.\n\n",
      "Last paragraph.",
    ]);
    expect(codes(s)).toEqual(["inline-comment@26"]);
    expect(s.scan.htmlRanges).toEqual([]);
  });

  it("gives the same text and lines with CRLF and BOM", () => {
    const base = scanText(md);
    const crlf = scanText(md.replaceAll("\n", "\r\n"));
    const bom = scanText("\uFEFF" + md);
    const normalise = (s: Scanned): string[] =>
      slices(s).map((text) => text.replaceAll("\r\n", "\n"));
    expect(normalise(crlf)).toEqual(slices(base));
    expect(normalise(bom)).toEqual(slices(base));
    expect(crlf.scan.ignored.map((r) => r.line)).toEqual(
      base.scan.ignored.map((r) => r.line),
    );
    expect(bom.scan.ignored.map((r) => r.line)).toEqual(
      base.scan.ignored.map((r) => r.line),
    );
    expect(crlf.scan.warnings).toEqual(base.scan.warnings);
    expect(bom.scan.warnings).toEqual(base.scan.warnings);
  });
});
