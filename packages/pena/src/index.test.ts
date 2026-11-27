import { describe, expect, it } from "vitest";
import {
  createExtractorRegistry,
  engineName,
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
});
