import remarkDirective from "remark-directive";
import remarkFrontmatter from "remark-frontmatter";
import remarkGfm from "remark-gfm";
import remarkMdx from "remark-mdx";
import remarkParse from "remark-parse";
import { unified } from "unified";
import { describe, expect, it } from "vitest";
import {
  MAX_TREE_DEPTH,
  parseMarkdown,
  syntaxForPath,
  type MarkdownSyntax,
} from "./parse-markdown.js";

const markdownControl = unified()
  .use(remarkParse)
  .use(remarkFrontmatter, ["yaml", "toml"])
  .use(remarkGfm)
  .use(remarkDirective)
  .freeze();

const mdxControl = unified()
  .use(remarkParse)
  .use(remarkFrontmatter, ["yaml", "toml"])
  .use(remarkGfm)
  .use(remarkDirective)
  .use(remarkMdx)
  .freeze();

/** The plain processor: the same plugins as Pena, none of Pena's guards. */
function plainParse(text: string, syntax: MarkdownSyntax = "markdown") {
  return (syntax === "mdx" ? mdxControl : markdownControl).parse(text);
}

interface TreeNode {
  readonly type: string;
  readonly children?: readonly TreeNode[] | undefined;
  readonly position?:
    | {
        readonly start: { readonly offset?: number | undefined };
        readonly end: { readonly offset?: number | undefined };
      }
    | undefined;
}

/** Depth of the deepest node; the root is 0. Explicit stack, no recursion. */
function treeDepth(root: TreeNode): number {
  const stack: { node: TreeNode; depth: number }[] = [{ node: root, depth: 0 }];
  let deepest = 0;
  for (let entry = stack.pop(); entry !== undefined; entry = stack.pop()) {
    deepest = Math.max(deepest, entry.depth);
    for (const child of entry.node.children ?? []) {
      stack.push({ node: child, depth: entry.depth + 1 });
    }
  }
  return deepest;
}

function allNodes(root: TreeNode): TreeNode[] {
  const nodes: TreeNode[] = [];
  const stack: TreeNode[] = [root];
  for (let node = stack.pop(); node !== undefined; node = stack.pop()) {
    nodes.push(node);
    stack.push(...(node.children ?? []));
  }
  return nodes;
}

function parsedResult(text: string, syntax: MarkdownSyntax = "markdown") {
  const result = parseMarkdown(text, syntax);
  if (result.kind !== "parsed") {
    throw new Error(`expected a parsed result, got ${result.problem}`);
  }
  return result;
}

function sliceOf(
  node: TreeNode | undefined,
  source: string,
): string | undefined {
  const start = node?.position?.start.offset;
  const end = node?.position?.end.offset;
  if (start === undefined || end === undefined) {
    return undefined;
  }
  return source.slice(start, end);
}

function nestedLists(levels: number): string {
  const lines: string[] = [];
  for (let i = 0; i < levels; i++) {
    lines.push(`${" ".repeat(2 * i)}- x`);
  }
  return lines.join("\n");
}

/** `levels` container directives inside each other, outer ones use more colons. */
function nestedDirectives(levels: number): string {
  const opens: string[] = [];
  const closes: string[] = [];
  for (let i = 0; i < levels; i++) {
    opens.push(`${":".repeat(3 + levels - i)}a`);
    closes.push(":".repeat(3 + i));
  }
  return `${opens.join("\n")}\nx\n${closes.join("\n")}`;
}

interface NestingKind {
  readonly name: string;
  readonly syntax: MarkdownSyntax;
  /** The largest n whose tree has depth exactly MAX_TREE_DEPTH. */
  readonly largestOk: number;
  readonly build: (n: number) => string;
}

// Depth shapes: n quotes, n directives or n JSX elements add one level each,
// plus the paragraph and its text (n + 2). A list level is a list and a list
// item (2n + 2). Emphasis pairs of `*` fold into strong, so depth grows by
// about one level per two stars (n = 196 gives depth 100).
const NESTING_KINDS: readonly NestingKind[] = [
  {
    name: "block quotes",
    syntax: "markdown",
    largestOk: 98,
    build: (n) => `${">".repeat(n)} x`,
  },
  {
    name: "bullet lists",
    syntax: "markdown",
    largestOk: 49,
    build: nestedLists,
  },
  {
    name: "emphasis",
    syntax: "markdown",
    largestOk: 196,
    build: (n) => `${"*".repeat(n)}a${"*".repeat(n)}`,
  },
  {
    name: "container directives",
    syntax: "markdown",
    largestOk: 98,
    build: nestedDirectives,
  },
  {
    name: "JSX elements in mdx",
    syntax: "mdx",
    largestOk: 98,
    build: (n) => `${"<a>".repeat(n)}x${"</a>".repeat(n)}`,
  },
];

describe("depth limit boundary", () => {
  it("is 100", () => {
    expect(MAX_TREE_DEPTH).toBe(100);
  });

  describe.each(NESTING_KINDS)("$name", (kind) => {
    it("parses the deepest allowed input, which has depth exactly 100", () => {
      const result = parsedResult(kind.build(kind.largestOk), kind.syntax);
      expect(treeDepth(result.tree)).toBe(MAX_TREE_DEPTH);
      // Control: plain remark agrees about the depth.
      expect(
        treeDepth(plainParse(kind.build(kind.largestOk), kind.syntax)),
      ).toBe(MAX_TREE_DEPTH);
    });

    it("gives too-deep for one more level", () => {
      const text = kind.build(kind.largestOk + 1);
      // Control: plain remark parses it, into a tree deeper than the limit.
      expect(treeDepth(plainParse(text, kind.syntax))).toBeGreaterThan(
        MAX_TREE_DEPTH,
      );
      const result = parseMarkdown(text, kind.syntax);
      expect(result.kind).toBe("failed");
      if (result.kind === "failed") {
        expect(result.problem).toBe("too-deep");
        expect(result.syntax).toBe(kind.syntax);
      }
    });
  });
});

describe("stack overflow", () => {
  const quotes = `${">".repeat(10000)} x`;
  const jsx = `${"<a>".repeat(20000)}x${"</a>".repeat(20000)}`;

  it("control: plain remark throws a RangeError for 10,000 quotes", () => {
    expect(() => plainParse(quotes)).toThrow(RangeError);
  });

  it("returns too-deep for 10,000 quotes in markdown", () => {
    const result = parseMarkdown(quotes, "markdown");
    expect(result.kind).toBe("failed");
    if (result.kind === "failed") {
      expect(result.problem).toBe("too-deep");
    }
  });

  it("returns a failure for 10,000 quotes in mdx", () => {
    const result = parseMarkdown(quotes, "mdx");
    expect(result.kind).toBe("failed");
    if (result.kind === "failed") {
      expect(["too-deep", "invalid-mdx"]).toContain(result.problem);
    }
  });

  it("returns a failure for 20,000 nested JSX elements in mdx", () => {
    const result = parseMarkdown(jsx, "mdx");
    expect(result.kind).toBe("failed");
    if (result.kind === "failed") {
      expect(["too-deep", "invalid-mdx"]).toContain(result.problem);
    }
  });
});

describe("deep but non-crashing input", () => {
  const stars = `${"*".repeat(1000)}a${"*".repeat(1000)}`;

  it("control: plain remark parses 1,000 stars into a tree deeper than 100", () => {
    expect(treeDepth(plainParse(stars))).toBeGreaterThan(MAX_TREE_DEPTH);
  });

  it("gives too-deep", () => {
    const result = parseMarkdown(stars, "markdown");
    expect(result.kind).toBe("failed");
    if (result.kind === "failed") {
      expect(result.problem).toBe("too-deep");
    }
  });
});

describe("hostile input never throws", () => {
  const hostile: readonly (readonly [string, string])[] = [
    ["underscores", "_".repeat(65536)],
    ["open parentheses", "(".repeat(65536)],
    ["open brackets", "[".repeat(16384)],
    ["unclosed code spans", "`a ".repeat(8000)],
    ["unclosed tags", "<a ".repeat(8000)],
    ["directive attributes", `:a{${"b=c ".repeat(4000)}`],
    ["character references", "&#".repeat(8000)],
    ["NUL characters", "\u0000".repeat(1000)],
    ["lone surrogates", "\ud800".repeat(2000)],
    ["carriage returns", "\r".repeat(5000)],
    ["wide table", `${"|a".repeat(4000)}\n${"|-".repeat(4000)}`],
    ["open braces", "{".repeat(10000)],
    ["unclosed yaml frontmatter", `---\n${"a: b\n".repeat(5000)}`],
    ["toml fence lines", `+++\n${"+++\n".repeat(2000)}`],
  ];

  describe.each(hostile)("%s", (_name, text) => {
    it("is at most 64 KB", () => {
      expect(text.length).toBeLessThanOrEqual(65536);
    });

    it.each<MarkdownSyntax>(["markdown", "mdx"])(
      "returns a result in %s mode",
      (syntax) => {
        const result = parseMarkdown(text, syntax);
        expect(["parsed", "failed"]).toContain(result.kind);
      },
    );
  });
});

describe("positions stay inside the source", () => {
  function expectOffsetsInside(root: TreeNode, source: string): void {
    for (const node of allNodes(root)) {
      const start = node.position?.start.offset;
      const end = node.position?.end.offset;
      expect(start).toBeDefined();
      expect(end).toBeDefined();
      if (start !== undefined && end !== undefined) {
        expect(start).toBeGreaterThanOrEqual(0);
        expect(start).toBeLessThanOrEqual(end);
        expect(end).toBeLessThanOrEqual(source.length);
      }
    }
  }

  it("handles NUL characters", () => {
    const text = "\u0000a\u0000";
    const result = parsedResult(text);
    expect(result.source).toBe(text);
    expectOffsetsInside(result.tree, result.source);
    expect(sliceOf(result.tree.children[0], result.source)).toBe(text);
  });

  it("handles lone carriage returns as line endings", () => {
    const text = "a\rb\r\rc";
    const result = parsedResult(text);
    expectOffsetsInside(result.tree, result.source);
    expect(result.tree.children.map((n) => n.type)).toEqual([
      "paragraph",
      "paragraph",
    ]);
    expect(sliceOf(result.tree.children[0], result.source)).toBe("a\rb");
    expect(sliceOf(result.tree.children[1], result.source)).toBe("c");
  });

  it("handles a lone surrogate inside a paragraph", () => {
    const text = "x\ud800y";
    const result = parsedResult(text);
    expectOffsetsInside(result.tree, result.source);
    expect(sliceOf(result.tree.children[0], result.source)).toBe(text);
  });
});

describe("prose directives at volume", () => {
  const prose = "see :a and ".repeat(2000);

  it("control: plain remark turns the prose into textDirective nodes", () => {
    const types = allNodes(plainParse(prose)).map((n) => n.type);
    expect(types).toContain("textDirective");
  });

  it("gives one paragraph with one text node holding the input (minus the trailing space)", () => {
    const result = parsedResult(prose);
    expect(result.tree.children).toHaveLength(1);
    const paragraph = result.tree.children[0];
    expect(paragraph?.type).toBe("paragraph");
    const texts =
      paragraph && "children" in paragraph ? paragraph.children : [];
    expect(texts).toHaveLength(1);
    const text = texts[0];
    expect(text?.type).toBe("text");
    expect(text && "value" in text ? text.value : undefined).toBe(
      prose.trimEnd(),
    );
    expect(allNodes(result.tree).map((n) => n.type)).not.toContain(
      "textDirective",
    );
  });
});

describe("safe error messages", () => {
  const unsafe: readonly (readonly [string, string])[] = [
    ["ESC", "\u001b"],
    ["a C1 control", "\u009b"],
    ["a right-to-left override", "\u202e"],
    ["a bidi isolate", "\u2066"],
  ];

  function plainReason(text: string): string {
    try {
      plainParse(text, "mdx");
    } catch (error) {
      if (error instanceof Error && "reason" in error) {
        return String(error.reason);
      }
    }
    throw new Error("expected plain remark to reject the input");
  }

  it.each(unsafe)("replaces %s in an echoed tag name", (_name, char) => {
    const text = `<a${char}>`;
    // Control: plain remark echoes the character in its error reason.
    expect(plainReason(text)).toContain(char);

    const result = parseMarkdown(text, "mdx");
    expect(result.kind).toBe("failed");
    if (result.kind === "failed") {
      expect(result.problem).toBe("invalid-mdx");
      expect(result.message).not.toContain(char);
      expect(result.message).toContain("?");
    }
  });

  it("replaces all of them together, in tag names and attributes", () => {
    const all = unsafe.map(([, char]) => char);
    for (const text of all.map((c) => `<a b=${c}>`)) {
      const result = parseMarkdown(text, "mdx");
      expect(result.kind).toBe("failed");
      if (result.kind === "failed") {
        for (const char of all) {
          expect(result.message).not.toContain(char);
        }
      }
    }
  });

  it("cuts a 500-character tag name to at most 203 characters", () => {
    const text = `<${"a".repeat(500)}>x</b>`;
    // Control: plain remark's reason is much longer.
    expect(plainReason(text).length).toBeGreaterThan(500);

    const result = parseMarkdown(text, "mdx");
    expect(result.kind).toBe("failed");
    if (result.kind === "failed") {
      expect(result.message.length).toBeLessThanOrEqual(203);
      expect(result.message.endsWith("...")).toBe(true);
    }
  });
});

describe("syntaxForPath with names that look like flags", () => {
  it("only checks the extension", () => {
    expect(syntaxForPath("--output=x.md")).toBe("markdown");
    expect(syntaxForPath("-rf.mdx")).toBe("mdx");
    expect(syntaxForPath("docs/--output=x.md")).toBe("markdown");
    expect(syntaxForPath("-rf")).toBeUndefined();
  });
});
