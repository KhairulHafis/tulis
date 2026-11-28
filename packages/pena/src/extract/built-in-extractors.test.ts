import { describe, expect, it } from "vitest";
import type { VariantGroup } from "../config/variants-types.js";
import { prepareDoc } from "../prepare/prepare-doc.js";
import { createExtractorRegistry } from "./registry.js";
import { runExtractors } from "./run-extractors.js";
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
  it("lists synonyms, verb-noun, purpose clauses, headings, procedures, admonitions, code blocks, UI labels, then doc shape", () => {
    const extractors = createBuiltInExtractors({ groups });
    expect(extractors.map((extractor) => extractor.id)).toEqual([
      "term.synonyms",
      "term.verb-noun",
      "phrasing.purpose-clause",
      "heading.case",
      "heading.end-punct",
      "procedure.numbering",
      "procedure.step-start",
      "procedure.step-end-punct",
      "procedure.intro",
      "admonition.syntax",
      "admonition.label-format",
      "code.fence",
      "code.lang-tag",
      "code.lang-name",
      "code.shell-prompt",
      "ui.format",
      "shape.intro",
      "shape.heading-skip",
      "shape.sections",
    ]);
  });

  it("includes the six structure extractors before the UI and shape ones, with no groups", () => {
    const extractors = createBuiltInExtractors({ groups: [] });
    expect(extractors.slice(-10, -4).map((e) => e.id)).toEqual([
      "admonition.syntax",
      "admonition.label-format",
      "code.fence",
      "code.lang-tag",
      "code.lang-name",
      "code.shell-prompt",
    ]);
  });

  it("returns the same ids every time, and they register without clashes", () => {
    const first = createBuiltInExtractors({ groups });
    const second = createBuiltInExtractors({ groups: [] });
    expect(second.map((e) => e.id)).toEqual(first.map((e) => e.id));
    expect(() => createExtractorRegistry(first)).not.toThrow();
  });

  it("passes the proper nouns to the heading case extractor", () => {
    const doc = prepareDoc("# Disable Datadog\n", "markdown");
    if (doc.kind !== "prepared") throw new Error("not prepared");
    const prepared = doc;
    function dims(properNouns?: ReadonlySet<string>): string[] {
      const extractors =
        properNouns === undefined
          ? createBuiltInExtractors({ groups: [] })
          : createBuiltInExtractors({ groups: [], properNouns });
      const result = runExtractors(
        createExtractorRegistry(extractors),
        prepared,
      );
      return result.observations
        .filter((o) => o.dimension.startsWith("heading.case"))
        .map((o) => o.dimension + "=" + o.value);
    }
    expect(dims()).toEqual(["heading.case.h1=title"]);
    expect(dims(new Set(["datadog"]))).toEqual([]);
  });
});
