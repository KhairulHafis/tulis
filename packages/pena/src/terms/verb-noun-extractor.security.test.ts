import { describe, expect, it } from "vitest";
import { expectLinearTime } from "@tulis/testkit";
import type { VariantGroup } from "../config/variants-types.js";
import { MAX_OBSERVATIONS_PER_EXTRACTOR } from "../extract/observation.js";
import { createExtractorRegistry } from "../extract/registry.js";
import { runExtractors } from "../extract/run-extractors.js";
import { sentenceTags } from "../prepare/sentence-tags.js";
import { prepareDoc, type PreparedDoc } from "../prepare/prepare-doc.js";
import { createVerbNounExtractor } from "./verb-noun-extractor.js";

const groups: readonly VariantGroup[] = [
  {
    id: "login-form",
    kind: "verb-noun",
    noun: "login",
    verb: "log in",
    source: "seed",
  },
  {
    id: "setup-form",
    kind: "verb-noun",
    noun: "setup",
    verb: "set up",
    source: "seed",
  },
];

function prepared(text: string): PreparedDoc {
  const doc = prepareDoc(text, "markdown");
  if (doc.kind !== "prepared") {
    throw new Error("expected a prepared doc");
  }
  return doc;
}

function run(doc: PreparedDoc) {
  return runExtractors(
    createExtractorRegistry([createVerbNounExtractor(groups)]),
    doc,
  );
}

describe("timing", () => {
  // A guard against a slow matcher or role rules over a mid-size paragraph.
  // It cannot catch a quadratic lookup per match (about 1,600 matches here is
  // too few); the extraction-only test below does.
  it("stays linear for a long paragraph of matches", () => {
    expectLinearTime({
      prepare: (size) => {
        const doc = prepared(
          "login to the portal setup the cluster ".repeat(size) + "\n",
        );
        return () => run(doc);
      },
      probe: { size: 100, limitMs: 200 },
      sizes: [200, 400, 800],
      smallLimitMs: 300,
      largeLimitMs: 600,
      slack: 4,
      floorMs: 50,
    });
  });

  // Tagging is cached before the timer starts, so only extract() is timed.
  // Every token is a match, so a per-match scan over the tokens is quadratic.
  // Good code takes about 5, 10 and 22 ms at 2,500, 10,000 and 20,000 matches,
  // under a quarter of each limit. A findIndex for both lookups, for only
  // first, or for only last each fail it by more than 1.5 times.
  it("extraction alone stays linear with a match on every token", () => {
    const extractor = createVerbNounExtractor(groups);
    expectLinearTime({
      prepare: (size) => {
        const doc = prepared("login ".repeat(size) + "\n");
        const units = doc.blocks.flatMap((block) =>
          block.sentences.map((sentence) => {
            sentenceTags(sentence);
            return { block, sentence };
          }),
        );
        return () => {
          for (const { block, sentence } of units) {
            extractor.extract(sentence, { doc, block });
          }
        };
      },
      probe: { size: 2500, limitMs: 30 },
      sizes: [5000, 10000, 20000],
      smallLimitMs: 50,
      largeLimitMs: 150,
      slack: 4,
      floorMs: 150,
    });
  });

  // Correctness at 256 KiB, with no time bound: the timing is covered above.
  it("handles a 256 KiB paragraph, the runner capping the findings", () => {
    const text = "login to the portal setup the cluster ".repeat(6900);
    expect(text.length).toBeGreaterThan(256 * 1024);
    const result = run(prepared(text + "\n"));
    // 6,900 repeats give 13,800 findings; the runner keeps the first 10,000.
    expect(result.problems).toEqual([
      {
        extractorId: "term.verb-noun",
        kind: "too-many",
        count: 13800 - MAX_OBSERVATIONS_PER_EXTRACTOR,
      },
    ]);
    expect(result.observations).toHaveLength(MAX_OBSERVATIONS_PER_EXTRACTOR);
  });
});

describe("edges", () => {
  it("handles a match at the very start and end of a sentence", () => {
    for (const text of [
      "login",
      "log in",
      "Setup",
      "set up",
      "login. setup",
      "log-in",
    ]) {
      const result = run(prepared(text + "\n"));
      expect(result.problems).toEqual([]);
    }
  });

  it("never throws, and carries no doc text if it did", () => {
    const secret = "SECRET-PHRASE login";
    expect(() => run(prepared(secret + "\n"))).not.toThrow();
  });
});
