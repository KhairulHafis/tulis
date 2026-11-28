import { describe, expect, it } from "vitest";
import type { Token } from "../language/tokens.js";
import { prepareDoc } from "../prepare/prepare-doc.js";
import { headingCase, type HeadingCase } from "./heading-case.js";

function tokensOf(heading: string): readonly Token[] {
  const result = prepareDoc("## " + heading + "\n", "markdown");
  if (result.kind !== "prepared") throw new Error("not prepared");
  const sentence = result.blocks[0]?.sentences[0];
  if (sentence === undefined) throw new Error("no sentence");
  return sentence.tokens;
}

function caseOfHeading(heading: string): HeadingCase | undefined {
  return headingCase(tokensOf(heading));
}

const ACCEPTANCE: readonly (readonly [string, HeadingCase | undefined])[] = [
  ["Install the agent", "sentence"],
  ["Install the Agent", "title"],
  ["Overview", undefined],
  ["Getting started", "sentence"],
  ["Getting Started", "title"],
  ["Install API", undefined],
  ["API reference", undefined],
  ["Configure the API Server", "title"],
  ["Use `kubectl` to manage Pods", "sentence"],
  ["Using Secrets as files from a Pod", "sentence"],
  ["Working with Secrets", "title"],
  ["Tutorial: Deploy an app", "sentence"],
  ["Tutorial: Deploy", undefined],
  ["Step 3. Add the secondary site", "sentence"],
  ["Step 3: Add The Secondary Site", "title"],
  ["Option 2 - Use the `token` command line argument", "sentence"],
  ["Introduction (Beta)", undefined],
  ["Install the agent (optional)", "sentence"],
  ["What is a Pod?", "sentence"],
  ["Node.js and iOS support", undefined],
  ["Upgrade to v1.2 or later", "sentence"],
  ["Plan A for the Rollout", "title"],
  ["`kubectl` commands", undefined],
  ["Built-in Roles", "title"],
  ["Set-Up And Clean-Up", "title"],
  ["Don't use root", "sentence"],
  ["CI/CD variables", undefined],
  ["`kubectl`", undefined],
];

describe("headingCase acceptance table", () => {
  for (const [heading, expected] of ACCEPTANCE) {
    it(heading + " -> " + String(expected), () => {
      expect(caseOfHeading(heading)).toBe(expected);
    });
  }
});

describe("headingCase skip rules", () => {
  it("returns undefined for no tokens", () => {
    expect(headingCase([])).toBeUndefined();
  });

  it("skips a word with a digit", () => {
    expect(caseOfHeading("Plan Rollout2 Now")).toBe("title");
    expect(caseOfHeading("Plan rollout2 Now")).toBe("title");
    expect(caseOfHeading("Plan Now x2y")).toBe("title");
    expect(caseOfHeading("Plan v2go go")).toBe("sentence");
    expect(caseOfHeading("Plan abc1")).toBeUndefined();
  });

  it("skips single letters", () => {
    expect(caseOfHeading("Plan x")).toBeUndefined();
    expect(caseOfHeading("Plan X")).toBeUndefined();
  });

  it("skips words with a dot or underscore", () => {
    expect(caseOfHeading("Plan foo.bar")).toBeUndefined();
    expect(caseOfHeading("Plan foo_bar")).toBeUndefined();
    expect(caseOfHeading("Plan Foo.Bar")).toBeUndefined();
  });

  it("skips a word with an inner capital", () => {
    expect(caseOfHeading("Plan GitLab")).toBeUndefined();
    expect(caseOfHeading("Plan iOS")).toBeUndefined();
    expect(caseOfHeading("Plan API")).toBeUndefined();
    expect(caseOfHeading("Plan pre-fooBar")).toBeUndefined();
    expect(caseOfHeading("Plan Set-Up")).toBe("title");
  });

  it("skips a word whose first character has no case", () => {
    expect(caseOfHeading("Plan 日本語")).toBeUndefined();
    expect(caseOfHeading("Plan 日本語 later")).toBe("sentence");
  });

  it("skips minor words in any case", () => {
    expect(caseOfHeading("Plan of")).toBeUndefined();
    expect(caseOfHeading("Plan Of The")).toBeUndefined();
    expect(caseOfHeading("Plan VIA")).toBeUndefined();
    expect(caseOfHeading("Plan versus")).toBeUndefined();
  });

  it("ignores placeholders and numbers as start words", () => {
    expect(caseOfHeading("{CODE} commands")).toBeUndefined();
    expect(caseOfHeading("`a` Commands Tools")).toBe("title");
  });

  it("starts a new phrase after each separator", () => {
    // The word after the separator is a start word, so nothing decides.
    for (const sep of [":", ".", "?", "!", "(", " -", " \u2013", " \u2014"]) {
      expect(caseOfHeading("Plan" + sep + " Deploy")).toBeUndefined();
    }
    expect(caseOfHeading("Plan, Deploy")).toBe("title");
  });

  it("does not start a phrase after other punctuation", () => {
    expect(caseOfHeading("Plan, Deploy")).toBe("title");
    expect(caseOfHeading("Plan; deploy")).toBe("sentence");
  });

  it("a lowercase deciding word wins over capitals", () => {
    expect(caseOfHeading("Plan Deploy apps")).toBe("sentence");
  });

  it("counts words after an uncountable first word", () => {
    expect(caseOfHeading("API server settings")).toBe("sentence");
  });
});

const NAMES: ReadonlySet<string> = new Set([
  "datadog",
  "kubernetes",
  "praefect",
  "windows",
]);

const PROPER_NOUN_TABLE: readonly (readonly [
  string,
  HeadingCase | undefined,
  HeadingCase | undefined,
])[] = [
  ["Disable Datadog", "title", undefined],
  ["Extending Kubernetes", "title", undefined],
  ["Configure Datadog Monitoring", "title", "title"],
  ["Praefect migrations", "sentence", "sentence"],
  ["Use datadog", "sentence", "sentence"],
  ["Windows Support For Datadog", "title", "title"],
  ["Disable Datadog’s Agent", "title", "title"],
  ["Disable Datadog’s", "title", undefined],
  ["Install Datadog: Quick Start", "title", "title"],
];

describe("headingCase with proper nouns", () => {
  for (const [heading, without, withSet] of PROPER_NOUN_TABLE) {
    it(heading + " without the set", () => {
      expect(headingCase(tokensOf(heading))).toBe(without);
    });
    it(heading + " with the set", () => {
      expect(headingCase(tokensOf(heading), NAMES)).toBe(withSet);
    });
    it(heading + " with an empty set", () => {
      expect(headingCase(tokensOf(heading), new Set())).toBe(without);
    });
  }
});
