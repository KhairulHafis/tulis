import { describe, expect, it } from "vitest";
import { createExtractorRegistry } from "../extract/registry.js";
import { runExtractors } from "../extract/run-extractors.js";
import { prepareDoc } from "../prepare/prepare-doc.js";
import { createAdmonitionLabelFormatExtractor } from "./admonition-label-format-extractor.js";

describe("createAdmonitionLabelFormatExtractor", () => {
  it("has the id admonition.label-format and document scope", () => {
    const extractor = createAdmonitionLabelFormatExtractor();
    expect(extractor.id).toBe("admonition.label-format");
    expect(extractor.scope).toBe("document");
  });

  it("records the format over the label, and skips labels without one", () => {
    const doc = prepareDoc(
      "**NOTE:** A\n\n**note:** B\n\n> [!NOTE]\n> C\n\n**Tip** D\n",
      "markdown",
    );
    if (doc.kind !== "prepared") throw new Error("skipped");
    const result = runExtractors(
      createExtractorRegistry([createAdmonitionLabelFormatExtractor()]),
      doc,
    );
    expect(result.problems).toEqual([]);
    expect(
      result.observations.map((o) => [
        o.value,
        doc.parsed.source.slice(o.range.start, o.range.end),
      ]),
    ).toEqual([
      ["upper-case-colon", "**NOTE:**"],
      ["title-case", "**Tip**"],
    ]);
  });
});
