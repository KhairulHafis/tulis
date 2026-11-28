import { describe, expect, it } from "vitest";
import { createExtractorRegistry } from "../extract/registry.js";
import { runExtractors } from "../extract/run-extractors.js";
import { prepareDoc } from "../prepare/prepare-doc.js";
import { createCodeLangNameExtractor } from "./code-lang-name-extractor.js";

describe("createCodeLangNameExtractor", () => {
  it("has the id code.lang-name and document scope", () => {
    const extractor = createCodeLangNameExtractor();
    expect(extractor.id).toBe("code.lang-name");
    expect(extractor.scope).toBe("document");
  });

  it("records the lower-cased name under its group, skipping unknown and missing", () => {
    const doc = prepareDoc(
      "```Bash\nx\n```\n\n```YML\na\n```\n\n```json\n{}\n```\n\n```\nq\n```\n\n```constructor\nx\n```\n",
      "markdown",
    );
    if (doc.kind !== "prepared") throw new Error("not prepared");
    const result = runExtractors(
      createExtractorRegistry([createCodeLangNameExtractor()]),
      doc,
    );
    expect(result.problems).toEqual([]);
    expect(result.observations.map((o) => o.dimension + "=" + o.value)).toEqual(
      ["code.lang-name.shell=bash", "code.lang-name.yaml=yml"],
    );
  });
});
