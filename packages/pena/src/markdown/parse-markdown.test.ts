import { describe, expect, it } from "vitest";
import {
  parseMarkdown,
  syntaxForPath,
  type MarkdownParseFailure,
  type MarkdownSyntax,
  type ParsedMarkdown,
} from "./parse-markdown.js";

const BOM = "\uFEFF";

function parsed(text: string, syntax: MarkdownSyntax = "markdown") {
  const result = parseMarkdown(text, syntax);
  if (result.kind !== "parsed") {
    throw new Error(`expected a parsed result, got ${result.problem}`);
  }
  return result;
}

function failed(
  text: string,
  syntax: MarkdownSyntax = "markdown",
): MarkdownParseFailure {
  const result = parseMarkdown(text, syntax);
  if (result.kind !== "failed") {
    throw new Error("expected a failure");
  }
  return result;
}

function types(result: ParsedMarkdown): string[] {
  return result.tree.children.map((node) => node.type);
}

function hasControlCharacter(text: string): boolean {
  for (let i = 0; i < text.length; i++) {
    if (text.charCodeAt(i) < 0x20) {
      return true;
    }
  }
  return false;
}

describe("syntaxForPath", () => {
  it("recognises .md and .mdx in any case", () => {
    expect(syntaxForPath("a.md")).toBe("markdown");
    expect(syntaxForPath("a.MD")).toBe("markdown");
    expect(syntaxForPath("a.mdx")).toBe("mdx");
    expect(syntaxForPath("a.Mdx")).toBe("mdx");
  });

  it("accepts Windows separators", () => {
    expect(syntaxForPath("docs\\a.mdx")).toBe("mdx");
  });

  it("gives undefined for other extensions", () => {
    expect(syntaxForPath("a.markdown")).toBeUndefined();
    expect(syntaxForPath("a.txt")).toBeUndefined();
    expect(syntaxForPath("README")).toBeUndefined();
  });

  it("uses the last extension", () => {
    expect(syntaxForPath("a.mdx.md")).toBe("markdown");
  });
});

describe("parseMarkdown: Markdown", () => {
  it("gives node types and exact positions", () => {
    const result = parsed(
      "# Title\n\nPara\n\n- one\n- two\n\n```js\ncode\n```\n",
    );
    expect(types(result)).toEqual(["heading", "paragraph", "list", "code"]);
    const [heading, paragraph, list, code] = result.tree.children;
    expect(heading?.position).toEqual({
      start: { line: 1, column: 1, offset: 0 },
      end: { line: 1, column: 8, offset: 7 },
    });
    expect(paragraph?.position).toEqual({
      start: { line: 3, column: 1, offset: 9 },
      end: { line: 3, column: 5, offset: 13 },
    });
    expect(list?.position?.start.line).toBe(5);
    expect(list?.position?.end.line).toBe(6);
    expect(code?.position?.start).toEqual({ line: 8, column: 1, offset: 28 });
    expect(code?.position?.end.line).toBe(10);
    expect(result.hasBom).toBe(false);
    expect(result.syntax).toBe("markdown");
  });

  it("reads GFM tables, task lists and footnotes", () => {
    const result = parsed(
      "| a | b |\n| - | - |\n| 1 | 2 |\n\n- [x] done\n- [ ] todo\n\nNote[^1]\n\n[^1]: Text\n",
    );
    expect(types(result)).toEqual([
      "table",
      "list",
      "paragraph",
      "footnoteDefinition",
    ]);
    const list = result.tree.children[1];
    if (list?.type !== "list") {
      throw new Error("expected a list");
    }
    expect(list.children.map((item) => item.checked)).toEqual([true, false]);
    const paragraph = result.tree.children[2];
    if (paragraph?.type !== "paragraph") {
      throw new Error("expected a paragraph");
    }
    expect(paragraph.children.map((node) => node.type)).toContain(
      "footnoteReference",
    );
  });

  it("keeps an HTML comment as an html node", () => {
    expect(types(parsed("<!-- note -->\n"))).toEqual(["html"]);
  });
});

describe("parseMarkdown: frontmatter", () => {
  it("finds YAML frontmatter", () => {
    const result = parsed("---\ntitle: Hi\n---\n\n# Body\n");
    expect(result.frontmatter?.format).toBe("yaml");
    expect(result.frontmatter?.value).toBe("title: Hi");
    expect(result.frontmatter?.position.start.line).toBe(1);
    expect(result.frontmatter?.position.end.line).toBe(3);
    expect(result.frontmatter?.position.end.offset).toBe(17);
  });

  it("finds TOML frontmatter", () => {
    const result = parsed('+++\ntitle = "Hi"\n+++\n\n# Body\n');
    expect(result.frontmatter?.format).toBe("toml");
    expect(result.frontmatter?.value).toBe('title = "Hi"');
    expect(result.frontmatter?.position.start.offset).toBe(0);
  });

  it("ignores a block that is not at the start", () => {
    const result = parsed("# Title\n\n---\ntitle: Hi\n---\n");
    expect(result.frontmatter).toBeUndefined();
  });

  it("gives undefined when there is none", () => {
    expect(parsed("# Title\n").frontmatter).toBeUndefined();
  });
});

describe("parseMarkdown: directives", () => {
  it("keeps container directives", () => {
    const result = parsed(":::note\nBody text\n:::\n");
    const node = result.tree.children[0];
    if (node?.type !== "containerDirective") {
      throw new Error("expected a containerDirective");
    }
    expect(node.name).toBe("note");
    expect(node.children[0]?.type).toBe("paragraph");
  });

  it("turns prose that looks like text directives back into text", () => {
    const sentence = "Use key:value and 10:30 and a:b.";
    const result = parsed(sentence);
    expect(result.tree.children).toHaveLength(1);
    const paragraph = result.tree.children[0];
    if (paragraph?.type !== "paragraph") {
      throw new Error("expected a paragraph");
    }
    expect(paragraph.children).toHaveLength(1);
    const text = paragraph.children[0];
    expect(text?.type).toBe("text");
    expect(text?.type === "text" ? text.value : "").toBe(sentence);
    expect(text?.position?.start.offset).toBe(0);
    expect(text?.position?.end.offset).toBe(sentence.length);
  });

  it("turns a leaf directive into a paragraph with its text", () => {
    const result = parsed("::leaf\n");
    const paragraph = result.tree.children[0];
    if (paragraph?.type !== "paragraph") {
      throw new Error("expected a paragraph");
    }
    expect(paragraph.children).toHaveLength(1);
    const text = paragraph.children[0];
    expect(text?.type === "text" ? text.value : "").toBe("::leaf");
    expect(paragraph.position?.start.offset).toBe(0);
    expect(paragraph.position?.end.offset).toBe(6);
  });

  it("keeps the exact source text of a text directive with a label", () => {
    const sentence = "Text :span[x]{a=1} end";
    const paragraph = parsed(sentence).tree.children[0];
    if (paragraph?.type !== "paragraph") {
      throw new Error("expected a paragraph");
    }
    expect(paragraph.children).toHaveLength(1);
    const text = paragraph.children[0];
    expect(text?.type === "text" ? text.value : "").toBe(sentence);
  });

  it("keeps every character of a URL with a port", () => {
    const sentence = "Visit https://example.com:8080/path now";
    const paragraph = parsed(sentence).tree.children[0];
    if (paragraph?.type !== "paragraph") {
      throw new Error("expected a paragraph");
    }
    const text = paragraph.children
      .map((node) =>
        node.type === "text"
          ? node.value
          : node.type === "link"
            ? node.children
                .map((c) => (c.type === "text" ? c.value : ""))
                .join("")
            : "",
      )
      .join("");
    expect(text).toBe(sentence);
  });
});

describe("parseMarkdown: MDX", () => {
  const mdx = 'import A from "a"\n\n<Tabs>\n  <Tab>x</Tab>\n</Tabs>\n\n{1+1}\n';

  it("reads ESM, JSX and expressions in mdx mode", () => {
    const result = parsed(mdx, "mdx");
    expect(types(result)).toEqual([
      "mdxjsEsm",
      "mdxJsxFlowElement",
      "mdxFlowExpression",
    ]);
    expect(result.syntax).toBe("mdx");
  });

  it("does not read them in markdown mode", () => {
    const result = parsed(mdx, "markdown");
    for (const type of types(result)) {
      expect(type.startsWith("mdx")).toBe(false);
    }
  });

  it("fails on invalid MDX with a line and column", () => {
    const result = failed("A < B and {oops", "mdx");
    expect(result.problem).toBe("invalid-mdx");
    expect(result.syntax).toBe("mdx");
    expect(result.line).toBe(1);
    expect(typeof result.column).toBe("number");
    expect(result.message.length).toBeGreaterThan(0);
  });

  it("fails on an unclosed tag inside a paragraph with a line", () => {
    const result = failed("a <div> b\n", "mdx");
    expect(result.problem).toBe("invalid-mdx");
    expect(result.line).toBe(1);
  });

  it("fails on an unclosed block tag, with the line from the message", () => {
    const result = failed("Intro\n\n<div>\n\ntext\n", "mdx");
    expect(result.problem).toBe("invalid-mdx");
    expect(result.message).toContain("<div>");
    expect(result.line).toBe(3);
    expect(result.column).toBe(1);
  });

  it("rejects an HTML comment in mdx", () => {
    expect(failed("<!-- note -->\n", "mdx").problem).toBe("invalid-mdx");
  });

  it("gives a message without control characters", () => {
    const withEscape = failed("{\u001b[31m", "mdx");
    expect(withEscape.problem).toBe("invalid-mdx");
    expect(hasControlCharacter(withEscape.message)).toBe(false);
    const tag = failed("<a\u001bb>\n\ntext", "mdx");
    expect(hasControlCharacter(tag.message)).toBe(false);
  });

  it("keeps the message to 200 characters plus the ellipsis", () => {
    const result = failed(`<${"x".repeat(500)}>\n\ntext`, "mdx");
    expect(result.message.length).toBeLessThanOrEqual(203);
  });
});

describe("parseMarkdown: byte-order mark and line endings", () => {
  it("strips a BOM and keeps offsets into the stripped source", () => {
    const result = parsed(`${BOM}# Hi`);
    expect(result.hasBom).toBe(true);
    expect(result.source).toBe("# Hi");
    const heading = result.tree.children[0];
    expect(heading?.position?.start.offset).toBe(0);
    expect(heading?.position?.end.offset).toBe(4);
    expect(
      result.source.slice(
        heading?.position?.start.offset,
        heading?.position?.end.offset,
      ),
    ).toBe("# Hi");
  });

  it("leaves text without a BOM alone", () => {
    const result = parsed("# Hi");
    expect(result.hasBom).toBe(false);
    expect(result.source).toBe("# Hi");
  });

  it("strips only one BOM", () => {
    const result = parsed(`${BOM}${BOM}# Hi`);
    expect(result.source).toBe(`${BOM}# Hi`);
  });

  it("keeps CRLF and counts it as two characters", () => {
    const result = parsed("# Hi\r\n\r\nPara one\r\nline two\r\n");
    const paragraph = result.tree.children[1];
    expect(paragraph?.position?.start.line).toBe(3);
    expect(paragraph?.position?.end.line).toBe(4);
    expect(
      result.source.slice(
        paragraph?.position?.start.offset,
        paragraph?.position?.end.offset,
      ),
    ).toBe("Para one\r\nline two");
  });
});

describe("parseMarkdown: depth", () => {
  it("fails when block quotes nest beyond the limit", () => {
    const result = failed(`${">".repeat(101)} x`);
    expect(result.problem).toBe("too-deep");
    expect(result.message).not.toContain("x");
  });

  it("accepts moderate nesting", () => {
    expect(parsed(`${">".repeat(50)} x`).kind).toBe("parsed");
  });

  it("reports a parser stack overflow as too-deep", () => {
    expect(failed(`${">".repeat(10000)} x`).problem).toBe("too-deep");
  });

  it("reports a stack overflow as too-deep in mdx mode too", () => {
    expect(failed(`${">".repeat(10000)} x`, "mdx").problem).toBe("too-deep");
  });

  it("fails on deeply nested emphasis", () => {
    const text = `${"*".repeat(1000)}a${"*".repeat(1000)}`;
    expect(failed(text).problem).toBe("too-deep");
  });
});
