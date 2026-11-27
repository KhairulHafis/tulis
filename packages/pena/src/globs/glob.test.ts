import { describe, expect, it } from "vitest";
import { DEFAULT_EXCLUDES } from "../config/config-defaults.js";
import { GlobError, compileGlob, findGlobProblem } from "./glob.js";

const CASES: readonly (readonly [string, string, boolean])[] = [
  ["docs/**", "docs", true],
  ["docs/**", "docs/x/y.md", true],
  ["**/*.md", "a.md", true],
  ["**/*.md", ".hidden/a.md", true],
  ["*.md", ".md", true],
  ["**/.github/**", ".github/x.md", true],
  ["**/vendor/**", "vendor/a.md", true],
  ["**/vendor/**", "a/vendor", true],
  ["docs/a**b.md", "docs/axyb.md", true],
  ["docs/a**b.md", "docs/ax/yb.md", false],
  ["a/**/b", "a/b", true],
  ["a/**/b", "a/x/y/b", true],
  ["**", "a/b/c", true],
  ["**", "", false],
  ["docs/", "docs/a.md", false],
  ["{docs,content/en}/**/*.md", "content/en/x/a.md", true],
  ["[abc].md", "b.md", true],
  ["[!abc].md", "d.md", true],
  ["[^abc].md", "a.md", false],
  ["[a-c].md", "/.md", false],
  ["x/[a/b].md", "x/[a/b].md", true],
  ["[abc.md", "[abc.md", true],
  ["{abc}.md", "{abc}.md", true],
  ["{a,b.md", "{a,b.md", true],
  ["a/{b,c/d}/e", "a/c/d/e", true],
  ["(a|b).md", "(a|b).md", true],
  ["(a|b).md", "a.md", false],
  ["?.md", "a.md", true],
  ["?.md", "/.md", false],
  ["docs/*", "docs/a/b", false],
  ["*", "a/b", false],
  ["{,x/}a.md", "a.md", true],
  ["{,x/}a.md", "x/a.md", true],
  ["a{b,{c,d}}e", "ade", true],
  ["[]a].md", "].md", true],
  ["[a-]x", "-x", true],
  ["**/{README,CHANGELOG}.{md,mdx}", "README.mdx", true],
  ["a.md", "A.md", false],
  ["**/*.md", "a/b.MD", false],
  ["**a", "xa", true],
  ["**a", "x/a", false],
  // More shapes of the same rules.
  ["**/*.md", "x/y/a.md", true],
  ["**/*.md", "a.mdx", false],
  ["a/**/b", "a/xb", false],
  ["a/**/b", "ab", false],
  ["docs/**", "docsx", false],
  ["docs/**", "docs/", true],
  ["**/a/**", "x/a/y", true],
  ["**/a/**", "x/ab/y", false],
  ["[a-c]", "b", true],
  ["[a-c]", "d", false],
  ["[a-]x", "ax", true],
  ["[a-]x", "bx", false],
  ["{a,b}", "b", true],
  ["{a,b}", "c", false],
  ["{a,{b}}", "a", true],
  ["{a,{b}}", "{b}", true],
  ["a{b,c}d", "acd", true],
  ["a?c", "a" + String.fromCodePoint(0xe9) + "c", true],
  ["a?c", "a" + String.fromCodePoint(0x1f600) + "c", true],
  ["a**/b", "ax/b", true],
  ["a**/b", "ax/y/b", false],
  ["***/a", "x/y/a", false],
  ["***/a", "x/a", true],
  ["a/{**,x}", "a/b/c", true],
];

describe("compileGlob matching", () => {
  it.each(CASES)("%s against %j is %s", (glob, path, expected) => {
    expect(compileGlob(glob).matches(path)).toBe(expected);
  });

  it("keeps the pattern text", () => {
    expect(compileGlob("a/*.md").glob).toBe("a/*.md");
  });

  it("returns a frozen object", () => {
    expect(Object.isFrozen(compileGlob("a"))).toBe(true);
  });

  it("can match many paths with one compiled pattern", () => {
    const glob = compileGlob("docs/**/*.md");
    expect(glob.matches("docs/a.md")).toBe(true);
    expect(glob.matches("docs/x/a.md")).toBe(true);
    expect(glob.matches("other/a.md")).toBe(false);
    expect(glob.matches("docs/a.md")).toBe(true);
  });
});

describe("base", () => {
  it.each([
    ["content/en/docs/**/*.md", "content/en/docs/"],
    ["docs/*.md", "docs/"],
    ["docs/guide.md", "docs/"],
    ["docs/**", "docs/"],
    ["a/b/c?.md", "a/b/"],
    ["**/*.md", ""],
    ["*.md", ""],
    ["{a,b}/x.md", ""],
    ["a{b,c}/x.md", ""],
    ["guide.md", ""],
  ])("%s has base %j", (glob, base) => {
    expect(compileGlob(glob).base).toBe(base);
  });
});

describe("unsupported syntax", () => {
  it.each([
    ["*(a|b)", "extended-pattern"],
    ["a/?(b)", "extended-pattern"],
    ["a/+(b|c).md", "extended-pattern"],
    ["@(a|b).md", "extended-pattern"],
    ["a!(b).md", "extended-pattern"],
    ["**(a)", "extended-pattern"],
    ["{x,+(a)}", "extended-pattern"],
    ["[[:alpha:]].md", "posix-class"],
    ["[a[:digit:]]", "posix-class"],
    ["[z-a].md", "reversed-range"],
    ["[!z-a]", "reversed-range"],
    ["{a,[9-0]}", "reversed-range"],
  ] as const)("%s is a %s problem", (glob, problem) => {
    expect(findGlobProblem(glob)).toBe(problem);
    try {
      compileGlob(glob);
      expect.unreachable("compileGlob should throw");
    } catch (error) {
      expect(error).toBeInstanceOf(GlobError);
      expect(error instanceof GlobError && error.problem).toBe(problem);
    }
  });

  it.each([
    "a.md",
    "(a|b).md",
    "a!b",
    "!",
    "a+b",
    "[+(]",
    "[a-a]",
    "[:a]",
    "[a:]",
    "docs/**/*.{md,mdx}",
    "a@b",
    "[z-a",
  ])("%s is supported", (glob) => {
    expect(findGlobProblem(glob)).toBeUndefined();
    expect(() => compileGlob(glob)).not.toThrow();
  });

  it("does not put the pattern in the error message", () => {
    expect(() => compileGlob("secret/+(a)")).toThrow(
      expect.objectContaining({
        message: expect.not.stringContaining("secret") as unknown,
      }) as Error,
    );
  });
});

describe("DEFAULT_EXCLUDES", () => {
  const compiled = DEFAULT_EXCLUDES.map((glob) => compileGlob(glob));
  const excluded = (path: string): boolean =>
    compiled.some((glob) => glob.matches(path));

  it("compiles every default pattern", () => {
    expect(compiled).toHaveLength(DEFAULT_EXCLUDES.length);
  });

  it.each([
    "content/ja/docs/a.md",
    "doc-locale/ja-jp/a.md",
    "content/zh-hans/a.md",
    ".github/a.md",
    "x/README.md",
  ])("excludes %s", (path) => {
    expect(excluded(path)).toBe(true);
  });

  it.each(["doc/ci/a.md", "doc/ee/a.md", "content/en/a.md"])(
    "keeps %s",
    (path) => {
      expect(excluded(path)).toBe(false);
    },
  );
});
