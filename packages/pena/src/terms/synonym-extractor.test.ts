import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import type { VariantGroup } from "../config/variants-types.js";
import { createExtractorRegistry } from "../extract/registry.js";
import { runExtractors } from "../extract/run-extractors.js";
import { prepareDoc, type PreparedDoc } from "../prepare/prepare-doc.js";
import { createSynonymExtractor } from "./synonym-extractor.js";
import { parseSeedGroups } from "./seed-groups.js";

const fixtureGroups = parseSeedGroups(
  readFileSync(new URL("./fixtures/test-seeds.yaml", import.meta.url), "utf8"),
);

function prepared(text: string): PreparedDoc {
  const doc = prepareDoc(text, "markdown");
  if (doc.kind !== "prepared") {
    throw new Error("expected a prepared doc");
  }
  return doc;
}

function run(text: string, groups: readonly VariantGroup[] = fixtureGroups) {
  const doc = prepared(text);
  const result = runExtractors(
    createExtractorRegistry([createSynonymExtractor(groups)]),
    doc,
  );
  return {
    problems: result.problems,
    pairs: result.observations.map((observation) => [
      observation.dimension,
      observation.value,
      doc.parsed.source.slice(observation.range.start, observation.range.end),
    ]),
    dimensions: result.observations.map((observation) => observation.dimension),
  };
}

describe("term.synonyms extractor", () => {
  it("finds every group's words in one doc", () => {
    const paragraphs = [
      "Log in to the console.",
      "Then sign-in again, or Sign In from the menu.",
      "Use the login page.",
      "After you logged in, click **Save**.",
      "She signed-in yesterday and chose a plan.",
      "Logging on takes a second.",
      "Pick a region, e.g. `us-east`, for example in the wizard.",
      "Create two API tokens and one access-token.",
      "Run `log in` and see [sign in](x.md).",
      "## Choosing a plan",
      "Selection is clicked often.",
      "Don't login-ify the log, then in.",
    ];
    const result = run(paragraphs.join("\n\n") + "\n");
    expect(result.problems).toEqual([]);
    expect(result.pairs).toEqual([
      ["term.sign-in", "log in", "Log in"],
      ["term.sign-in", "sign-in", "sign-in"],
      ["term.sign-in", "sign in", "Sign In"],
      ["term.sign-in", "login", "login"],
      ["term.sign-in", "log in", "logged in"],
      ["term.select", "click", "click"],
      ["term.sign-in", "sign-in", "signed-in"],
      ["term.select", "choose", "chose"],
      ["term.sign-in", "log on", "Logging on"],
      ["term.for-example", "e.g.", "e.g."],
      ["term.for-example", "for example", "for example"],
      ["term.access-token", "api token", "API tokens"],
      ["term.access-token", "access-token", "access-token"],
      ["term.sign-in", "sign in", "sign in"],
      ["term.select", "choose", "Choosing"],
      ["term.select", "click", "clicked"],
    ]);
  });

  it("ignores verb-noun groups", () => {
    const result = run("Use the login form to log in.\n");
    expect(result.dimensions).not.toContain("term.login-form");
  });

  it("reports a word in two groups for both", () => {
    const groups: VariantGroup[] = [
      ...fixtureGroups,
      {
        id: "enter",
        kind: "synonym",
        variants: ["log in", "enter"],
        source: "team",
      },
    ];
    const result = run("Log in now.\n", groups);
    expect([...result.dimensions].sort()).toEqual([
      "term.enter",
      "term.sign-in",
    ]);
  });

  it("has the id term.synonyms and runs on every block kind", () => {
    const extractor = createSynonymExtractor(fixtureGroups);
    expect(extractor.id).toBe("term.synonyms");
    expect(extractor.scope).toBe("sentence");
    expect(
      run("| a |\n| - |\n| log in |\n").pairs.map((pair) => pair[1]),
    ).toEqual(["log in"]);
  });

  it("finds nothing with no groups", () => {
    expect(run("Log in.\n", []).pairs).toEqual([]);
  });
});
