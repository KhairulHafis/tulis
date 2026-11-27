import { describe, expect, it } from "vitest";
import { checkVariants, rejectedKey } from "./check-variants.js";
import type { VariantsCheckResult } from "./check-variants.js";
import { MAX_ISSUES } from "./issue-collector.js";
import type { ConfigPath } from "./config-types.js";
import { EMPTY_TEAM_VARIANTS } from "./variants-types.js";

const VERSION_WARNING =
  "No version line, so the file is read as version 1. Add `version: 1` at the top.";
const WORD_TEXT =
  "must be a word or phrase of 1 to 100 characters, without control or text-direction characters.";

function run(
  value: unknown,
  lines: Readonly<Record<string, number>> = {},
): VariantsCheckResult {
  const lineOf = (path: ConfigPath): number | undefined =>
    Object.hasOwn(lines, path.join(".")) ? lines[path.join(".")] : undefined;
  return checkVariants(value, lineOf);
}

function runWith(extra: Record<string, unknown>): VariantsCheckResult {
  return run({ version: 1, ...extra });
}

function groups(...entries: unknown[]): VariantsCheckResult {
  return runWith({ groups: entries });
}

function onlyError(result: VariantsCheckResult): {
  key: string;
  line: number | undefined;
  message: string;
} {
  expect(result.warnings).toEqual([]);
  expect(result.errors).toHaveLength(1);
  const [issue] = result.errors;
  if (issue === undefined) {
    throw new Error("no issue");
  }
  return issue;
}

const SIGN_IN = {
  id: "sign-in",
  kind: "synonym",
  variants: ["log in", "sign in"],
};

describe("the example file", () => {
  it("gives the expected team variants", () => {
    const result = run({
      version: 1,
      groups: [
        SIGN_IN,
        {
          id: "click-select",
          kind: "synonym",
          variants: ["click", "select"],
          source: "discovered",
        },
        { id: "form", kind: "verb-noun", noun: "login", verb: "log in" },
        { id: "login-form", enabled: false },
      ],
      rejected: [{ variants: ["open", "close"] }],
    });
    expect(result.errors).toEqual([]);
    expect(result.warnings).toEqual([]);
    expect(result.fileVersion).toBe(1);
    expect(result.variants).toEqual({
      groups: [
        {
          id: "sign-in",
          kind: "synonym",
          variants: ["log in", "sign in"],
          source: "team",
        },
        {
          id: "click-select",
          kind: "synonym",
          variants: ["click", "select"],
          source: "discovered",
        },
        {
          id: "form",
          kind: "verb-noun",
          noun: "login",
          verb: "log in",
          source: "team",
        },
      ],
      disabled: ["login-form"],
      rejected: [{ variants: ["open", "close"] }],
    });
    expect(Object.isFrozen(result.variants)).toBe(true);
    expect(Object.isFrozen(result.variants.groups)).toBe(true);
    expect(Object.isFrozen(result.variants.groups[0])).toBe(true);
  });
});

describe("top level and version", () => {
  it("an empty file gives no issues at all", () => {
    const result = checkVariants(null);
    expect(result.variants).toBe(EMPTY_TEAM_VARIANTS);
    expect(result.errors).toEqual([]);
    expect(result.warnings).toEqual([]);
    expect(result.fileVersion).toBeUndefined();
  });

  it("a map without a version warns", () => {
    const result = run({ groups: [] });
    expect(result.errors).toEqual([]);
    expect(result.warnings).toEqual([
      { key: "version", line: undefined, message: VERSION_WARNING },
    ]);
  });

  it("version 1 is clean", () => {
    const result = run({ version: 1 });
    expect(result.warnings).toEqual([]);
    expect(result.fileVersion).toBe(1);
  });

  it("a newer version is reported through fileVersion", () => {
    const result = run({ version: 2, groups: [SIGN_IN, { id: "Bad" }] });
    expect(result.fileVersion).toBe(2);
    expect(result.variants.groups).toHaveLength(1);
  });

  it.each([["1"], [0], [1.5], [true]])("version %j is an error", (version) => {
    const issue = onlyError(run({ version }));
    expect(issue.key).toBe("version");
    expect(checkVariants({ version }).fileVersion).toBeUndefined();
  });

  it.each([[[1, 2]], ["text"], [5]])("top level %j is one error", (value) => {
    const result = checkVariants(value);
    expect(result.errors).toHaveLength(1);
    expect(result.variants).toBe(EMPTY_TEAM_VARIANTS);
  });

  it("an unknown top-level key warns with a hint", () => {
    const result = runWith({ group: [] });
    expect(result.warnings).toEqual([
      {
        key: "group",
        line: undefined,
        message: 'Unknown key "group" is ignored. Did you mean "groups"?',
      },
    ]);
  });

  it("groups must be a list", () => {
    expect(onlyError(runWith({ groups: "x" })).key).toBe("groups");
    expect(onlyError(runWith({ rejected: {} })).key).toBe("rejected");
  });
});

describe("groups", () => {
  it("reads a synonym group and trims words", () => {
    const result = groups({
      id: "a1",
      kind: "synonym",
      variants: ["  log in ", "sign in"],
    });
    expect(result.errors).toEqual([]);
    expect(result.variants.groups[0]).toEqual({
      id: "a1",
      kind: "synonym",
      variants: ["log in", "sign in"],
      source: "team",
    });
  });

  it("an entry that is not a map is an error", () => {
    const issue = onlyError(groups("text"));
    expect(issue.key).toBe("groups[1]");
  });

  it("an id is required", () => {
    expect(
      onlyError(groups({ kind: "synonym", variants: ["a", "b"] })).key,
    ).toBe("groups[1]");
  });

  it.each([
    ["Sign-in"],
    ["sign_in"],
    ["-a"],
    ["a-"],
    ["a--b"],
    [""],
    [5],
    ["a".repeat(65)],
  ])("id %j is an error", (id) => {
    const issue = onlyError(
      groups({ id, kind: "synonym", variants: ["a", "b"] }),
    );
    expect(issue.key).toBe("groups[1].id");
    expect(issue.message).toContain("lower-case");
  });

  it("an id of 64 characters is fine", () => {
    const result = groups({
      id: "a".repeat(64),
      kind: "synonym",
      variants: ["a", "b"],
    });
    expect(result.errors).toEqual([]);
  });

  it("a duplicate id is an error naming both lines, and the duplicate is left out", () => {
    const other = { id: "sign-in", kind: "synonym", variants: ["x", "y"] };
    const result = run(
      { version: 1, groups: [SIGN_IN, other] },
      { "groups.0": 3, "groups.1.id": 8, "groups.1": 7 },
    );
    expect(result.errors).toEqual([
      {
        key: "groups[2].id",
        line: 8,
        message:
          "groups[2].id is already used by groups[1] on line 3. Each id can be used once.",
      },
    ]);
    expect(result.variants.groups).toHaveLength(1);
    expect(result.variants.groups[0]).toMatchObject({
      variants: ["log in", "sign in"],
    });
  });

  it("a duplicate id is an error even when the first is switched off", () => {
    const result = groups(
      { id: "a", enabled: false },
      { id: "a", enabled: false },
    );
    expect(result.errors).toHaveLength(1);
    expect(result.variants.disabled).toEqual(["a"]);
  });

  it("enabled: false with only an id switches the group off", () => {
    const result = groups({ id: "login-form", enabled: false });
    expect(result.errors).toEqual([]);
    expect(result.variants.disabled).toEqual(["login-form"]);
    expect(result.variants.groups).toEqual([]);
  });

  it("enabled: true needs a kind", () => {
    const issue = onlyError(groups({ id: "a", enabled: true }));
    expect(issue.message).toContain("needs a kind");
  });

  it("enabled must be a boolean", () => {
    const issue = onlyError(groups({ ...SIGN_IN, enabled: "no" }));
    expect(issue.key).toBe("groups[1].enabled");
    expect(issue.message).toBe("groups[1].enabled must be true or false.");
  });

  it("enabled: false with a bad kind still errors and leaves the entry out", () => {
    const result = groups({ id: "a", enabled: false, kind: "other" });
    expect(result.errors).toHaveLength(1);
    expect(result.errors[0]?.key).toBe("groups[1].kind");
    expect(result.variants.disabled).toEqual([]);
  });

  it("enabled: false with a bad word still errors", () => {
    const result = groups({ id: "a", enabled: false, variants: ["only"] });
    expect(result.errors).toHaveLength(1);
  });

  it("enabled: false keeps valid extra fields without adding a group", () => {
    const result = groups({ ...SIGN_IN, enabled: false });
    expect(result.errors).toEqual([]);
    expect(result.variants.groups).toEqual([]);
    expect(result.variants.disabled).toEqual(["sign-in"]);
  });

  it("kind must be synonym or verb-noun", () => {
    const issue = onlyError(
      groups({ id: "a", kind: "pair", variants: ["a", "b"] }),
    );
    expect(issue.key).toBe("groups[1].kind");
  });

  it("a synonym needs variants", () => {
    const issue = onlyError(groups({ id: "a", kind: "synonym" }));
    expect(issue.message).toBe("groups[1] needs a variants list.");
  });

  it("a synonym with a noun is an error", () => {
    const issue = onlyError(groups({ ...SIGN_IN, noun: "login" }));
    expect(issue.key).toBe("groups[1].noun");
    expect(issue.message).toContain("only for the");
  });

  it("a synonym with a verb is an error", () => {
    const issue = onlyError(groups({ ...SIGN_IN, verb: "log in" }));
    expect(issue.key).toBe("groups[1].verb");
  });

  it("a verb-noun group needs noun and verb", () => {
    const missingNoun = onlyError(
      groups({ id: "a", kind: "verb-noun", verb: "log in" }),
    );
    expect(missingNoun.message).toBe("groups[1] needs a noun.");
    const missingVerb = onlyError(
      groups({ id: "a", kind: "verb-noun", noun: "login" }),
    );
    expect(missingVerb.message).toBe("groups[1] needs a verb.");
  });

  it("a verb-noun group with variants is an error", () => {
    const issue = onlyError(
      groups({
        id: "a",
        kind: "verb-noun",
        noun: "login",
        verb: "log in",
        variants: ["a", "b"],
      }),
    );
    expect(issue.key).toBe("groups[1].variants");
  });

  it("noun and verb must differ after normalisation", () => {
    const issue = onlyError(
      groups({ id: "a", kind: "verb-noun", noun: "Login", verb: " login " }),
    );
    expect(issue.message).toBe(
      "groups[1].noun and groups[1].verb must be different words.",
    );
  });

  it("source: discovered is kept; anything else is an error", () => {
    const ok = groups({ ...SIGN_IN, source: "discovered" });
    expect(ok.variants.groups[0]).toMatchObject({ source: "discovered" });
    const issue = onlyError(groups({ ...SIGN_IN, source: "team" }));
    expect(issue.key).toBe("groups[1].source");
  });

  it("bad entries are left out and good ones kept", () => {
    const result = groups({ id: "BAD" }, SIGN_IN);
    expect(result.errors.length).toBeGreaterThan(0);
    expect(result.variants.groups).toHaveLength(1);
  });

  it("an unknown group key warns with a hint", () => {
    const result = groups({ id: "a", kind: "synonym", varients: ["a", "b"] });
    expect(result.warnings).toEqual([
      {
        key: "groups[1].varients",
        line: undefined,
        message: 'Unknown key "varients" is ignored. Did you mean "variants"?',
      },
    ]);
    expect(result.errors).toHaveLength(1);
  });

  it("more than 1000 groups is one error and keeps none", () => {
    const many = Array.from({ length: 1001 }, (_, i) => ({
      id: `g${String(i)}`,
      kind: "synonym",
      variants: ["a", "b"],
    }));
    const result = groups(...many);
    expect(result.errors).toHaveLength(1);
    expect(result.variants.groups).toEqual([]);
    expect(groups(...many.slice(0, 1000)).errors).toEqual([]);
  });
});

describe("words", () => {
  function synonym(variants: unknown): VariantsCheckResult {
    return groups({ id: "a", kind: "synonym", variants });
  }

  it("a list of 2 to 20 words is fine", () => {
    const twenty = Array.from({ length: 20 }, (_, i) => `word${String(i)}`);
    expect(synonym(["a", "b"]).errors).toEqual([]);
    expect(synonym(twenty).errors).toEqual([]);
  });

  it("21 words or 1 word is an error", () => {
    const tooMany = Array.from({ length: 21 }, (_, i) => `word${String(i)}`);
    expect(onlyError(synonym(tooMany)).message).toBe(
      "groups[1].variants must have from 2 to 20 words.",
    );
    expect(onlyError(synonym(["a"])).key).toBe("groups[1].variants");
  });

  it("variants must be a list", () => {
    expect(onlyError(synonym("a, b")).message).toBe(
      "groups[1].variants must be a list of words.",
    );
  });

  it("a word that is not a string is an error", () => {
    const issue = onlyError(synonym(["a", 5]));
    expect(issue.key).toBe("groups[1].variants[2]");
    expect(issue.message).toBe(`groups[1].variants[2] ${WORD_TEXT}`);
  });

  it("a word of 100 characters is fine, 101 is not", () => {
    expect(synonym(["a".repeat(100), "b"]).errors).toEqual([]);
    expect(onlyError(synonym(["a".repeat(101), "b"])).key).toBe(
      "groups[1].variants[1]",
    );
  });

  it("a word empty after trimming is an error", () => {
    expect(onlyError(synonym(["a", "   "])).key).toBe("groups[1].variants[2]");
    expect(onlyError(synonym(["", "a"])).key).toBe("groups[1].variants[1]");
  });

  it.each([
    ["a\u0000b"],
    ["a\tb"],
    ["a\nb"],
    ["a\u007fb"],
    ["a\u0085b"],
    ["a\u009fb"],
    ["a‎b"],
    ["a‏b"],
    ["a‪b"],
    ["a‮b"],
    ["a⁦b"],
    ["a⁩b"],
  ])("word %j with a control or bidi character is an error", (word) => {
    expect(onlyError(synonym([word, "ok"])).key).toBe("groups[1].variants[1]");
  });

  it("characters next to the forbidden ones are fine", () => {
    expect(synonym(["a\u00a0b", "a\u00a1b", "café"]).errors).toEqual([]);
  });

  it("two words the same after normalisation are an error", () => {
    const issue = onlyError(synonym(["Log  In", "log in"]));
    expect(issue.key).toBe("groups[1].variants[2]");
  });

  it("noun and verb are checked as words", () => {
    const issue = onlyError(
      groups({ id: "a", kind: "verb-noun", noun: "", verb: "log in" }),
    );
    expect(issue.key).toBe("groups[1].noun");
  });
});

describe("rejected", () => {
  it("reads rejected groups", () => {
    const result = runWith({ rejected: [{ variants: [" open ", "close"] }] });
    expect(result.errors).toEqual([]);
    expect(result.variants.rejected).toEqual([{ variants: ["open", "close"] }]);
  });

  it("duplicates by words warn, whatever the order and case", () => {
    const result = run(
      {
        version: 1,
        rejected: [
          { variants: ["open", "close"] },
          { variants: ["CLOSE", "Open"] },
        ],
      },
      { "rejected.1": 9 },
    );
    expect(result.errors).toEqual([]);
    expect(result.variants.rejected).toEqual([{ variants: ["open", "close"] }]);
    expect(result.warnings).toEqual([
      {
        key: "rejected[2]",
        line: 9,
        message:
          "rejected[2] has the same words as an earlier rejected entry, so it is ignored.",
      },
    ]);
  });

  it("an entry needs a variants list of 2 to 20 words", () => {
    expect(onlyError(runWith({ rejected: [{}] })).message).toBe(
      "rejected[1] needs a variants list.",
    );
    expect(onlyError(runWith({ rejected: [{ variants: ["a"] }] })).key).toBe(
      "rejected[1].variants",
    );
    expect(onlyError(runWith({ rejected: ["x"] })).key).toBe("rejected[1]");
  });

  it("an unknown key warns with a hint", () => {
    const result = runWith({
      rejected: [{ varients: ["a", "b"], variants: ["c", "d"] }],
    });
    expect(result.errors).toEqual([]);
    expect(result.warnings[0]?.message).toBe(
      'Unknown key "varients" is ignored. Did you mean "variants"?',
    );
  });

  it("21 words is an error and 1001 entries is one error", () => {
    const tooMany = Array.from({ length: 21 }, (_, i) => `w${String(i)}`);
    expect(onlyError(runWith({ rejected: [{ variants: tooMany }] })).key).toBe(
      "rejected[1].variants",
    );
    const entries = Array.from({ length: 1001 }, (_, i) => ({
      variants: [`a${String(i)}`, "b"],
    }));
    const result = runWith({ rejected: entries });
    expect(result.errors).toHaveLength(1);
    expect(result.variants.rejected).toEqual([]);
  });
});

describe("safety", () => {
  it("__proto__ as a key does nothing harmful", () => {
    const polluted: unknown = JSON.parse(
      '{"version":1,"__proto__":{"groups":[{"id":"x"}]},"groups":[{"__proto__":{"id":"y"},"id":"a","kind":"synonym","variants":["a","b"]}]}',
    );
    const result = checkVariants(polluted);
    expect(result.variants.groups).toHaveLength(1);
    expect(result.variants.groups[0]?.id).toBe("a");
    expect(result.warnings.map((w) => w.key)).toEqual([
      "__proto__",
      "groups[1].__proto__",
    ]);
    expect(Object.hasOwn({}, "groups")).toBe(false);
  });

  it("an inherited-looking key is not read", () => {
    const result = checkVariants({ version: 1, toString: 1 });
    expect(result.errors).toEqual([]);
    expect(result.variants).toEqual(EMPTY_TEAM_VARIANTS);
  });

  it("keeps at most MAX_ISSUES errors and says how many more", () => {
    const bad = Array.from({ length: 25 }, () => ({ id: "BAD" }));
    const result = groups(...bad);
    expect(result.errors.length).toBe(MAX_ISSUES + 1);
    expect(result.errors[MAX_ISSUES]?.message).toMatch(
      /more problems not shown/,
    );
  });

  it("does not echo a word's value", () => {
    const result = groups({
      id: "a",
      kind: "synonym",
      variants: ["TOPSECRET".repeat(50), "b"],
    });
    expect(JSON.stringify(result.errors)).not.toContain("TOPSECRET");
  });
});

describe("rejectedKey", () => {
  it("ignores order, case, outer and inner spacing, and repeats", () => {
    expect(rejectedKey(["Open", "close"])).toBe(
      rejectedKey(["CLOSE ", "open"]),
    );
    expect(rejectedKey(["log   in", "x"])).toBe(
      rejectedKey(["x", "LOG IN", "x"]),
    );
  });

  it("sorts and joins with a line break", () => {
    expect(rejectedKey(["b", "A", "a"])).toBe("a\nb");
  });

  it("different words give different keys", () => {
    expect(rejectedKey(["a", "b"])).not.toBe(rejectedKey(["a", "c"]));
    expect(rejectedKey(["a b", "c"])).not.toBe(rejectedKey(["a", "b c"]));
  });
});
