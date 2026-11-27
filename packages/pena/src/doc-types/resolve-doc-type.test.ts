import { describe, expect, it } from "vitest";
import type { FrontmatterData } from "../markdown/frontmatter-data.js";
import { GlobError } from "../globs/glob.js";
import { createDocTypeResolver } from "./resolve-doc-type.js";
import type { DocTypeResolver } from "./resolve-doc-type.js";

function frontmatter(fields: Record<string, string>): FrontmatterData {
  return {
    format: "yaml",
    fields: new Map(Object.entries(fields)),
    warnings: [],
  };
}

function resolver(
  options: {
    include?: readonly string[];
    frontmatterKey?: string;
    rules?: readonly { type: string; include: readonly string[] }[];
  } = {},
): DocTypeResolver {
  return createDocTypeResolver({
    include: options.include ?? ["**/*.md"],
    docTypes: {
      frontmatterKey: options.frontmatterKey,
      rules: options.rules ?? [],
    },
  });
}

describe("frontmatter", () => {
  const withKey = resolver({
    frontmatterKey: "type",
    rules: [{ type: "Rule", include: ["**"] }],
  });

  it("beats rules and keeps the case", () => {
    expect(withKey.resolve("a/b.md", frontmatter({ type: "How To" }))).toEqual({
      from: "frontmatter",
      type: "How To",
    });
  });

  it("uses a trimmed value", () => {
    expect(
      withKey.resolve("a/b.md", frontmatter({ type: "  Guide \n" })),
    ).toEqual({ from: "frontmatter", type: "Guide" });
  });

  it.each(["", "   ", "bad/name", "_x", "A".repeat(65)])(
    "falls through for %j",
    (value) => {
      expect(withKey.resolve("a/b.md", frontmatter({ type: value }))).toEqual({
        from: "rule",
        type: "Rule",
        rule: 0,
      });
    },
  );

  it("falls through when the field is missing", () => {
    expect(withKey.resolve("a/b.md", frontmatter({ other: "x" })).from).toBe(
      "rule",
    );
  });

  it("is ignored when frontmatterKey is unset", () => {
    const off = resolver({ rules: [{ type: "Rule", include: ["**"] }] });
    expect(off.resolve("a/b.md", frontmatter({ type: "Guide" })).from).toBe(
      "rule",
    );
  });

  it("handles undefined frontmatter", () => {
    expect(withKey.resolve("a/b.md", undefined).from).toBe("rule");
  });
});

describe("rules", () => {
  const rules = resolver({
    rules: [
      { type: "Ref", include: ["ref/**", "api/**"] },
      { type: "Guide", include: ["**/guide*.md"] },
      { type: "Late", include: ["ref/**"] },
    ],
  });

  it("the first matching rule wins and reports its index", () => {
    expect(rules.resolve("ref/guide.md", undefined)).toEqual({
      from: "rule",
      type: "Ref",
      rule: 0,
    });
    expect(rules.resolve("x/guide-1.md", undefined)).toEqual({
      from: "rule",
      type: "Guide",
      rule: 1,
    });
  });

  it("any include pattern of a rule can match", () => {
    expect(rules.resolve("api/a.md", undefined)).toEqual({
      from: "rule",
      type: "Ref",
      rule: 0,
    });
  });

  it("beats the folder", () => {
    expect(rules.resolve("ref/a.md", undefined).from).toBe("rule");
  });
});

describe("folder", () => {
  it("is the first folder after the docs root", () => {
    const r = resolver({ include: ["docs/**/*.md"] });
    expect(r.resolve("docs/guides/x/a.md", undefined)).toEqual({
      from: "folder",
      type: "guides",
    });
  });

  it("is the first folder of the path when the root is the repo", () => {
    expect(resolver().resolve("guides/a.md", undefined)).toEqual({
      from: "folder",
      type: "guides",
    });
  });

  it("is none for a doc directly in the docs root", () => {
    expect(
      resolver({ include: ["docs/**/*.md"] }).resolve("docs/a.md", undefined),
    ).toEqual({ from: "none" });
    expect(resolver().resolve("a.md", undefined)).toEqual({ from: "none" });
  });

  it("is none when no include pattern matches", () => {
    expect(
      resolver({ include: ["docs/**/*.md"] }).resolve("src/a/b.md", undefined),
    ).toEqual({ from: "none" });
  });

  it("the first matching include pattern decides the docs root", () => {
    const r = resolver({ include: ["site/content/**/*.md", "site/**/*.md"] });
    expect(r.resolve("site/content/blog/a.md", undefined)).toEqual({
      from: "folder",
      type: "blog",
    });
    expect(r.resolve("site/other/a.md", undefined)).toEqual({
      from: "folder",
      type: "other",
    });
    const reversed = resolver({
      include: ["site/**/*.md", "site/content/**/*.md"],
    });
    expect(reversed.resolve("site/content/blog/a.md", undefined)).toEqual({
      from: "folder",
      type: "content",
    });
  });

  it("does not try later patterns when the first gives no folder", () => {
    const r = resolver({ include: ["docs/*.md", "**/*.md"] });
    expect(r.resolve("docs/a.md", undefined)).toEqual({ from: "none" });
  });
});

describe("results and errors", () => {
  it("returns frozen objects", () => {
    const r = resolver({
      frontmatterKey: "type",
      rules: [{ type: "R", include: ["r/**"] }],
    });
    expect(
      Object.isFrozen(r.resolve("a/b.md", frontmatter({ type: "T" }))),
    ).toBe(true);
    expect(Object.isFrozen(r.resolve("r/b.md", undefined))).toBe(true);
    expect(Object.isFrozen(r.resolve("a/b.md", undefined))).toBe(true);
    expect(Object.isFrozen(r.resolve("b.md", undefined))).toBe(true);
  });

  it("throws GlobError for an unsupported pattern", () => {
    expect(() => resolver({ include: ["+(a)"] })).toThrow(GlobError);
    expect(() =>
      resolver({ rules: [{ type: "A", include: ["[z-a]"] }] }),
    ).toThrow(GlobError);
  });
});
