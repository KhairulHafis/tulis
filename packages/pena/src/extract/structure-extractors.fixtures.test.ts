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

  it("records ui.format and shape observations in runner order", () => {
    const text = [
      "---",
      "title: Install the agent",
      "---",
      "",
      "{{< details >}}",
      "",
      "- Tier: Free",
      "",
      "{{< /details >}}",
      "",
      "This page explains how to install the agent.",
      "",
      "## Prerequisites",
      "",
      'Select **Settings** and then click "Save".',
      "",
      "#### Too deep",
      "",
      "## Install the agent",
      "",
      '1. Select {{< ui text="Install" >}}.',
      "",
    ].join("\n");
    const doc = prepareDoc(text, "markdown");
    if (doc.kind !== "prepared") throw new Error("not prepared");
    const result = runExtractors(
      createExtractorRegistry(createBuiltInExtractors({ groups: [] })),
      doc,
    );
    expect(result.problems).toEqual([]);
    const source = doc.parsed.source;
    expect(
      result.observations
        .filter(
          (o) =>
            o.dimension.startsWith("ui.") || o.dimension.startsWith("shape."),
        )
        .map(
          (o) =>
            o.dimension +
            "=" +
            o.value +
            " " +
            JSON.stringify(source.slice(o.range.start, o.range.end)),
        ),
    ).toEqual([
      'shape.intro=yes "This page explains how to install the agent."',
      'shape.sections=prerequisites "## Prerequisites"',
      'ui.format=bold "Select **Settings**"',
      'ui.format=quotes "click \\"Save\\""',
      'shape.heading-skip=jump "#### Too deep"',
      'shape.sections=install the agent "## Install the agent"',
      'ui.format=hugo-shortcode "Select {{< ui text=\\"Install\\" >}}"',
    ]);
  });
});
