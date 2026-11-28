import { describe, expect, it } from "vitest";
import { createExtractorRegistry } from "../extract/registry.js";
import { runExtractors } from "../extract/run-extractors.js";
import { prepareDoc } from "../prepare/prepare-doc.js";
import { createHeadingCaseExtractor } from "./heading-case-extractor.js";
import { createHeadingEndPunctExtractor } from "./heading-end-punct-extractor.js";

function run(
  text: string,
  syntax: "markdown" | "mdx",
  which: "case" | "punct",
) {
  const doc = prepareDoc(text, syntax);
  if (doc.kind !== "prepared") throw new Error("not prepared");
  const extractor =
    which === "case"
      ? createHeadingCaseExtractor()
      : createHeadingEndPunctExtractor();
  const result = runExtractors(createExtractorRegistry([extractor]), doc);
  expect(result.problems).toEqual([]);
  return result.observations;
}

const pairs = (
  text: string,
  syntax: "markdown" | "mdx",
  which: "case" | "punct",
) => run(text, syntax, which).map((o) => [o.dimension, o.value]);

const DOC_A = `---
title: Install the Agent
---

## Before you begin

Some text.

### Configure the Server {#configure}

## Overview

## Prerequisites:
`;

const DOC_B = `---
title: Something Else
---

# Getting Started

## What is a Pod?
`;

describe("Doc A: frontmatter title and mixed headings", () => {
  it("records case per level, with the title on line 2", () => {
    const obs = run(DOC_A, "markdown", "case");
    expect(obs.map((o) => [o.dimension, o.value])).toEqual([
      ["heading.case.h1", "title"],
      ["heading.case.h2plus", "sentence"],
      ["heading.case.h2plus", "title"],
    ]);
    expect(obs[0]?.line).toBe(2);
    expect(obs[0]?.text).toContain("Install the Agent");
    expect(DOC_A.slice(obs[2]?.range.start, obs[2]?.range.end)).toBe(
      "Configure the Server",
    );
  });

  it("records end punctuation for every heading", () => {
    expect(pairs(DOC_A, "markdown", "punct")).toEqual([
      ["heading.end-punct", "none"],
      ["heading.end-punct", "none"],
      ["heading.end-punct", "none"],
      ["heading.end-punct", "none"],
      ["heading.end-punct", "colon"],
    ]);
  });
});

describe("Doc B: an H1 beats the frontmatter title", () => {
  it("uses only the H1 for case", () => {
    expect(pairs(DOC_B, "markdown", "case")).toEqual([
      ["heading.case.h1", "title"],
      ["heading.case.h2plus", "sentence"],
    ]);
  });

  it("records none for the H1 and nothing for the question", () => {
    expect(pairs(DOC_B, "markdown", "punct")).toEqual([
      ["heading.end-punct", "none"],
    ]);
  });
});

describe("Doc C: mdx", () => {
  it("reads sentence then title case in h2plus", () => {
    expect(
      pairs("## Install the agent\n\n#### Run the Tests\n", "mdx", "case"),
    ).toEqual([
      ["heading.case.h2plus", "sentence"],
      ["heading.case.h2plus", "title"],
    ]);
  });
});

describe("Doc D: setext H1", () => {
  it("reads sentence case at h1", () => {
    expect(pairs("Install the agent\n===\n", "markdown", "case")).toEqual([
      ["heading.case.h1", "sentence"],
    ]);
  });
});

describe("Doc E: nothing to see", () => {
  it("gives no observations and no problems", () => {
    expect(run("Just some text.\n", "markdown", "case")).toEqual([]);
    expect(run("Just some text.\n", "markdown", "punct")).toEqual([]);
  });
});
