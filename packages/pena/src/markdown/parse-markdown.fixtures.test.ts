import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import type { Root, RootContent } from "mdast";
import { describe, expect, it } from "vitest";
import {
  parseMarkdown,
  syntaxForPath,
  type ParsedMarkdown,
} from "./parse-markdown.js";

const BOM = "\uFEFF";

const FIXTURES = [
  "plain.md",
  "gfm.md",
  "frontmatter-yaml.md",
  "frontmatter-toml.md",
  "docusaurus.md",
  "hugo.md",
  "html.md",
  "mdx.mdx",
] as const;

type FixtureName = (typeof FIXTURES)[number];
type TreeNode = Root | RootContent;
type VariantName = "lf" | "crlf" | "bom";

/** Git on Windows may check the files out with CRLF, so normalize to LF. */
function readFixture(name: string): string {
  const path = fileURLToPath(new URL("./fixtures/" + name, import.meta.url));
  return readFileSync(path, "utf8").replaceAll("\r\n", "\n");
}

function variantText(lf: string, variant: VariantName): string {
  if (variant === "crlf") {
    return lf.replaceAll("\n", "\r\n");
  }
  if (variant === "bom") {
    return BOM + lf;
  }
  return lf;
}

function parseFixture(
  name: FixtureName,
  variant: VariantName = "lf",
): ParsedMarkdown {
  const syntax = syntaxForPath(name);
  if (syntax === undefined) {
    throw new Error(`no syntax for ${name}`);
  }
  const result = parseMarkdown(variantText(readFixture(name), variant), syntax);
  if (result.kind !== "parsed") {
    throw new Error(`${name} did not parse: ${result.message}`);
  }
  return result;
}

/** Every node in document order, walked without recursion. */
function allNodes(tree: Root): TreeNode[] {
  const nodes: TreeNode[] = [];
  const stack: TreeNode[] = [tree];
  for (let node = stack.pop(); node !== undefined; node = stack.pop()) {
    nodes.push(node);
    if ("children" in node) {
      for (let i = node.children.length - 1; i >= 0; i--) {
        const child = node.children[i];
        if (child !== undefined) {
          stack.push(child);
        }
      }
    }
  }
  return nodes;
}

/** Expected line and column (both 1-based) for an offset; `\r\n`, `\n` and a lone `\r` end a line. */
function pointAt(
  source: string,
  offset: number,
): { line: number; column: number } {
  let line = 1;
  let lineStart = 0;
  let i = 0;
  while (i < offset) {
    const char = source[i];
    if (char === "\r" && source[i + 1] === "\n") {
      i += 2;
      line++;
      lineStart = i;
    } else if (char === "\r" || char === "\n") {
      i++;
      line++;
      lineStart = i;
    } else {
      i++;
    }
  }
  return { line, column: offset - lineStart + 1 };
}

function rangeOf(node: TreeNode): { start: number; end: number } {
  const start = node.position?.start.offset;
  const end = node.position?.end.offset;
  if (start === undefined || end === undefined) {
    throw new Error(`node ${node.type} has no offsets`);
  }
  return { start, end };
}

function sliceOf(result: ParsedMarkdown, node: TreeNode): string {
  const { start, end } = rangeOf(node);
  return result.source.slice(start, end);
}

function textOf(node: TreeNode): string | undefined {
  return "value" in node && typeof node.value === "string"
    ? node.value
    : undefined;
}

function findAll(
  result: ParsedMarkdown,
  type: string,
  predicate: (node: TreeNode) => boolean = () => true,
): TreeNode[] {
  return allNodes(result.tree).filter(
    (node) => node.type === type && predicate(node),
  );
}

function findOne(
  result: ParsedMarkdown,
  type: string,
  predicate: (node: TreeNode) => boolean = () => true,
): TreeNode {
  const found = findAll(result, type, predicate);
  const first = found[0];
  if (first === undefined) {
    throw new Error(`no ${type} node found`);
  }
  return first;
}

function typeSet(result: ParsedMarkdown): Set<string> {
  return new Set(allNodes(result.tree).map((node) => node.type));
}

function directiveName(node: TreeNode): string | undefined {
  return node.type === "containerDirective" ? node.name : undefined;
}

function directiveNames(result: ParsedMarkdown): (string | undefined)[] {
  return findAll(result, "containerDirective").map(directiveName);
}

const VARIANTS: VariantName[] = ["lf", "crlf", "bom"];

describe("fixture docs parse", () => {
  it.each(FIXTURES)("%s parses with the syntax for its extension", (name) => {
    const result = parseFixture(name);
    expect(result.syntax).toBe(name.endsWith(".mdx") ? "mdx" : "markdown");
    expect(result.tree.children.length).toBeGreaterThan(5);
  });

  it("no .md fixture has an mdx node type", () => {
    for (const name of FIXTURES.filter((n) => n.endsWith(".md"))) {
      const mdxTypes = [...typeSet(parseFixture(name))].filter((type) =>
        type.startsWith("mdx"),
      );
      expect(mdxTypes, name).toEqual([]);
    }
  });

  it("plain.md has the common Markdown node types", () => {
    const types = typeSet(parseFixture("plain.md"));
    for (const type of [
      "heading",
      "paragraph",
      "strong",
      "emphasis",
      "inlineCode",
      "link",
      "image",
      "list",
      "listItem",
      "blockquote",
      "code",
    ]) {
      expect(types.has(type), type).toBe(true);
    }
    const depths = findAll(parseFixture("plain.md"), "heading").map((node) =>
      node.type === "heading" ? node.depth : 0,
    );
    expect(depths).toEqual([1, 2, 3, 3]);
    const fenced = findAll(parseFixture("plain.md"), "code").map((node) =>
      node.type === "code" ? node.lang : undefined,
    );
    expect(fenced).toEqual(["bash", null]);
  });

  it("gfm.md has a table, a task list, a footnote and strikethrough", () => {
    const result = parseFixture("gfm.md");
    const types = typeSet(result);
    for (const type of [
      "table",
      "tableRow",
      "tableCell",
      "footnoteReference",
      "footnoteDefinition",
      "delete",
    ]) {
      expect(types.has(type), type).toBe(true);
    }
    const checked = findAll(result, "listItem").map((node) =>
      node.type === "listItem" ? node.checked : undefined,
    );
    expect(checked).toEqual([true, false]);
    const autolink = findOne(
      result,
      "link",
      (node) => node.type === "link" && node.url === "https://example.com/pena",
    );
    expect(sliceOf(result, autolink)).toBe("https://example.com/pena");
  });

  it("the frontmatter fixtures start with a yaml or toml node", () => {
    const yaml = parseFixture("frontmatter-yaml.md");
    expect(yaml.tree.children[0]?.type).toBe("yaml");
    expect(yaml.frontmatter?.format).toBe("yaml");
    const toml = parseFixture("frontmatter-toml.md");
    expect(toml.tree.children[0]?.type).toBe("toml");
    expect(toml.frontmatter?.format).toBe("toml");
  });

  it("docusaurus.md has note, tip and warning with a nested note", () => {
    const result = parseFixture("docusaurus.md");
    expect(directiveNames(result)).toEqual(["note", "tip", "warning", "note"]);
    const warning = findOne(
      result,
      "containerDirective",
      (node) => directiveName(node) === "warning",
    );
    const outer = rangeOf(warning);
    const inside = findAll(result, "containerDirective", (node) => {
      const { start, end } = rangeOf(node);
      return start > outer.start && end < outer.end;
    }).map(directiveName);
    expect(inside).toEqual(["note"]);
    // Only container directives survive; prose colons are plain text.
    const types = typeSet(result);
    expect(types.has("textDirective")).toBe(false);
    expect(types.has("leafDirective")).toBe(false);
  });

  it("hugo.md keeps shortcodes as text with no special nodes", () => {
    const result = parseFixture("hugo.md");
    const types = typeSet(result);
    expect(types.has("containerDirective")).toBe(false);
    const texts = findAll(result, "text").map(textOf);
    expect(texts.some((t) => t?.includes("{{< note >}}"))).toBe(true);
    expect(texts.some((t) => t?.includes("{{% tab name="))).toBe(true);
    expect(texts).toContain("{% include note.html %}");
    expect(texts.some((t) => t?.includes("{{ .Site.Title }}"))).toBe(true);
  });

  it("html.md has block and inline html nodes", () => {
    const result = parseFixture("html.md");
    const values = findAll(result, "html").map(textOf);
    expect(values.length).toBeGreaterThanOrEqual(4);
    expect(values).toContain("<kbd>");
    expect(values).toContain("</kbd>");
    expect(values).toContain("<!-- tulis-ignore -->");
    expect(values.some((v) => v?.startsWith('<div class="callout">'))).toBe(
      true,
    );
  });

  it("mdx.mdx has every mdx node type", () => {
    const result = parseFixture("mdx.mdx");
    const types = typeSet(result);
    for (const type of [
      "yaml",
      "mdxjsEsm",
      "mdxJsxFlowElement",
      "mdxJsxTextElement",
      "mdxFlowExpression",
      "mdxTextExpression",
      "containerDirective",
    ]) {
      expect(types.has(type), type).toBe(true);
    }
    const esm = findAll(result, "mdxjsEsm").map(textOf);
    expect(esm.some((v) => v?.startsWith("import Tabs"))).toBe(true);
    expect(esm).toContain('export const version = "2.0";');
  });
});

describe.each(VARIANTS)("positions in the %s variant", (variant) => {
  it.each(FIXTURES)("%s: every node position is exact", (name) => {
    const result = parseFixture(name, variant);
    for (const node of allNodes(result.tree)) {
      const position = node.position;
      if (position === undefined) {
        throw new Error(`${node.type} has no position`);
      }
      const { start, end } = position;
      expect(start.offset, node.type).toBeDefined();
      expect(end.offset, node.type).toBeDefined();
      const startOffset = start.offset ?? -1;
      const endOffset = end.offset ?? -1;
      expect(startOffset).toBeGreaterThanOrEqual(0);
      expect(endOffset).toBeGreaterThanOrEqual(startOffset);
      expect(endOffset).toBeLessThanOrEqual(result.source.length);
      expect({ line: start.line, column: start.column }, node.type).toEqual(
        pointAt(result.source, startOffset),
      );
      expect({ line: end.line, column: end.column }, node.type).toEqual(
        pointAt(result.source, endOffset),
      );
    }
  });

  // A text node followed by an inline node (a link, inline code) keeps the
  // line ending inside its range, so only other nodes are checked.
  it.each(FIXTURES)("%s: no other node ends on a line ending", (name) => {
    const result = parseFixture(name, variant);
    for (const node of allNodes(result.tree)) {
      if (node.type === "root" || node.type === "text") {
        continue;
      }
      const slice = sliceOf(result, node);
      expect(slice.endsWith("\n"), node.type).toBe(false);
      expect(slice.endsWith("\r"), node.type).toBe(false);
    }
  });
});

describe("the three variants agree", () => {
  it.each(FIXTURES)("%s: same node types and line/column", (name) => {
    const summaries = VARIANTS.map((variant) =>
      allNodes(parseFixture(name, variant).tree).map((node) => ({
        type: node.type,
        start: {
          line: node.position?.start.line,
          column: node.position?.start.column,
        },
        end: {
          line: node.position?.end.line,
          column: node.position?.end.column,
        },
      })),
    );
    expect(summaries[1]).toEqual(summaries[0]);
    expect(summaries[2]).toEqual(summaries[0]);
    expect(summaries[0]?.length).toBeGreaterThan(20);
  });

  it.each(FIXTURES)("%s: hasBom and source", (name) => {
    const lf = readFixture(name);
    const lfResult = parseFixture(name, "lf");
    const crlfResult = parseFixture(name, "crlf");
    const bomResult = parseFixture(name, "bom");
    expect(lfResult.hasBom).toBe(false);
    expect(crlfResult.hasBom).toBe(false);
    expect(bomResult.hasBom).toBe(true);
    expect(bomResult.source).toBe(lf);
    expect(lfResult.source).toBe(lf);
    expect(crlfResult.source).toBe(lf.replaceAll("\n", "\r\n"));
  });

  it("the fixture files really contain a tab and are 20 to 60 lines", () => {
    expect(readFixture("plain.md")).toContain("\t");
    for (const name of FIXTURES) {
      const lines = readFixture(name).trimEnd().split("\n").length;
      expect(lines, name).toBeGreaterThanOrEqual(20);
      expect(lines, name).toBeLessThanOrEqual(60);
    }
  });
});

describe.each(VARIANTS)("exact slices in the %s variant", (variant) => {
  const eol = variant === "crlf" ? "\r\n" : "\n";

  it("plain.md", () => {
    const result = parseFixture("plain.md", variant);
    const h2 = findOne(
      result,
      "heading",
      (n) => n.type === "heading" && n.depth === 2,
    );
    expect(sliceOf(result, h2)).toBe("## Install the agent");

    const wrapped = findOne(result, "paragraph", (n) =>
      sliceOf(result, n).startsWith("The agent is a small program"),
    );
    expect(sliceOf(result, wrapped)).toBe(
      [
        "The agent is a small program that reads your docs",
        "and reports problems before a release. It runs on",
        "Linux, macOS and Windows without extra setup.",
      ].join(eol),
    );

    const fenced = findOne(
      result,
      "code",
      (n) => n.type === "code" && n.lang === "bash",
    );
    const fencedSlice = sliceOf(result, fenced);
    expect(fencedSlice.startsWith("```bash")).toBe(true);
    expect(fencedSlice.endsWith("```")).toBe(true);
    expect(fencedSlice).toBe(
      ["```bash", "pena check docs/", "pena report --format text", "```"].join(
        eol,
      ),
    );

    const tabItem = findOne(result, "listItem", (n) =>
      sliceOf(result, n).includes("\t"),
    );
    expect(sliceOf(result, tabItem)).toBe("-\tStep with a tab after the dash");
    const tabText = findOne(
      result,
      "text",
      (n) => textOf(n)?.startsWith("Step with") === true,
    );
    expect(sliceOf(result, tabText)).toBe("Step with a tab after the dash");
    expect(tabText.position?.start.column).toBe(3);
  });

  it("gfm.md", () => {
    const result = parseFixture("gfm.md", variant);
    const codeCell = findOne(
      result,
      "tableCell",
      (n) => sliceOf(result, n) === "| `check` ",
    );
    expect(codeCell.type).toBe("tableCell");
    const linkCell = findOne(
      result,
      "tableCell",
      (n) =>
        sliceOf(result, n) === "| [Check guide](https://example.com/check) |",
    );
    // The parser's cell range includes the leading pipe and the spaces.
    expect(sliceOf(result, codeCell)).toBe("| `check` ");
    const link = findOne(
      result,
      "link",
      (n) => n.type === "link" && n.url === "https://example.com/check",
    );
    expect(sliceOf(result, link)).toBe(
      "[Check guide](https://example.com/check)",
    );
    expect(linkCell.type).toBe("tableCell");
    const definition = findOne(result, "footnoteDefinition");
    expect(sliceOf(result, definition)).toBe(
      "[^speed]: A folder with 100 files takes about one second.",
    );
    const strike = findOne(result, "delete");
    expect(sliceOf(result, strike)).toBe("~~removed~~");
  });

  it("docusaurus.md", () => {
    const result = parseFixture("docusaurus.md", variant);
    const sentence = "Set the ratio to 3:1 and use key:value pairs.";
    const paragraph = findOne(
      result,
      "paragraph",
      (n) => sliceOf(result, n) === sentence,
    );
    expect("children" in paragraph ? paragraph.children : []).toHaveLength(1);
    const text = findOne(result, "text", (n) => textOf(n) === sentence);
    expect(sliceOf(result, text)).toBe(sentence);

    const warning = findOne(
      result,
      "containerDirective",
      (n) => directiveName(n) === "warning",
    );
    const slice = sliceOf(result, warning);
    expect(slice.startsWith("::::warning")).toBe(true);
    expect(slice.endsWith("::::")).toBe(true);
    expect(slice.includes(":::note")).toBe(true);
  });

  it("frontmatter-yaml.md", () => {
    const result = parseFixture("frontmatter-yaml.md", variant);
    const node = result.tree.children[0];
    if (node === undefined) {
      throw new Error("no first node");
    }
    const slice = sliceOf(result, node);
    expect(slice.startsWith("---" + eol)).toBe(true);
    expect(slice.endsWith(eol + "---")).toBe(true);
    expect(result.frontmatter?.value).toBe(
      [
        "title: Getting started",
        "description: Learn how to set up the tool in five minutes.",
        "weight: 10",
      ].join(eol),
    );
    expect(result.frontmatter?.position.start.offset).toBe(0);
  });

  it("frontmatter-toml.md", () => {
    const result = parseFixture("frontmatter-toml.md", variant);
    const node = result.tree.children[0];
    if (node === undefined) {
      throw new Error("no first node");
    }
    expect(sliceOf(result, node)).toBe(
      ["+++", 'title = "Installation"', "weight = 20", "+++"].join(eol),
    );
  });

  it("mdx.mdx", () => {
    const result = parseFixture("mdx.mdx", variant);
    const tabs = findOne(
      result,
      "mdxJsxFlowElement",
      (n) => n.type === "mdxJsxFlowElement" && n.name === "Tabs",
    );
    const tabsSlice = sliceOf(result, tabs);
    expect(tabsSlice.startsWith("<Tabs>")).toBe(true);
    expect(tabsSlice.endsWith("</Tabs>")).toBe(true);

    const kbd = findOne(result, "mdxJsxTextElement");
    expect(sliceOf(result, kbd)).toBe("<Kbd>Enter</Kbd>");

    const expression = findOne(result, "mdxTextExpression");
    expect(sliceOf(result, expression)).toBe("{props.version}");
    const comment = findOne(result, "mdxFlowExpression");
    expect(sliceOf(result, comment)).toBe("{/* note */}");
    const note = findOne(result, "containerDirective");
    expect(sliceOf(result, note).startsWith(":::note")).toBe(true);
  });

  it("html.md", () => {
    const result = parseFixture("html.md", variant);
    const comment = findOne(
      result,
      "html",
      (n) => textOf(n) === "<!-- tulis-ignore -->",
    );
    expect(textOf(comment)).toBe("<!-- tulis-ignore -->");
    expect(sliceOf(result, comment)).toBe("<!-- tulis-ignore -->");
    const inline = findOne(result, "html", (n) => textOf(n) === "<kbd>");
    expect(sliceOf(result, inline)).toBe("<kbd>");
  });
});

describe("mdx.mdx read as Markdown", () => {
  it("still parses and has no mdx node types", () => {
    const text = readFixture("mdx.mdx");
    const result = parseMarkdown(text, "markdown");
    if (result.kind !== "parsed") {
      throw new Error(`mdx.mdx did not parse as Markdown: ${result.message}`);
    }
    expect(result.syntax).toBe("markdown");
    expect(result.source).toBe(text);
    const mdxTypes = [...typeSet(result)].filter((t) => t.startsWith("mdx"));
    expect(mdxTypes).toEqual([]);
    expect(result.tree.children[0]?.type).toBe("yaml");
  });
});
