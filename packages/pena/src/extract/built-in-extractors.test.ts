import { describe, expect, it } from "vitest";
import type { VariantGroup } from "../config/variants-types.js";
import { createExtractorRegistry } from "./registry.js";
import { createBuiltInExtractors } from "./built-in-extractors.js";

const groups: readonly VariantGroup[] = [
  {
    id: "sign-in",
    kind: "synonym",
    variants: ["log in", "sign in"],
    source: "seed",
  },
];

describe("createBuiltInExtractors", () => {
  it("lists the synonym extractor first", () => {
    const extractors = createBuiltInExtractors({ groups });
    expect(extractors.map((extractor) => extractor.id)).toEqual([
      "term.synonyms",
    ]);
  });

  it("returns the same ids every time, and they register without clashes", () => {
    const first = createBuiltInExtractors({ groups });
    const second = createBuiltInExtractors({ groups: [] });
    expect(second.map((e) => e.id)).toEqual(first.map((e) => e.id));
    expect(() => createExtractorRegistry(first)).not.toThrow();
  });
});
