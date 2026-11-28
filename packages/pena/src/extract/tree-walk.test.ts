import { describe, expect, it } from "vitest";
import type { MarkdownSyntax } from "../markdown/parse-markdown.js";
import { prepareDoc, type PreparedDoc } from "../prepare/prepare-doc.js";
import { isIgnored, nodeRange, walkTree } from "./tree-walk.js";

function prepared(
  text: string,
  syntax: MarkdownSyntax = "markdown",
): PreparedDoc {
  const result = prepareDoc(text, syntax);
  if (result.kind !== "prepared") {
    throw new Error("expected a prepared doc, got " + result.reason);
  }
  return result;
}

function types(doc: PreparedDoc): string[] {
  const seen: string[] = [];
  walkTree(doc, (node) => {
    seen.push(node.type);
  });
  return seen;
}

describe("walkTree", () => {
  it("visits in document order, with parents", () => {
    const doc = prepared("> - one\n> - two\n\nAfter.\n");
    const parents: (string | undefined)[] = [];
    walkTree(doc, (node, parent) => {
      parents.push(node.type + "<" + (parent?.type ?? "none"));
    });
    expect(parents).toEqual([
      "root<none",
      "blockquote<root",
      "list<blockquote",
      "listItem<list",
      "paragraph<listItem",
      "text<paragraph",
      "listItem<list",
      "paragraph<listItem",
      "text<paragraph",
      "paragraph<root",
      "text<paragraph",
    ]);
  });

  it("does not visit JSX subtrees in mdx", () => {
    const doc = prepared(
      "Before.\n\n<Tabs>\n\n```bash\nls\n```\n\n</Tabs>\n\n```js\nx\n```\n",
      "mdx",
    );
    expect(types(doc)).toEqual(["root", "paragraph", "text", "code"]);
  });

  it("skip-children stops descent but still visits siblings", () => {
    const doc = prepared("> Quote.\n\nAfter.\n");
    const seen: string[] = [];
    walkTree(doc, (node) => {
      seen.push(node.type);
      if (node.type === "blockquote") {
        return "skip-children";
      }
      return undefined;
    });
    expect(seen).toEqual(["root", "blockquote", "paragraph", "text"]);
  });

  it("walks a 90-deep blockquote without recursion", () => {
    const doc = prepared("> ".repeat(90) + "Deep.\n");
    const seen = types(doc);
    expect(seen.filter((t) => t === "blockquote")).toHaveLength(90);
    expect(seen.at(-1)).toBe("text");
  });
});

describe("isIgnored", () => {
  const text = "<!-- tulis-ignore -->\n```bash\nls\n```\n\nText.\n";

  it("ignores the code block after the comment, not the next paragraph", () => {
    const doc = prepared(text);
    const ranges: Record<string, boolean> = {};
    walkTree(doc, (node) => {
      const range = nodeRange(node);
      if (
        range !== undefined &&
        (node.type === "code" || node.type === "paragraph")
      ) {
        ranges[node.type] = isIgnored(doc, range);
      }
    });
    expect(ranges).toEqual({ code: true, paragraph: false });
  });

  it("does not ignore a range touching the end of an ignore range", () => {
    const doc = prepared(text);
    const end = doc.ignoredRanges[0]?.end ?? 0;
    expect(isIgnored(doc, { start: end, end: end + 5 })).toBe(false);
    expect(isIgnored(doc, { start: end - 1, end: end + 5 })).toBe(true);
  });

  it("ignores nothing when there are no ranges", () => {
    const doc = prepared("# Title\n\nText.\n");
    expect(isIgnored(doc, { start: 0, end: 15 })).toBe(false);
  });
});

describe("nodeRange", () => {
  it("gives the start and end offsets of a code node", () => {
    const doc = prepared(text0());
    let found: { start: number; end: number } | undefined;
    walkTree(doc, (node) => {
      if (node.type === "code") {
        found = nodeRange(node);
      }
    });
    expect(found).toEqual({ start: 22, end: 22 + "```bash\nls\n```".length });
  });

  it("is undefined for a node without a position", () => {
    expect(nodeRange({ type: "text", value: "x" })).toBeUndefined();
  });
});

function text0(): string {
  return "<!-- tulis-ignore -->\n```bash\nls\n```\n\nText.\n";
}
