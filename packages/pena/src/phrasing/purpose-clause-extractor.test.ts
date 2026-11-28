import { describe, expect, it } from "vitest";
import { createExtractorRegistry } from "../extract/registry.js";
import { runExtractors } from "../extract/run-extractors.js";
import { prepareDoc } from "../prepare/prepare-doc.js";
import { createPurposeClauseExtractor } from "./purpose-clause-extractor.js";
import { createBuiltInExtractors } from "../extract/built-in-extractors.js";

function run(text: string) {
  const doc = prepareDoc(text, "markdown");
  if (doc.kind !== "prepared") {
    throw new Error("expected a prepared doc");
  }
  return runExtractors(
    createExtractorRegistry([createPurposeClauseExtractor()]),
    doc,
  );
}

describe("createPurposeClauseExtractor", () => {
  it("has the right id and scope", () => {
    const extractor = createPurposeClauseExtractor();
    expect(extractor.id).toBe("phrasing.purpose-clause");
    expect(extractor.scope).toBe("sentence");
    expect(extractor.blockKinds).toEqual(["paragraph", "tableCell"]);
  });

  it("records nothing for a heading, and start for the same paragraph", () => {
    const text = "To install the agent, run the installer";
    const heading = run("## " + text + "\n");
    expect(heading.problems).toEqual([]);
    expect(heading.observations).toEqual([]);
    const paragraph = run(text + "\n");
    expect(paragraph.problems).toEqual([]);
    expect(paragraph.observations).toHaveLength(1);
    expect(paragraph.observations[0]).toMatchObject({
      dimension: "phrasing.purpose-clause",
      value: "start",
      text: "To install the agent, run the installer",
    });
  });

  it("finds a start clause in a table cell", () => {
    const result = run(
      "| Step | Action |\n| --- | --- |\n| 1 | To unset the value, use an empty string. |\n",
    );
    expect(result.problems).toEqual([]);
    expect(result.observations.map((o) => o.value)).toEqual(["start"]);
  });

  it("gives each sentence its own finding with its line and range", () => {
    const text =
      "To get the IP address, run the command.\nRun the command to get the IP address.\n";
    const result = run(text);
    expect(result.problems).toEqual([]);
    const clauses = result.observations.map((o) => [
      o.value,
      o.line,
      text.slice(o.range.start, o.range.end),
    ]);
    expect(clauses).toEqual([
      ["start", 1, "To get the IP address"],
      ["end", 2, "to get the IP address"],
    ]);
  });

  // Sentences without the word "to" are never tagged: tagging is the costly
  // step and no purpose clause exists without "to".
  it("finds nothing when no sentence has the word to", () => {
    const result = run("Run the command. Select Save. Tomorrow is fine.\n");
    expect(result.problems).toEqual([]);
    expect(result.observations).toEqual([]);
  });

  it("is in the built-in list", () => {
    const extractors = createBuiltInExtractors({ groups: [] });
    expect(extractors.map((extractor) => extractor.id)).toContain(
      "phrasing.purpose-clause",
    );
  });
});
