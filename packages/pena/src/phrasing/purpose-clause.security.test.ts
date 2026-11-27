import { describe, expect, it } from "vitest";
import { expectLinearTime } from "@tulis/testkit";
import type { TaggedToken } from "../language/tag-tokens.js";
import { prepareDoc } from "../prepare/prepare-doc.js";
import { sentenceTags } from "../prepare/sentence-tags.js";
import { findPurposeClause } from "./purpose-clause.js";

function tagsOf(text: string): readonly TaggedToken[] {
  const doc = prepareDoc(text + "\n", "markdown");
  if (doc.kind !== "prepared") {
    throw new Error("expected a prepared doc");
  }
  const tags: TaggedToken[] = [];
  for (const block of doc.blocks) {
    for (const sentence of block.sentences) {
      tags.push(...sentenceTags(sentence));
    }
  }
  return tags;
}

// Tagging happens in prepare(), so only the rules are timed. The rules take
// well under a millisecond here, so the 40 ms limit is far from good code and
// a quadratic rescan (over 100 ms at these sizes) fails with a clear margin.
describe("findPurposeClause timing", () => {
  // A guard: the scan stops at the first "to" (a verb stands before it), so
  // this shape cannot be made slow; it checks the early stop stays cheap.
  it("stays linear for a long run of 'to run' words", () => {
    expectLinearTime({
      prepare: (size) => {
        const tags = tagsOf("Run " + "to run ".repeat(size));
        return () => findPurposeClause(tags);
      },
      probe: { size: 500, limitMs: 100 },
      sizes: [1000, 2000, 4000],
      smallLimitMs: 100,
      largeLimitMs: 40,
      slack: 4,
      floorMs: 20,
    });
  });

  it("stays linear for thousands of commas with no instruction after", () => {
    expectLinearTime({
      prepare: (size) => {
        const tags = tagsOf("To x, " + "y, ".repeat(size) + "z.");
        return () => findPurposeClause(tags);
      },
      probe: { size: 1000, limitMs: 100 },
      sizes: [2000, 4000, 8000],
      smallLimitMs: 100,
      largeLimitMs: 40,
      slack: 4,
      floorMs: 20,
    });
  });

  // Each "to the" is skipped by the end rule (no verb follows), so the single
  // scan must walk every token; a rescan per "to" would be quadratic.
  it("stays linear when every to is skipped", () => {
    expectLinearTime({
      prepare: (size) => {
        const tags = tagsOf("Run " + "to the ".repeat(size));
        return () => findPurposeClause(tags);
      },
      probe: { size: 500, limitMs: 100 },
      sizes: [2000, 4000, 8000],
      smallLimitMs: 100,
      largeLimitMs: 40,
      slack: 4,
      floorMs: 20,
    });
  });

  it("gives an answer for hostile shapes without throwing", () => {
    for (const text of [
      ",".repeat(500),
      "To " + ",".repeat(500),
      "In order to " + "to ".repeat(300),
      "Run " + "in order ".repeat(300),
    ]) {
      expect(() => findPurposeClause(tagsOf(text))).not.toThrow();
    }
  });
});
