import { describe, expect, it } from "vitest";
import { createExtractorRegistry } from "../extract/registry.js";
import { runExtractors } from "../extract/run-extractors.js";
import { prepareDoc } from "../prepare/prepare-doc.js";
import { createCodeLangTagExtractor } from "./code-lang-tag-extractor.js";

describe("createCodeLangTagExtractor", () => {
  it("has the id code.lang-tag and document scope", () => {
    const extractor = createCodeLangTagExtractor();
    expect(extractor.id).toBe("code.lang-tag");
    expect(extractor.scope).toBe("document");
  });

  it("records present and missing for fenced blocks, nothing for indented", () => {
    const doc = prepareDoc(
      "```js\nx\n```\n\n```\ny\n```\n\nText\n\n    old\n\n~~~\nz\n~~~\n",
      "markdown",
    );
    if (doc.kind !== "prepared") throw new Error("not prepared");
    const result = runExtractors(
      createExtractorRegistry([createCodeLangTagExtractor()]),
      doc,
    );
    expect(result.problems).toEqual([]);
    expect(result.observations.map((o) => o.dimension + "=" + o.value)).toEqual(
      [
        "code.lang-tag=present",
        "code.lang-tag=missing",
        "code.lang-tag=missing",
      ],
    );
  });
});
