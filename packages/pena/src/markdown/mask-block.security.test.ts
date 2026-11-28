import type { Paragraph } from "mdast";
import { describe, expect, it } from "vitest";
import { expectLinearTime, repeatToSize } from "@tulis/testkit";
import { maskBlock } from "./mask-block.js";
import { parseMarkdown, type ParsedMarkdown } from "./parse-markdown.js";

interface Prepared {
  readonly block: Paragraph;
  readonly parsed: ParsedMarkdown;
}

/** Parses outside the timed step: only maskBlock is measured. */
function prepare(text: string): Prepared {
  const parsed = parseMarkdown(text, "markdown");
  if (parsed.kind !== "parsed") {
    throw new Error("did not parse");
  }
  const block = parsed.tree.children[0];
  if (block?.type !== "paragraph") {
    throw new Error("not a paragraph");
  }
  return { block, parsed };
}

// Parsing a big paragraph costs far more than masking it (bold spans take
// about 25 us per byte), so the timer covers maskBlock only and the sizes
// differ by case: sizes that keep each test well under a second, parse included.

/** Probe, small and large sizes in bytes. */
type Sizes = readonly [number, number, number];

const CHEAP: Sizes = [8 * 1024, 32 * 1024, 128 * 1024];
const COSTLY: Sizes = [2 * 1024, 8 * 1024, 32 * 1024];

const cases: [string, string, Sizes][] = [
  ["unclosed <kbd> openers", "<kbd>a ", CHEAP],
  ["matched <span> pairs", "<span>a</span> ", CHEAP],
  ["**a** labels", "**a** ", COSTLY],
  ["template tags mixed with inline code", "{{ x }} `c` {{< y >}} ", COSTLY],
  ["entities and escapes", "&amp; \\* &#35; \\_ &copy; ", CHEAP],
];

describe("maskBlock on hostile input", () => {
  for (const [name, unit, sizes] of cases) {
    it("stays linear for " + name, () => {
      // Probe first with a tight limit so a quadratic regression fails there
      // in well under a second instead of grinding through the large input.
      expectLinearTime({
        prepare: (size) => {
          const prepared = prepare(repeatToSize(unit, size));
          return () => maskBlock(prepared.block, prepared.parsed);
        },
        probe: { size: sizes[0], limitMs: 50 },
        sizes: [sizes[1], sizes[2]],
        smallLimitMs: 100,
        largeLimitMs: 200,
        // 4x the input; generous slack over linear plus a floor for noise.
        slack: 4,
        floorMs: 50,
      });
    });
  }
});

describe("maskBlock heading IDs on hostile headings", () => {
  const hostile: [string, string, string][] = [
    ["spaces then x", "## ", " "],
    ["open groups", "## ", "{#a "],
    ["closed groups", "## ", "{#a} "],
    ["braces", "## ", "{{#a}"],
  ];
  for (const [name, head, unit] of hostile) {
    it("stays linear for " + name, () => {
      expectLinearTime({
        prepare: (size) => {
          const text =
            head +
            repeatToSize(unit, size) +
            (name === "spaces then x" ? "x" : "");
          const parsed = parseMarkdown(text, "markdown");
          if (parsed.kind !== "parsed") {
            throw new Error("did not parse");
          }
          const block = parsed.tree.children[0];
          if (block?.type !== "heading") {
            throw new Error("not a heading");
          }
          return () => maskBlock(block, parsed);
        },
        probe: { size: 8 * 1024, limitMs: 50 },
        sizes: [32 * 1024, 128 * 1024],
        smallLimitMs: 100,
        largeLimitMs: 200,
        slack: 4,
        floorMs: 50,
      });
    });
  }

  it("gives the right text for a big heading ending in an ID", () => {
    const parsed = parseMarkdown(
      "## " + "a ".repeat(10_000) + "{#id}\n",
      "markdown",
    );
    if (parsed.kind !== "parsed") {
      throw new Error("did not parse");
    }
    const block = parsed.tree.children[0];
    if (block?.type !== "heading") {
      throw new Error("not a heading");
    }
    expect(maskBlock(block, parsed).text).toBe("a ".repeat(10_000).trimEnd());
  });
});
