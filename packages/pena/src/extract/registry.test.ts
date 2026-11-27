import { describe, expect, it } from "vitest";
import type { Extractor } from "./extractor.js";
import { createExtractorRegistry, ExtractorRegistryError } from "./registry.js";

function sentenceExtractor(
  id: string,
  blockKinds?: readonly ("paragraph" | "heading" | "tableCell")[],
): Extractor {
  return blockKinds === undefined
    ? { id, scope: "sentence", extract: () => [] }
    : { id, scope: "sentence", blockKinds, extract: () => [] };
}

describe("createExtractorRegistry", () => {
  it("keeps the given order and finds extractors by id", () => {
    const b = sentenceExtractor("term.b");
    const a = sentenceExtractor("heading.a");
    const registry = createExtractorRegistry([b, a]);
    expect(registry.extractors).toEqual([b, a]);
    expect(registry.get("heading.a")).toBe(a);
    expect(registry.get("term.b")).toBe(b);
    expect(registry.get("term.c")).toBeUndefined();
  });

  it("accepts an empty list", () => {
    expect(createExtractorRegistry([]).extractors).toEqual([]);
  });

  it("rejects an id that is not a check ID", () => {
    expect(() =>
      createExtractorRegistry([sentenceExtractor("noparts")]),
    ).toThrow(ExtractorRegistryError);
    expect(() =>
      createExtractorRegistry([sentenceExtractor("Term.Upper")]),
    ).toThrow(ExtractorRegistryError);
  });

  it("rejects a repeated id", () => {
    expect(() =>
      createExtractorRegistry([
        sentenceExtractor("term.a"),
        sentenceExtractor("term.a"),
      ]),
    ).toThrow(/used twice/);
  });

  it("rejects empty or repeated blockKinds", () => {
    expect(() =>
      createExtractorRegistry([sentenceExtractor("term.a", [])]),
    ).toThrow(/empty/);
    expect(() =>
      createExtractorRegistry([
        sentenceExtractor("term.a", ["heading", "heading"]),
      ]),
    ).toThrow(/repeats/);
  });

  it("accepts distinct blockKinds", () => {
    expect(() =>
      createExtractorRegistry([
        sentenceExtractor("term.a", ["heading", "paragraph"]),
      ]),
    ).not.toThrow();
  });

  it("is not changed by later edits to the given array", () => {
    const list = [sentenceExtractor("term.a")];
    const registry = createExtractorRegistry(list);
    list.push(sentenceExtractor("term.b"));
    expect(registry.extractors).toHaveLength(1);
  });
});
