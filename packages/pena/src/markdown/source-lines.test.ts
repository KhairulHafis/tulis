import type { Root, RootContent } from "mdast";
import { describe, expect, it } from "vitest";
import { parseMarkdown } from "./parse-markdown.js";
import { SourceLines } from "./source-lines.js";

describe("SourceLines", () => {
  const text = "one\ntwo\nthree";

  it("finds the first, a middle and the last line", () => {
    const lines = new SourceLines(text);
    expect(lines.at(0)).toEqual({ line: 1, column: 1 });
    expect(lines.at(5)).toEqual({ line: 2, column: 2 });
    expect(lines.at(8)).toEqual({ line: 3, column: 1 });
    expect(lines.at(12)).toEqual({ line: 3, column: 5 });
  });

  it("handles a final newline", () => {
    const lines = new SourceLines("one\n");
    expect(lines.at(3)).toEqual({ line: 1, column: 4 });
    expect(lines.at(4)).toEqual({ line: 2, column: 1 });
  });

  it("puts the offset of a newline on its own line", () => {
    expect(new SourceLines(text).at(3)).toEqual({ line: 1, column: 4 });
  });

  it("keeps the carriage return on the line before", () => {
    const lines = new SourceLines("one\r\ntwo");
    expect(lines.at(3)).toEqual({ line: 1, column: 4 });
    expect(lines.at(4)).toEqual({ line: 1, column: 5 });
    expect(lines.at(5)).toEqual({ line: 2, column: 1 });
  });

  it("handles an empty source", () => {
    expect(new SourceLines("").at(0)).toEqual({ line: 1, column: 1 });
  });

  it("accepts an offset equal to the length", () => {
    expect(new SourceLines("ab").at(2)).toEqual({ line: 1, column: 3 });
  });

  it("rejects offsets that are out of range or not integers", () => {
    const lines = new SourceLines(text);
    expect(() => lines.at(-1)).toThrow(RangeError);
    expect(() => lines.at(text.length + 1)).toThrow(RangeError);
    expect(() => lines.at(1.5)).toThrow(RangeError);
    expect(() => lines.at(Number.NaN)).toThrow(RangeError);
  });

  it("agrees with the mdast start of every node", () => {
    const source =
      "# Title\n\nSome *text* here\nover two lines.\n\n- item `code`\n- [link](https://example.com)\n\n> quote\n";
    const result = parseMarkdown(source, "markdown");
    if (result.kind !== "parsed") {
      throw new Error("did not parse");
    }
    const lines = new SourceLines(result.source);
    let checked = 0;
    const stack: (Root | RootContent)[] = [result.tree];
    for (let node = stack.pop(); node !== undefined; node = stack.pop()) {
      const start = node.position?.start;
      if (start?.offset !== undefined) {
        expect(lines.at(start.offset)).toEqual({
          line: start.line,
          column: start.column,
        });
        checked++;
      }
      if ("children" in node) {
        stack.push(...node.children);
      }
    }
    expect(checked).toBeGreaterThan(10);
  });
});
