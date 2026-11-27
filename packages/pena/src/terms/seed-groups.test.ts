import { readFileSync } from "node:fs";
import { MAX_VARIANTS_BYTES } from "../config/load-variants.js";
import { describe, expect, it } from "vitest";
import {
  SeedListError,
  loadSeedGroups,
  parseSeedGroups,
} from "./seed-groups.js";

const PREFIX = "The built-in seed list is invalid: ";
const fixture = readFileSync(
  new URL("./fixtures/test-seeds.yaml", import.meta.url),
  "utf8",
);

function problem(text: string): string {
  try {
    parseSeedGroups(text);
  } catch (error) {
    if (error instanceof SeedListError) {
      return error.message;
    }
    throw error;
  }
  throw new Error("expected SeedListError");
}

describe("loadSeedGroups", () => {
  it("loads the shipped file as an empty frozen array", async () => {
    const groups = await loadSeedGroups();
    expect(groups).toEqual([]);
    expect(Object.isFrozen(groups)).toBe(true);
  });
});

describe("parseSeedGroups", () => {
  it("returns the fixture groups in order with source seed", () => {
    const groups = parseSeedGroups(fixture);
    expect(groups.map((g) => g.id)).toEqual([
      "sign-in",
      "select",
      "for-example",
      "access-token",
      "login-form",
    ]);
    expect(groups.every((g) => g.source === "seed")).toBe(true);
    expect(groups[3]).toEqual({
      id: "access-token",
      kind: "synonym",
      variants: ["access token", "API token"],
      source: "seed",
    });
    expect(groups[4]).toEqual({
      id: "login-form",
      kind: "verb-noun",
      noun: "login",
      verb: "log in",
      source: "seed",
    });
    expect(Object.isFrozen(groups)).toBe(true);
    for (const group of groups) {
      expect(Object.isFrozen(group)).toBe(true);
    }
  });

  it("throws for bad YAML and keeps the cause", () => {
    let thrown: unknown;
    try {
      parseSeedGroups("groups: [");
    } catch (error) {
      thrown = error;
    }
    if (!(thrown instanceof SeedListError)) {
      throw new Error("expected SeedListError");
    }
    expect(thrown.name).toBe("SeedListError");
    expect(thrown.cause).toBeInstanceOf(Error);
    expect(thrown.message).toContain(PREFIX + "line 1: Not valid YAML");
  });

  const cases: [string, string][] = [
    [
      "a bad id",
      'version: 1\ngroups:\n  - id: Bad_Id\n    kind: synonym\n    variants: ["a", "b"]\n',
    ],
    [
      "an unknown key",
      'version: 1\nextra: 1\ngroups:\n  - id: ok\n    kind: synonym\n    variants: ["a", "b"]\n',
    ],
    ["a missing version", "groups: []\n"],
    ["version 2", "version: 2\ngroups: []\n"],
    [
      "a rejected entry",
      'version: 1\ngroups: []\nrejected:\n  - variants: ["a", "b"]\n',
    ],
    [
      "a disabled entry",
      "version: 1\ngroups:\n  - id: ok\n    enabled: false\n",
    ],
    [
      "source seed",
      'version: 1\ngroups:\n  - id: ok\n    kind: synonym\n    variants: ["a", "b"]\n    source: seed\n',
    ],
    [
      "source discovered",
      'version: 1\ngroups:\n  - id: ok\n    kind: synonym\n    variants: ["a", "b"]\n    source: discovered\n',
    ],
  ];
  it.each(cases)("throws for %s", (_name, text) => {
    expect(problem(text).startsWith(PREFIX)).toBe(true);
  });

  it("names the key and line of the first problem", () => {
    const message = problem(
      'version: 1\ngroups:\n  - id: Bad_Id\n    kind: synonym\n    variants: ["a", "b"]\n',
    );
    expect(message).toContain("groups[1].id");
    expect(message).toContain("line 3");
  });

  it("refuses text larger than the team variants limit", () => {
    const text = `version: 1\ngroups: []\n# ${"x".repeat(MAX_VARIANTS_BYTES)}\n`;
    expect(problem(text)).toContain("larger than the limit");
  });

  it("adds the count of further problems", () => {
    const message = problem("version: 2\nextra: 1\ngroups: []\n");
    expect(message).toMatch(/ \(and 1 more\)$/);
  });
});
