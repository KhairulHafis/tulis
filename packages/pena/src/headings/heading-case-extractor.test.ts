import { describe, expect, it } from "vitest";
import { createExtractorRegistry } from "../extract/registry.js";
import { runExtractors } from "../extract/run-extractors.js";
import { prepareDoc } from "../prepare/prepare-doc.js";
import { createHeadingCaseExtractor } from "./heading-case-extractor.js";

function run(text: string) {
  const doc = prepareDoc(text, "markdown");
  if (doc.kind !== "prepared") throw new Error("not prepared");
  return runExtractors(
    createExtractorRegistry([createHeadingCaseExtractor()]),
    doc,
  );
}

describe("createHeadingCaseExtractor", () => {
  it("has the id heading.case and document scope", () => {
    const extractor = createHeadingCaseExtractor();
    expect(extractor.id).toBe("heading.case");
    expect(extractor.scope).toBe("document");
  });

  it("splits h1 from lower headings", () => {
    const result = run("# Install the Agent\n\n## Before you begin\n");
    expect(result.problems).toEqual([]);
    expect(result.observations.map((o) => [o.dimension, o.value])).toEqual([
      ["heading.case.h1", "title"],
      ["heading.case.h2plus", "sentence"],
    ]);
  });

  it("gives nothing when the rule is undecided", () => {
    expect(run("## Overview\n").observations).toEqual([]);
  });
});

describe("createHeadingCaseExtractor with proper nouns", () => {
  function runWith(text: string, properNouns?: ReadonlySet<string>) {
    const doc = prepareDoc(text, "markdown");
    if (doc.kind !== "prepared") throw new Error("not prepared");
    const extractor =
      properNouns === undefined
        ? createHeadingCaseExtractor()
        : createHeadingCaseExtractor({ properNouns });
    return runExtractors(createExtractorRegistry([extractor]), doc);
  }

  it("records title for an H1 with a name when no set is given", () => {
    const result = runWith("# Disable Datadog\n");
    expect(result.observations.map((o) => [o.dimension, o.value])).toEqual([
      ["heading.case.h1", "title"],
    ]);
  });

  it("records nothing for that H1 when the name is learned", () => {
    const result = runWith("# Disable Datadog\n", new Set(["datadog"]));
    expect(result.problems).toEqual([]);
    expect(result.observations).toEqual([]);
  });

  it("applies the set to a frontmatter title", () => {
    const text = "---\ntitle: Extending Kubernetes\n---\n\nBody text.\n";
    expect(
      runWith(text).observations.map((o) => [o.dimension, o.value]),
    ).toEqual([["heading.case.h1", "title"]]);
    expect(runWith(text, new Set(["kubernetes"])).observations).toEqual([]);
  });
});
