import { describe, expect, it } from "vitest";
import { isCheckId } from "../check-id.js";
import { LANGUAGE_GROUPS, languageGroup } from "./language-groups.js";

describe("LANGUAGE_GROUPS", () => {
  it("has group ids that are valid check ID parts", () => {
    for (const group of LANGUAGE_GROUPS) {
      expect(isCheckId(`code.lang-name.${group.id}`)).toBe(true);
    }
  });

  it("puts no name in two groups, and names are lower case", () => {
    const seen = new Set<string>();
    for (const group of LANGUAGE_GROUPS) {
      for (const name of group.names) {
        expect(seen.has(name)).toBe(false);
        expect(name).toBe(name.toLowerCase());
        seen.add(name);
      }
    }
    expect(LANGUAGE_GROUPS).toHaveLength(16);
  });
});

describe("languageGroup", () => {
  it("finds every name in the table", () => {
    for (const group of LANGUAGE_GROUPS) {
      for (const name of group.names) {
        expect(languageGroup(name)).toBe(group.id);
      }
    }
  });

  it("ignores case", () => {
    expect(languageGroup("Bash")).toBe("shell");
    expect(languageGroup("YML")).toBe("yaml");
    expect(languageGroup("C#")).toBe("csharp");
  });

  it("returns undefined for unknown names", () => {
    expect(languageGroup("json")).toBeUndefined();
    expect(languageGroup("")).toBeUndefined();
    expect(languageGroup(" bash")).toBeUndefined();
  });

  it("does not look up object prototype members", () => {
    expect(languageGroup("constructor")).toBeUndefined();
    expect(languageGroup("__proto__")).toBeUndefined();
    expect(languageGroup("toString")).toBeUndefined();
    expect(languageGroup("hasOwnProperty")).toBeUndefined();
  });
});
