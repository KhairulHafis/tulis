import { describe, expect, it } from "vitest";
import { createExtractorRegistry } from "../extract/registry.js";
import { runExtractors } from "../extract/run-extractors.js";
import { prepareDoc } from "../prepare/prepare-doc.js";
import { createCodeShellPromptExtractor } from "./code-shell-prompt-extractor.js";

describe("createCodeShellPromptExtractor", () => {
  it("has the id code.shell-prompt and document scope", () => {
    const extractor = createCodeShellPromptExtractor();
    expect(extractor.id).toBe("code.shell-prompt");
    expect(extractor.scope).toBe("document");
  });

  it("judges shell blocks only, and skips undecided ones", () => {
    const doc = prepareDoc(
      "```bash\n$ ls\n```\n\n```zsh\nls\n```\n\n```yaml\n$ a\n```\n\n```sh\n# c\n```\n\n```\n$ x\n```\n",
      "markdown",
    );
    if (doc.kind !== "prepared") throw new Error("not prepared");
    const result = runExtractors(
      createExtractorRegistry([createCodeShellPromptExtractor()]),
      doc,
    );
    expect(result.problems).toEqual([]);
    expect(result.observations.map((o) => o.dimension + "=" + o.value)).toEqual(
      ["code.shell-prompt=dollar", "code.shell-prompt=none"],
    );
  });
});
