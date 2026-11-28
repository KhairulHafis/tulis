import { describe, expect, it } from "vitest";
import { createBuiltInExtractors } from "../extract/built-in-extractors.js";
import { createExtractorRegistry } from "../extract/registry.js";
import { runExtractors } from "../extract/run-extractors.js";
import { prepareDoc } from "../prepare/prepare-doc.js";
import { createProcedureIntroExtractor } from "./procedure-intro-extractor.js";
import { createProcedureNumberingExtractor } from "./procedure-numbering-extractor.js";
import { createStepEndPunctExtractor } from "./step-end-punct-extractor.js";
import { createStepStartExtractor } from "./step-start-extractor.js";

function four() {
  return [
    createProcedureNumberingExtractor(),
    createStepStartExtractor(),
    createStepEndPunctExtractor(),
    createProcedureIntroExtractor(),
  ];
}

function answers(
  text: string,
  syntax: "markdown" | "mdx" = "markdown",
  built = false,
): string[] {
  const doc = prepareDoc(text, syntax);
  if (doc.kind !== "prepared") throw new Error("not prepared");
  const extractors = built ? createBuiltInExtractors({ groups: [] }) : four();
  const result = runExtractors(createExtractorRegistry(extractors), doc);
  expect(result.problems).toEqual([]);
  return result.observations
    .filter((o) => o.dimension.startsWith("procedure."))
    .map((o) => o.dimension + "=" + o.value + "@" + String(o.line));
}

/** Groups the runner's output by dimension, keeping each dimension's order. */
function byDimension(list: readonly string[]): string[] {
  const order = [
    "procedure.numbering",
    "procedure.step-start",
    "procedure.step-end-punct",
    "procedure.intro",
  ];
  return order.flatMap((dimension) =>
    list.filter((item) => item.startsWith(dimension + "=")),
  );
}

const DOC_A = [
  "# Create a project",
  "",
  "To create a project:",
  "",
  "1. On the left sidebar, select **Create new**.",
  "1. Select **New project**.",
  "1. Enter a name:",
  "",
  "   ```shell",
  "   my-project",
  "   ```",
  "",
  "1. Select **Create project**",
  "",
].join("\n");

const EXPECTED_A = [
  "procedure.numbering=all-ones@5",
  "procedure.step-start=imperative@5",
  "procedure.step-start=imperative@6",
  "procedure.step-start=imperative@7",
  "procedure.step-start=imperative@13",
  "procedure.step-end-punct=period@5",
  "procedure.step-end-punct=period@6",
  "procedure.step-end-punct=none@13",
  "procedure.intro=colon@3",
];

const DOC_B = [
  "## Before you begin",
  "",
  "1. Install kubectl.",
  "2. Configure access to the cluster.",
  "3. Check the version.",
  "",
  "## How it works",
  "",
  "1. The client sends a request.",
  "2. The API server checks it.",
  "3. The scheduler places the Pod.",
  "",
].join("\n");

const DOC_C = [
  "Follow these steps:",
  "",
  "1. Open the file.",
  "2. The file has two sections.",
  "3. Remove the second section",
  "   1. Select the text.",
  "   2. Delete it.",
  "",
].join("\n");

const DOC_D = [
  "1. Install the agent.",
  "",
  "<!-- tulis-ignore -->",
  "",
  "1. Open the file.",
  "1. Close the file.",
  "",
].join("\n");

describe("procedure extractors, end to end", () => {
  it("doc A: a command list with a colon intro and a code step", () => {
    expect(byDimension(answers(DOC_A))).toEqual(EXPECTED_A);
  });

  it("doc B: a heading intro; the descriptive list gives nothing", () => {
    expect(byDimension(answers(DOC_B))).toEqual([
      "procedure.numbering=sequential@3",
      "procedure.step-start=imperative@3",
      "procedure.step-start=imperative@4",
      "procedure.step-start=imperative@5",
      "procedure.step-end-punct=period@3",
      "procedure.step-end-punct=period@4",
      "procedure.step-end-punct=period@5",
      "procedure.intro=heading@1",
    ]);
  });

  it("doc C: a nested list has no intro", () => {
    expect(byDimension(answers(DOC_C))).toEqual([
      "procedure.numbering=sequential@3",
      "procedure.numbering=sequential@6",
      "procedure.step-start=imperative@3",
      "procedure.step-start=other@4",
      "procedure.step-start=imperative@5",
      "procedure.step-start=imperative@6",
      "procedure.step-start=imperative@7",
      "procedure.step-end-punct=period@3",
      "procedure.step-end-punct=period@4",
      "procedure.step-end-punct=none@5",
      "procedure.step-end-punct=period@6",
      "procedure.step-end-punct=period@7",
      "procedure.intro=colon@1",
    ]);
  });

  it("doc D: a one-item list has no numbering; the ignored list gives nothing", () => {
    expect(byDimension(answers(DOC_D))).toEqual([
      "procedure.step-start=imperative@1",
      "procedure.step-end-punct=period@1",
    ]);
  });

  it("doc E: a list inside an MDX element gives nothing", () => {
    expect(
      answers("<Tabs>\n\n1. Open it.\n2. Close it.\n\n</Tabs>\n", "mdx"),
    ).toEqual([]);
  });

  it("doc F: numbers that skip give no numbering", () => {
    expect(
      byDimension(answers("1. Open the file.\n3. Save the file.\n")),
    ).toEqual([
      "procedure.step-start=imperative@1",
      "procedure.step-start=imperative@2",
      "procedure.step-end-punct=period@1",
      "procedure.step-end-punct=period@2",
    ]);
  });

  it("doc A through the built-in list gives the same procedure answers", () => {
    expect(byDimension(answers(DOC_A, "markdown", true))).toEqual(EXPECTED_A);
  });
});
