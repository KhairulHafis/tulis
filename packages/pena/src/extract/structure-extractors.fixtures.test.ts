import { describe, expect, it } from "vitest";
import { prepareDoc } from "../prepare/prepare-doc.js";
import { createBuiltInExtractors } from "./built-in-extractors.js";
import { createExtractorRegistry } from "./registry.js";
import { runExtractors } from "./run-extractors.js";

const DOC = [
  "# Install the agent",
  "",
  "> [!NOTE]",
  "> Read this first.",
  "",
  "**Warning:** This deletes data.",
  "",
  "```bash",
  "$ kubectl get pods",
  "```",
  "",
  "~~~",
  "plain output",
  "~~~",
  "",
  "<!-- tulis-ignore -->",
  "```yaml",
  "a: 1",
  "```",
  "",
  "{{< caution >}}",
  "Be careful.",
  "{{< /caution >}}",
  "",
].join("\n");

describe("structure extractors end to end", () => {
  it("records admonition and code observations in extractor order", () => {
    const doc = prepareDoc(DOC, "markdown");
    if (doc.kind !== "prepared") throw new Error("not prepared");
    const result = runExtractors(
      createExtractorRegistry(createBuiltInExtractors({ groups: [] })),
      doc,
    );
    expect(result.problems).toEqual([]);
    expect(
      result.observations
        .filter(
          (o) =>
            o.dimension.startsWith("admonition.") ||
            o.dimension.startsWith("code."),
        )
        .map((o) => o.dimension + "=" + o.value),
      // The runner sorts by range start, range end, dimension, then value.
    ).toEqual([
      "admonition.syntax=github-alert",
      "admonition.label-format=title-case-colon",
      "admonition.syntax=paragraph-label",
      "code.fence=backticks",
      "code.lang-name.shell=bash",
      "code.lang-tag=present",
      "code.shell-prompt=dollar",
      "code.fence=tildes",
      "code.lang-tag=missing",
      "admonition.syntax=hugo-shortcode",
    ]);
  });
});
