import type { Paragraph } from "mdast";
import { describe, it } from "vitest";
import { expectLinearTime, repeatToSize } from "@tulis/testkit";
import { maskBlock } from "./mask-block.js";
import { type MaskedText } from "./masked-text.js";
import { parseMarkdown } from "./parse-markdown.js";
import { splitSentences } from "./sentences.js";

/** Parses and masks outside the timed step: only splitSentences is measured. */
function prepare(text: string): MaskedText {
  const parsed = parseMarkdown(text, "markdown");
  if (parsed.kind !== "parsed") {
    throw new Error("did not parse");
  }
  const block = parsed.tree.children[0];
  if (block?.type !== "paragraph") {
    throw new Error("not a paragraph");
  }
  const paragraph: Paragraph = block;
  return maskBlock(paragraph, parsed);
}

/** Probe, small and large sizes in characters. */
type Sizes = readonly [number, number, number];

const SIZES: Sizes = [8 * 1024, 32 * 1024, 128 * 1024];

// MAX_LOOK_BACK is a guard: the look-back only crosses letters and dots, and a
// candidate end needs whitespace after it, so look-backs never overlap and the
// scan is linear even without the bound. The timing tests catch a look-back or
// a look-ahead that runs to the start or end of the whole text.
const cases: [string, string][] = [
  ["repeated dot and space", ". "],
  ["repeated e.g.", "e.g. "],
  // A capital after each dot makes every dot reach the abbreviation look-back.
  ["repeated dot before a capital", "a. B "],
  ["repeated a.", "a."],
  ["one long run of dots", "."],
  ["one long word", "abcdefghij"],
  ["repeated U.S.A.", "U.S.A."],
  ["repeated quote and paren closers after a dot", '.")'],
  ["repeated closers and spaces", '."  ) '],
];

describe("splitSentences on hostile input", () => {
  for (const [name, unit] of cases) {
    it("stays linear for " + name, () => {
      // Probe first with a tight limit so a quadratic regression fails there
      // in well under a second instead of grinding through the large input.
      expectLinearTime({
        prepare: (size) => {
          const masked = prepare(repeatToSize(unit, size));
          return () => splitSentences(masked);
        },
        probe: { size: SIZES[0], limitMs: 50 },
        sizes: [SIZES[1], SIZES[2]],
        smallLimitMs: 100,
        largeLimitMs: 200,
        slack: 4,
        floorMs: 50,
      });
    });
  }
});
