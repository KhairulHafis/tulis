import { describe, expect, it } from "vitest";
import {
  createBuiltInExtractors,
  createHeadingCaseExtractor,
  createHeadingEndPunctExtractor,
  createExtractorRegistry,
  engineName,
  headingCase,
  countWordCase,
  sumWordCase,
  learnProperNouns,
  properNounKey,
  MAX_PROPER_NOUNS,
  headingEndPunct,
  parseSeedGroups,
  prepareDoc,
  runExtractors,
} from "./index.js";

describe("pena", () => {
  it("exports the engine name", () => {
    expect(engineName).toBe("Pena");
  });

  it("exports prepareDoc, which prepares a one-line doc", () => {
    const doc = prepareDoc("Hello there.\n", "markdown");
    expect(doc.kind).toBe("prepared");
    if (doc.kind === "prepared") {
      expect(doc.blocks[0]?.sentences[0]?.text).toBe("Hello there.");
    }
  });

  it("runs a sample extractor through the exports", () => {
    const doc = prepareDoc("Hello there.\n", "markdown");
    if (doc.kind !== "prepared") {
      throw new Error("expected a prepared doc");
    }
    const registry = createExtractorRegistry([
      {
        id: "sentence.period",
        scope: "sentence",
        extract: (sentence) => [
          {
            dimension: "sentence.period",
            value: sentence.text.endsWith(".") ? "yes" : "no",
            range: sentence.source,
          },
        ],
      },
    ]);
    const result = runExtractors(registry, doc);
    expect(result.problems).toEqual([]);
    expect(result.observations).toEqual([
      {
        dimension: "sentence.period",
        value: "yes",
        range: { start: 0, end: 12 },
        line: 1,
        text: "Hello there.",
      },
    ]);
  });

  it("runs the built-in extractors through the exports", () => {
    const doc = prepareDoc("Please log in.\n", "markdown");
    if (doc.kind !== "prepared") {
      throw new Error("expected a prepared doc");
    }
    const groups = parseSeedGroups(
      'version: 1\ngroups:\n  - id: sign-in\n    kind: synonym\n    variants: ["log in", "sign in"]\n',
    );
    const result = runExtractors(
      createExtractorRegistry(createBuiltInExtractors({ groups })),
      doc,
    );
    expect(result.observations.map((o) => [o.dimension, o.value])).toEqual([
      ["term.sign-in", "log in"],
    ]);
  });

  it("exports the heading extractors and rules", () => {
    const doc = prepareDoc("## Install the agent:\n", "markdown");
    if (doc.kind !== "prepared") {
      throw new Error("expected a prepared doc");
    }
    const result = runExtractors(
      createExtractorRegistry([
        createHeadingCaseExtractor(),
        createHeadingEndPunctExtractor(),
      ]),
      doc,
    );
    expect(result.observations.map((o) => [o.dimension, o.value])).toEqual([
      ["heading.case.h2plus", "sentence"],
      ["heading.end-punct", "colon"],
    ]);
    const tokens = doc.blocks[0]?.sentences[0]?.tokens ?? [];
    expect(headingCase(tokens)).toBe("sentence");
    expect(headingEndPunct(tokens)).toBe("colon");
  });

  it("exports the proper-noun learning functions", () => {
    const doc = prepareDoc("Use Datadog and Datadog here.\n", "markdown");
    if (doc.kind !== "prepared") throw new Error("expected a prepared doc");
    const counts = countWordCase(doc);
    expect(counts.get("datadog")).toEqual({ upper: 2, lower: 0 });
    const totals = sumWordCase([counts]);
    expect(learnProperNouns(totals).size).toBe(0);
    expect(properNounKey("Datadog\u2019s")).toBe("datadog");
    expect(MAX_PROPER_NOUNS).toBe(10_000);
  });
});
