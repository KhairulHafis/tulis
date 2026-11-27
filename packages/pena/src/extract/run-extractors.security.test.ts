import { describe, expect, it } from "vitest";
import { expectLinearTime } from "@tulis/testkit";
import { prepareDoc, type PreparedDoc } from "../prepare/prepare-doc.js";
import type { Extractor, SentenceExtractor } from "./extractor.js";
import { createExtractorRegistry } from "./registry.js";
import { runExtractors } from "./run-extractors.js";

function prepared(text: string): PreparedDoc {
  const result = prepareDoc(text, "markdown");
  if (result.kind !== "prepared") {
    throw new Error("expected a prepared doc, got " + result.reason);
  }
  return result;
}

describe("doc text never leaks", () => {
  it("leaves no trace of an error message that holds doc text", () => {
    const secret = "SECRET-PHRASE-42";
    const doc = prepared("The " + secret + " is here.\n");
    const thrower: Extractor = {
      id: "term.leaky",
      scope: "sentence",
      extract: (sentence) => {
        throw new Error("failed on: " + sentence.text, {
          cause: sentence.text,
        });
      },
    };
    const result = runExtractors(createExtractorRegistry([thrower]), doc);
    expect(result.problems).toEqual([
      { extractorId: "term.leaky", kind: "threw", count: 1 },
    ]);
    expect(result.observations).toEqual([]);
    expect(JSON.stringify(result)).not.toContain(secret);
    expect(JSON.stringify(result)).not.toContain("failed");
  });
});

describe("ranges outside the unit", () => {
  const doc = prepared("First secret line.\n\nSecond line.\n");
  const outside: SentenceExtractor = {
    id: "term.out",
    scope: "sentence",
    extract: () => [
      { dimension: "term.x", value: "v", range: { start: 0, end: 30 } },
    ],
  };

  it("drops a finding that reaches past its sentence", () => {
    const result = runExtractors(createExtractorRegistry([outside]), doc);
    expect(result.observations).toEqual([]);
    expect(result.problems).toEqual([
      { extractorId: "term.out", kind: "bad-finding", count: 2 },
    ]);
  });

  it("never copies text from another unit into the evidence", () => {
    const peek: SentenceExtractor = {
      id: "term.peek",
      scope: "sentence",
      extract: () => [
        { dimension: "term.x", value: "v", range: { start: 20, end: 25 } },
      ],
    };
    const result = runExtractors(createExtractorRegistry([peek]), doc);
    // Only the second sentence contains offsets 20 to 25.
    expect(result.observations.map((o) => o.text)).toEqual(["Second line."]);
    expect(result.problems).toEqual([
      { extractorId: "term.peek", kind: "bad-finding", count: 1 },
    ]);
  });
});

describe("running time", () => {
  const perSentence: SentenceExtractor = {
    id: "sentence.each",
    scope: "sentence",
    extract: (sentence) => [
      { dimension: "sentence.each", value: "x", range: sentence.source },
    ],
  };
  const registry = createExtractorRegistry([perSentence]);

  it("grows linearly with the number of sentences", () => {
    expectLinearTime({
      prepare: (size) => {
        const doc = prepared("A short one. Another one here.\n\n".repeat(size));
        return () => runExtractors(registry, doc);
      },
      probe: { size: 250, limitMs: 100 },
      sizes: [500, 1000, 2000],
      smallLimitMs: 200,
      largeLimitMs: 400,
      slack: 4,
      floorMs: 50,
    });
  });

  it("stays linear on one very long sentence", () => {
    expectLinearTime({
      prepare: (size) => {
        const doc = prepared("word ".repeat(size) + "end.\n");
        return () => runExtractors(registry, doc);
      },
      probe: { size: 2000, limitMs: 100 },
      sizes: [4000, 8000, 16000],
      smallLimitMs: 200,
      largeLimitMs: 400,
      slack: 4,
      floorMs: 50,
    });
  });
});
