import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import type { Root, RootContent, TableCell } from "mdast";
import { describe, expect, it } from "vitest";
import {
  maskBlock,
  MAX_UI_LABEL_WORDS,
  type MaskableBlock,
  type MaskOptions,
} from "./mask-block.js";
import { toSourceRange, type MaskedText } from "./masked-text.js";
import {
  parseMarkdown,
  type MarkdownSyntax,
  type ParsedMarkdown,
} from "./parse-markdown.js";
import { createProductNameMatcher } from "./product-names.js";

const BOM = "\uFEFF";

function parse(text: string, syntax: MarkdownSyntax = "markdown") {
  const result = parseMarkdown(text, syntax);
  if (result.kind !== "parsed") {
    throw new Error("did not parse: " + result.message);
  }
  return result;
}

function isBlock(node: Root | RootContent): node is MaskableBlock {
  return (
    node.type === "paragraph" ||
    node.type === "heading" ||
    node.type === "tableCell"
  );
}

/** Every paragraph, heading and table cell in document order. */
function blocksOf(node: Root | RootContent, into: MaskableBlock[] = []) {
  if (isBlock(node)) {
    into.push(node);
  }
  if ("children" in node) {
    for (const child of node.children) {
      blocksOf(child, into);
    }
  }
  return into;
}

function checkInvariants(masked: MaskedText, source: string): void {
  let end = 0;
  for (const segment of masked.segments) {
    expect(segment.maskedStart).toBe(end);
    end = segment.maskedEnd;
    if (!segment.atomic) {
      expect(masked.text.slice(segment.maskedStart, segment.maskedEnd)).toBe(
        source.slice(segment.sourceStart, segment.sourceEnd),
      );
    }
  }
  expect(end).toBe(masked.text.length);
}

/** "KIND:markup" for each placeholder, from the source. */
function placeholderSources(masked: MaskedText, source: string): string[] {
  return masked.placeholders.map(
    (p) => p.kind + ":" + source.slice(p.source.start, p.source.end),
  );
}

interface Case {
  readonly text: string;
  readonly placeholders: string[];
}

function maskAt(
  parsed: ParsedMarkdown,
  index: number,
  options?: MaskOptions,
): MaskedText {
  const block = blocksOf(parsed.tree)[index];
  if (block === undefined) {
    throw new Error("no block " + String(index));
  }
  const masked = maskBlock(block, parsed, options);
  checkInvariants(masked, parsed.source);
  return masked;
}

/** Masks the first block and returns the text and the placeholder markup. */
function run(
  md: string,
  options?: MaskOptions,
  syntax: MarkdownSyntax = "markdown",
): Case {
  const parsed = parse(md, syntax);
  const masked = maskAt(parsed, 0, options);
  return {
    text: masked.text,
    placeholders: placeholderSources(masked, parsed.source),
  };
}

describe("maskBlock inline rules", () => {
  it("masks the example sentence", () => {
    expect(
      run("Select **Save**, then run `kubectl apply` {{< note >}}"),
    ).toEqual({
      text: "Select {UI}, then run {CODE} {SHORTCODE}",
      placeholders: [
        "UI:**Save**",
        "CODE:`kubectl apply`",
        "SHORTCODE:{{< note >}}",
      ],
    });
  });

  it("keeps plain text and emphasis, never outputs markup", () => {
    expect(run("A *soft* and ~~gone~~ word.\n")).toEqual({
      text: "A soft and gone word.",
      placeholders: [],
    });
  });

  it("keeps an admonition label at the paragraph start as prose", () => {
    expect(run("**Note:** be careful").text).toBe("Note: be careful");
    expect(run("**Note**: be careful").text).toBe("Note: be careful");
    expect(run("**Note:** be careful").placeholders).toEqual([]);
  });

  it("masks a colon label that is not at the paragraph start", () => {
    expect(run("See **Note:** here").text).toBe("See {UI} here");
    expect(run("a **Note**: b").text).toBe("a {UI}: b");
  });

  it("masks bold of up to the word limit", () => {
    const six = Array.from({ length: MAX_UI_LABEL_WORDS }, () => "w").join(" ");
    expect(run("x **" + six + "** y").text).toBe("x {UI} y");
    expect(run("x **" + six + " w** y").text).toBe("x " + six + " w y");
  });

  it("counts inline code and emphasis inside bold as label words", () => {
    const result = run("Run **the `kubectl` _tool_** now");
    expect(result.text).toBe("Run {UI} now");
    expect(result.placeholders).toEqual(["UI:**the `kubectl` _tool_**"]);
    expect(run("a **b `c` d e f g h** z").text).toBe("a b {CODE} d e f g h z");
  });

  it("keeps link text and drops the URL", () => {
    expect(run("Open [the docs](https://example.com/a) now")).toEqual({
      text: "Open the docs now",
      placeholders: [],
    });
  });

  it("masks autolinks and literal URLs", () => {
    expect(run("Go to <https://example.com/x> now")).toEqual({
      text: "Go to {URL} now",
      placeholders: ["URL:<https://example.com/x>"],
    });
    expect(run("Mail <a@b.co> now").text).toBe("Mail {URL} now");
    expect(run("Visit https://example.com/x now")).toEqual({
      text: "Visit {URL} now",
      placeholders: ["URL:https://example.com/x"],
    });
    expect(run("Visit www.example.com now").text).toBe("Visit {URL} now");
  });

  it("keeps reference link text", () => {
    const result = run(
      "See [the docs][ref] and [ref].\n\n[ref]: https://x.y\n",
    );
    expect(result.text).toBe("See the docs and ref.");
  });

  it("masks images", () => {
    expect(run("An ![alt text](a.png) here")).toEqual({
      text: "An {IMAGE} here",
      placeholders: ["IMAGE:![alt text](a.png)"],
    });
    expect(run("An ![alt][img] here\n\n[img]: a.png\n").text).toBe(
      "An {IMAGE} here",
    );
  });

  it("outputs nothing for footnote references", () => {
    expect(run("Word[^1] more\n\n[^1]: note\n").text).toBe("Word more");
  });

  it("masks inline html pairs including their content", () => {
    expect(run("Press <kbd>Ctrl</kbd>+<kbd>C</kbd> now")).toEqual({
      text: "Press {HTML}+{HTML} now",
      placeholders: ["HTML:<kbd>Ctrl</kbd>", "HTML:<kbd>C</kbd>"],
    });
  });

  it("pairs nested tags of the same name", () => {
    expect(run("a <span>b <span>c</span> d</span> e")).toEqual({
      text: "a {HTML} e",
      placeholders: ["HTML:<span>b <span>c</span> d</span>"],
    });
  });

  it("pairs tag names without regard to case", () => {
    expect(run("a <KBD>x</kbd> b").text).toBe("a {HTML} b");
  });

  it("outputs nothing for lone tags, comments and self-closing tags", () => {
    expect(run("a <kbd>b c").text).toBe("a b c");
    expect(run("a b</kbd> c").text).toBe("a b c");
    expect(run("a <!-- hidden --> b").text).toBe("a  b");
    expect(run("a <img src=x /> b").text).toBe("a  b");
    expect(run("a <b>x</b><i>y").text).toBe("a {HTML}y");
  });

  it("turns br tags and hard breaks into newlines", () => {
    expect(run("a<br>b<br/>c<br />d").text).toBe("a\nb\nc\nd");
    const result = run("a  \nb\\\nc");
    expect(result.text).toBe("a\nb\nc");
  });

  it("masks product names in text and link text only", () => {
    const productNames = createProductNameMatcher(["Azure DevOps", "Tulis"]);
    expect(
      run("Use Azure DevOps and [Tulis docs](https://x.y) now", {
        productNames,
      }),
    ).toEqual({
      text: "Use {PRODUCT} and {PRODUCT} docs now",
      placeholders: ["PRODUCT:Azure DevOps", "PRODUCT:Tulis"],
    });
    expect(run("Run `Tulis` and **Tulis** end", { productNames }).text).toBe(
      "Run {CODE} and {UI} end",
    );
    const escaped = run("Tul&#105;s rocks", { productNames });
    expect(escaped.text).toBe("{PRODUCT} rocks");
    expect(escaped.placeholders).toEqual(["PRODUCT:Tul&#105;s"]);
  });

  it("leaves product names alone without a matcher", () => {
    expect(run("Use Tulis now").text).toBe("Use Tulis now");
  });
});

describe("maskBlock template tags", () => {
  it.each([
    ["{{< note >}}", "a {{< note >}} b"],
    ["{{<note>}}", "a {{<note>}} b"],
    ['{{% tab name="x" %}}', 'a {{% tab name="x" %}} b'],
    ["{% include x %}", "a {% include x %} b"],
    ["{{ .Site.Title }}", "a {{ .Site.Title }} b"],
  ])("masks %s", (tag, md) => {
    expect(run(md)).toEqual({
      text: "a {SHORTCODE} b",
      placeholders: ["SHORTCODE:" + tag],
    });
  });

  it("masks both tags of a pair and keeps the text between", () => {
    expect(run("{{< note >}}Be careful.{{< /note >}}")).toEqual({
      text: "{SHORTCODE}Be careful.{SHORTCODE}",
      placeholders: ["SHORTCODE:{{< note >}}", "SHORTCODE:{{< /note >}}"],
    });
    expect(run("{{<note>}}Be careful.{{</note>}}").text).toBe(
      "{SHORTCODE}Be careful.{SHORTCODE}",
    );
  });

  it("lets inline code win over a tag inside it", () => {
    expect(run("Use `{{ .Site.Title }}` now")).toEqual({
      text: "Use {CODE} now",
      placeholders: ["CODE:`{{ .Site.Title }}`"],
    });
  });

  it("cuts a text node in the middle", () => {
    const parsed = parse("before {{ x }} after");
    const masked = maskAt(parsed, 0);
    expect(masked.text).toBe("before {SHORTCODE} after");
    expect(masked.segments.map((s) => s.sourceStart)).toEqual([0, 7, 14]);
  });

  it("masks a tag inside bold without making a UI label of it", () => {
    expect(run("a **b {{ x }} c** d")).toEqual({
      text: "a b {SHORTCODE} c d",
      placeholders: ["SHORTCODE:{{ x }}"],
    });
  });

  it("masks a tag inside emphasis and link text", () => {
    expect(run("a *b {{ x }} c* d").text).toBe("a b {SHORTCODE} c d");
    expect(run("a [b {{ x }} c](u) d").text).toBe("a b {SHORTCODE} c d");
  });

  it("masks a tag that touches an inline html node", () => {
    expect(run("a {{< x >}}<b>y</b> z").text).toBe("a {SHORTCODE}{HTML} z");
  });

  it("swallows a tag inside an html pair into one HTML placeholder", () => {
    expect(run("a <span>x {{< n >}} y</span> b")).toEqual({
      text: "a {HTML} b",
      placeholders: ["HTML:<span>x {{< n >}} y</span>"],
    });
  });

  it("masks a tag that starts inside a tag-touching html opener", () => {
    expect(run("a <span {{< n >}}>x</span> b").placeholders).toEqual([
      "SHORTCODE:{{< n >}}",
    ]);
  });

  it("handles {{ x }} in mdx as an expression, not a template tag", () => {
    // The parser accepts it as a JS expression; mdx runs no tag search.
    expect(run("A {{ x }} b\n", undefined, "mdx")).toEqual({
      text: "A {SHORTCODE} b",
      placeholders: ["SHORTCODE:{{ x }}"],
    });
    // Template tag syntax that is not JS does not parse in mdx at all.
    expect(parseMarkdown("A {% x %} b\n", "mdx").kind).toBe("failed");
  });
});

describe("maskBlock block kinds", () => {
  it("masks a hard-wrapped paragraph in a blockquote", () => {
    const parsed = parse("> one **Open**\n> two three\n");
    const masked = maskAt(parsed, 0);
    expect(masked.text).toBe("one {UI}\ntwo three");
    expect(toSourceRange(masked, 9, 12)).toEqual({ start: 17, end: 20 });
  });

  it("masks a hard-wrapped paragraph in a list item", () => {
    const parsed = parse("- one `c`\n  two three\n");
    const masked = maskAt(parsed, 0);
    expect(masked.text).toBe("one {CODE}\ntwo three");
  });

  it("masks ATX and setext headings", () => {
    expect(run("## Install `kubectl` now ##\n").text).toBe(
      "Install {CODE} now",
    );
    expect(run("Install **Save**\n=====\n")).toEqual({
      text: "Install {UI}",
      placeholders: ["UI:**Save**"],
    });
  });

  it("masks table cells", () => {
    const parsed = parse("| A | B |\n| - | - |\n| `x` | y **Go** |\n");
    const texts = blocksOf(parsed.tree)
      .filter((b): b is TableCell => b.type === "tableCell")
      .map((_, i) => maskAt(parsed, i).text);
    expect(texts).toEqual(["A", "B", "{CODE}", "y {UI}"]);
  });

  it("keeps an admonition label at the start of a heading or cell", () => {
    expect(run("# **Note:** x\n").text).toBe("Note: x");
    const parsed = parse("| A | B |\n| - | - |\n| **Note**: `c` | **Go** |\n");
    expect(maskAt(parsed, 2).text).toBe("Note: {CODE}");
    expect(maskAt(parsed, 3).text).toBe("{UI}");
  });

  it("returns empty text for an empty block", () => {
    const parsed = parse("# \n");
    const heading = blocksOf(parsed.tree)[0];
    expect(heading?.type).toBe("heading");
    expect(heading && maskBlock(heading, parsed).text).toBe("");
  });
});

describe("maskBlock in mdx", () => {
  it("masks JSX elements and expressions and drops comments", () => {
    expect(run('a <Badge color="red">new</Badge> b', undefined, "mdx")).toEqual(
      {
        text: "a {HTML} b",
        placeholders: ['HTML:<Badge color="red">new</Badge>'],
      },
    );
    expect(run("a {props.count} b", undefined, "mdx")).toEqual({
      text: "a {SHORTCODE} b",
      placeholders: ["SHORTCODE:{props.count}"],
    });
    expect(run("a {/* note */}b", undefined, "mdx").text).toBe("a b");
  });
});

function readFixture(name: string): string {
  const path = fileURLToPath(new URL("./fixtures/" + name, import.meta.url));
  return readFileSync(path, "utf8").replaceAll("\r\n", "\n");
}

describe("maskBlock on the masking fixtures", () => {
  const lf = readFixture("masking.md");
  const variants: [string, string][] = [
    ["lf", lf],
    ["crlf", lf.replaceAll("\n", "\r\n")],
    ["bom", BOM + lf],
  ];

  for (const [name, text] of variants) {
    it("masks every block of the " + name + " variant", () => {
      const parsed = parse(text);
      const blocks = blocksOf(parsed.tree);
      const texts = blocks.map((_, i) => {
        const masked = maskAt(parsed, i);
        return masked.text.replaceAll("\r\n", "\n");
      });
      expect(texts).toEqual([
        "Install the {CODE} tool",
        "Select {UI}, then run {CODE} {SHORTCODE} to finish.",
        "The Azure Portal shows a status page after\nyou sign in, and it keeps the page open\nfor a while.",
        "Press {HTML}+{HTML} to stop.\nThen start again.",
        "A quoted line that wraps\nover two lines with {UI} in it.",
        "A list item that wraps\nover two lines with {CODE} in it.",
        "Name",
        "Action",
        "Save",
        "Select {UI} now",
      ]);
    });
  }

  it("maps a word after a placeholder to the right line and column", () => {
    const parsed = parse(lf);
    const masked = maskAt(parsed, 1);
    const at = masked.text.indexOf("finish");
    const range = toSourceRange(masked, at, at + "finish".length);
    const before = parsed.source.slice(0, range.start).split("\n");
    expect(before.length).toBe(3);
    expect((before[before.length - 1] ?? "").length).toBe(
      "Select **Save**, then run `kubectl apply` {{< note >}} to ".length,
    );
    expect(parsed.source.slice(range.start, range.end)).toBe("finish");
  });

  it("maps correctly in the CRLF variant", () => {
    const parsed = parse(lf.replaceAll("\n", "\r\n"));
    const masked = maskAt(parsed, 1);
    const at = masked.text.indexOf("finish");
    const range = toSourceRange(masked, at, at + 6);
    expect(parsed.source.slice(range.start, range.end)).toBe("finish");
  });

  it("masks the mdx fixture", () => {
    const parsed = parse(readFixture("masking.mdx"), "mdx");
    const texts = blocksOf(parsed.tree).map((_, i) => maskAt(parsed, i).text);
    expect(texts[1]).toBe("Select {UI}, then use {HTML} here.");
    expect(texts[2]).toBe("The value is {SHORTCODE} items.");
    expect(texts[3]).toBe("A word after a comment.");
    expect(texts[4]).toBe("A literal {SHORTCODE} stays text.");
  });
});
