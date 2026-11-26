import { describe, expect, it } from "vitest";
import { MAX_ISSUES, checkConfig } from "./check-config.js";
import type { ConfigCheckResult } from "./check-config.js";
import { DEFAULT_CONFIG } from "./config-defaults.js";
import type { ConfigPath, TulisConfig } from "./config-types.js";

const VERSION_WARNING =
  "No version line, so the file is read as version 1. Add `version: 1` at the top.";
const GLOB_ITEM_TEXT =
  "must be a relative pattern using `/`, without `..`, a leading `/` or `!`, or a backslash, up to 500 characters.";

/** Checks `value` with a fake lineOf built from a map of "a.0.b" paths to lines. */
function run(
  value: unknown,
  lines: Readonly<Record<string, number>> = {},
): ConfigCheckResult {
  const lineOf = (path: ConfigPath): number | undefined =>
    Object.hasOwn(lines, path.join(".")) ? lines[path.join(".")] : undefined;
  return checkConfig(value, lineOf);
}

/** Checks `{ version: 1, ...extra }`. */
function runWith(
  extra: Record<string, unknown>,
  lines: Readonly<Record<string, number>> = {},
): ConfigCheckResult {
  return run({ version: 1, ...extra }, lines);
}

function only(result: ConfigCheckResult): {
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

function globs(count: number): string[] {
  return Array.from({ length: count }, (_, i) => `docs/${String(i)}/*.md`);
}

describe("defaults and version", () => {
  it("null gives defaults and the version warning", () => {
    const result = checkConfig(null);
    expect(result.config).toEqual(DEFAULT_CONFIG);
    expect(result.errors).toEqual([]);
    expect(result.warnings).toEqual([
      { key: "version", line: undefined, message: VERSION_WARNING },
    ]);
    expect(result.fileVersion).toBeUndefined();
  });

  it("{} gives defaults and the version warning", () => {
    const result = run({});
    expect(result.config).toEqual(DEFAULT_CONFIG);
    expect(result.errors).toEqual([]);
    expect(result.warnings).toHaveLength(1);
  });

  it("{ version: 1 } gives defaults and no issues", () => {
    const result = run({ version: 1 });
    expect(result.config).toEqual(DEFAULT_CONFIG);
    expect(result.errors).toEqual([]);
    expect(result.warnings).toEqual([]);
    expect(result.fileVersion).toBe(1);
  });

  it("version 2 is returned without an error", () => {
    const result = run({ version: 2 });
    expect(result.fileVersion).toBe(2);
    expect(result.errors).toEqual([]);
  });

  it.each([["1"], [0], [1.5], [true]])("version %j is an error", (version) => {
    const result = run({ version }, { version: 1 });
    expect(result.fileVersion).toBeUndefined();
    expect(only(result)).toEqual({
      key: "version",
      line: 1,
      message: "version must be a whole number, 1 or more.",
    });
  });

  it.each([[42], ["text"], [[1, 2]], [true]])(
    "a top-level %j is an error",
    (value) => {
      const result = checkConfig(value);
      expect(result.config).toEqual(DEFAULT_CONFIG);
      expect(result.errors).toEqual([
        {
          key: "",
          line: undefined,
          message:
            "The file must be a list of settings, one `key: value` per line.",
        },
      ]);
    },
  );
});

describe("a full valid file", () => {
  it("comes back as written", () => {
    const input = {
      version: 1,
      prodBranch: "release/v2",
      threshold: 0.9,
      minDocs: 3,
      maxFileSize: "2MB",
      include: ["guides/**/*.md"],
      exclude: ["guides/old/**"],
      defaultExcludes: false,
      docTypes: {
        frontmatterKey: "kind",
        rules: [
          { type: "How to", include: ["guides/how-to/**"] },
          { type: "Reference_1", include: ["ref/**", "api/**"] },
        ],
      },
      tuning: {
        docTypeMinDocs: 7,
        confidenceWeights: { share: 0.5, docs: 0.1, recency: 0.3, history: 0 },
        historyMaxCommits: 100,
        bulkCommitMaxFiles: 10,
        templateMaxEditDistance: 3,
        recencyHalfLifeDays: 365,
      },
    };
    const result = run(input);
    expect(result.errors).toEqual([]);
    expect(result.warnings).toEqual([]);
    const expected: TulisConfig = {
      prodBranch: "release/v2",
      threshold: 0.9,
      minDocs: 3,
      maxFileSize: 2097152,
      include: ["guides/**/*.md"],
      exclude: ["guides/old/**"],
      defaultExcludes: false,
      docTypes: {
        frontmatterKey: "kind",
        rules: [
          { type: "How to", include: ["guides/how-to/**"] },
          { type: "Reference_1", include: ["ref/**", "api/**"] },
        ],
      },
      tuning: input.tuning,
    };
    expect(result.config).toEqual(expected);
  });
});

describe("simple settings", () => {
  it("prodBranch", () => {
    expect(runWith({ prodBranch: "trunk" }).config.prodBranch).toBe("trunk");
    for (const bad of ["bad name", "", 5]) {
      const result = runWith({ prodBranch: bad }, { prodBranch: 4 });
      expect(only(result)).toEqual({
        key: "prodBranch",
        line: 4,
        message: "prodBranch must be a valid git branch name.",
      });
      expect(result.config.prodBranch).toBe("main");
    }
  });

  it("threshold boundaries", () => {
    for (const ok of [0.5, 1, 0.75]) {
      const result = runWith({ threshold: ok });
      expect(result.errors).toEqual([]);
      expect(result.config.threshold).toBe(ok);
    }
    for (const bad of [0.49, 1.01, "0.8", NaN, Infinity]) {
      const result = runWith({ threshold: bad }, { threshold: 3 });
      expect(only(result)).toEqual({
        key: "threshold",
        line: 3,
        message:
          "threshold must be a number from 0.5 to 1, for example 0.8 for 80%.",
      });
      expect(result.config.threshold).toBe(0.8);
    }
  });

  it("minDocs", () => {
    expect(runWith({ minDocs: 1 }).config.minDocs).toBe(1);
    expect(runWith({ minDocs: 1000000 }).config.minDocs).toBe(1000000);
    for (const bad of [0, 1000001, 2.5, "5"]) {
      const result = runWith({ minDocs: bad }, { minDocs: 5 });
      expect(only(result)).toEqual({
        key: "minDocs",
        line: 5,
        message: "minDocs must be a whole number from 1 to 1000000.",
      });
      expect(result.config.minDocs).toBe(5);
    }
  });

  it("maxFileSize", () => {
    expect(runWith({ maxFileSize: "1KB" }).config.maxFileSize).toBe(1024);
    expect(runWith({ maxFileSize: "10MB" }).config.maxFileSize).toBe(10485760);
    expect(runWith({ maxFileSize: 2048 }).config.maxFileSize).toBe(2048);
    for (const bad of ["big", "1GB", true, -5, 1.5]) {
      const result = runWith({ maxFileSize: bad }, { maxFileSize: 6 });
      expect(only(result)).toEqual({
        key: "maxFileSize",
        line: 6,
        message:
          "maxFileSize must be a size such as 1MB or 500KB, or a whole number of bytes.",
      });
      expect(result.config.maxFileSize).toBe(1048576);
    }
    for (const bad of [1023, "10241KB", 0, 10485761]) {
      const result = runWith({ maxFileSize: bad }, { maxFileSize: 6 });
      expect(only(result)).toEqual({
        key: "maxFileSize",
        line: 6,
        message: "maxFileSize must be from 1KB to 10MB.",
      });
      expect(result.config.maxFileSize).toBe(1048576);
    }
  });

  it("defaultExcludes", () => {
    expect(runWith({ defaultExcludes: false }).config.defaultExcludes).toBe(
      false,
    );
    for (const bad of ["true", 1]) {
      const result = runWith({ defaultExcludes: bad }, { defaultExcludes: 8 });
      expect(only(result)).toEqual({
        key: "defaultExcludes",
        line: 8,
        message: "defaultExcludes must be true or false.",
      });
      expect(result.config.defaultExcludes).toBe(true);
    }
  });
});

describe("glob lists", () => {
  it("accepts good globs", () => {
    const result = runWith({
      include: ["a/*.md", "**/x?.mdx", "a".repeat(500), "docs/{a,b}/**"],
    });
    expect(result.errors).toEqual([]);
    expect(result.config.include).toHaveLength(4);
  });

  it("limits the number of globs", () => {
    expect(runWith({ include: globs(200) }).errors).toEqual([]);
    const tooMany = runWith({ include: globs(201) }, { include: 2 });
    expect(only(tooMany)).toEqual({
      key: "include",
      line: 2,
      message: "include must have from 1 to 200 patterns.",
    });
    expect(tooMany.config.include).toEqual(DEFAULT_CONFIG.include);

    const empty = runWith({ include: [] });
    expect(only(empty).message).toBe(
      "include must have from 1 to 200 patterns.",
    );
    expect(runWith({ exclude: [] }).errors).toEqual([]);
    expect(only(runWith({ exclude: globs(201) })).message).toBe(
      "exclude must have from 0 to 200 patterns.",
    );
  });

  it("rejects a value that is not a list", () => {
    for (const bad of ["a/*.md", 5, { a: 1 }]) {
      const result = runWith({ exclude: bad }, { exclude: 9 });
      expect(only(result)).toEqual({
        key: "exclude",
        line: 9,
        message: "exclude must be a list of file patterns.",
      });
      expect(result.config.exclude).toEqual([]);
    }
  });

  it.each([
    ["empty", ""],
    ["501 characters", "a".repeat(501)],
    ["a control character", "a\u0001b"],
    ["DEL", "a\u007fb"],
    ["a newline", "a\nb"],
    ["a leading slash", "/docs/*.md"],
    ["a leading !", "!docs/*.md"],
    ["a drive letter", "C:docs"],
    ["a backslash", "docs\\a.md"],
    ["a .. segment", "docs/../a.md"],
    ["a leading ..", "../a.md"],
    ["a trailing ..", "docs/.."],
    ["a number", 5],
    ["null", null],
  ])("rejects an item with %s", (_name, bad) => {
    const result = runWith({ include: ["ok/*.md", bad] }, { "include.1": 12 });
    expect(only(result)).toEqual({
      key: "include[2]",
      line: 12,
      message: `include[2] ${GLOB_ITEM_TEXT}`,
    });
    // One bad item sends the whole list to its default.
    expect(result.config.include).toEqual(DEFAULT_CONFIG.include);
  });

  it("allows .. inside a segment name", () => {
    expect(runWith({ include: ["a..b/*.md"] }).errors).toEqual([]);
  });

  it("reports every bad item", () => {
    const result = runWith({ exclude: ["/a", "b", "!c"] });
    expect(result.errors.map((issue) => issue.key)).toEqual([
      "exclude[1]",
      "exclude[3]",
    ]);
  });
});

describe("docTypes", () => {
  it("frontmatterKey", () => {
    for (const ok of ["type", "_x", "a-b_9", "a".repeat(64)]) {
      expect(
        runWith({ docTypes: { frontmatterKey: ok } }).config.docTypes
          .frontmatterKey,
      ).toBe(ok);
    }
    for (const bad of ["", "9a", "a b", "a".repeat(65), 5]) {
      const result = runWith(
        { docTypes: { frontmatterKey: bad } },
        { "docTypes.frontmatterKey": 14 },
      );
      expect(only(result)).toEqual({
        key: "docTypes.frontmatterKey",
        line: 14,
        message:
          "docTypes.frontmatterKey must be a frontmatter key name: letters, digits, `_` or `-`, starting with a letter or `_`, up to 64 characters.",
      });
      expect(result.config.docTypes.frontmatterKey).toBeUndefined();
    }
  });

  it("a non-map docTypes uses the defaults", () => {
    for (const bad of ["x", 5, []]) {
      const result = runWith({ docTypes: bad }, { docTypes: 10 });
      expect(only(result)).toEqual({
        key: "docTypes",
        line: 10,
        message: "docTypes must be a map of settings.",
      });
      expect(result.config.docTypes).toEqual(DEFAULT_CONFIG.docTypes);
    }
  });

  it("rules must be a list of at most 100", () => {
    const result = runWith(
      { docTypes: { rules: {} } },
      { "docTypes.rules": 3 },
    );
    expect(only(result)).toEqual({
      key: "docTypes.rules",
      line: 3,
      message: "docTypes.rules must be a list of rules.",
    });
    const rule = { type: "A", include: ["a/**"] };
    const hundred = Array.from({ length: 100 }, () => rule);
    expect(
      runWith({ docTypes: { rules: hundred } }).config.docTypes.rules,
    ).toHaveLength(100);
    const tooMany = runWith({ docTypes: { rules: [...hundred, rule] } });
    expect(only(tooMany).message).toBe(
      "docTypes.rules must have from 0 to 100 rules.",
    );
    expect(tooMany.config.docTypes.rules).toEqual([]);
  });

  it("a rule that is not a map", () => {
    const result = runWith(
      { docTypes: { rules: [{ type: "A", include: ["a"] }, "oops"] } },
      { "docTypes.rules.1": 20 },
    );
    expect(only(result)).toEqual({
      key: "docTypes.rules[2]",
      line: 20,
      message: "docTypes.rules[2] must be a map with type and include.",
    });
    expect(result.config.docTypes.rules).toEqual([]);
  });

  it("a rule with a missing type uses the line of the rule", () => {
    const result = runWith(
      { docTypes: { rules: [{ include: ["a"] }] } },
      { "docTypes.rules.0": 7 },
    );
    expect(only(result)).toEqual({
      key: "docTypes.rules[1]",
      line: 7,
      message: "docTypes.rules[1] needs a type.",
    });
    expect(result.config.docTypes.rules).toEqual([]);
  });

  it("a rule with a missing include uses the line of the rule", () => {
    const result = runWith(
      { docTypes: { rules: [{ type: "A" }] } },
      { "docTypes.rules.0": 7 },
    );
    expect(only(result)).toEqual({
      key: "docTypes.rules[1]",
      line: 7,
      message: "docTypes.rules[1] needs an include list.",
    });
  });

  it.each([[""], [" a"], ["a/b"], ["a".repeat(65)], [5]])(
    "a rule with the bad type %j",
    (bad) => {
      const result = runWith(
        { docTypes: { rules: [{ type: bad, include: ["a"] }] } },
        { "docTypes.rules.0.type": 8 },
      );
      expect(only(result)).toEqual({
        key: "docTypes.rules[1].type",
        line: 8,
        message:
          "docTypes.rules[1].type must be a name of letters, digits, spaces, `_` or `-`, up to 64 characters.",
      });
    },
  );

  it("a rule with a bad include list", () => {
    const empty = runWith(
      { docTypes: { rules: [{ type: "A", include: [] }] } },
      { "docTypes.rules.0.include": 9 },
    );
    expect(only(empty)).toEqual({
      key: "docTypes.rules[1].include",
      line: 9,
      message: "docTypes.rules[1].include must have from 1 to 50 patterns.",
    });
    expect(
      runWith({ docTypes: { rules: [{ type: "A", include: globs(50) }] } })
        .errors,
    ).toEqual([]);
    expect(
      only(
        runWith({ docTypes: { rules: [{ type: "A", include: globs(51) }] } }),
      ).message,
    ).toBe("docTypes.rules[1].include must have from 1 to 50 patterns.");
    expect(
      only(runWith({ docTypes: { rules: [{ type: "A", include: "a" }] } }))
        .message,
    ).toBe("docTypes.rules[1].include must be a list of file patterns.");
  });

  it("a bad glob inside a rule is keyed to the item", () => {
    const result = runWith(
      {
        docTypes: {
          rules: [
            { type: "A", include: ["a"] },
            { type: "B", include: ["ok", "/bad"] },
          ],
        },
      },
      { "docTypes.rules.1.include.1": 31 },
    );
    expect(only(result)).toEqual({
      key: "docTypes.rules[2].include[2]",
      line: 31,
      message: `docTypes.rules[2].include[2] ${GLOB_ITEM_TEXT}`,
    });
    expect(result.config.docTypes.rules).toEqual([]);
  });

  it("one bad rule makes the whole list []", () => {
    const result = runWith({
      docTypes: {
        frontmatterKey: "kind",
        rules: [{ type: "A", include: ["a"] }, { type: "B" }],
      },
    });
    expect(result.errors).toHaveLength(1);
    expect(result.config.docTypes.rules).toEqual([]);
    expect(result.config.docTypes.frontmatterKey).toBe("kind");
  });
});

describe("tuning", () => {
  it("a non-map tuning uses the defaults", () => {
    const result = runWith({ tuning: 5 }, { tuning: 2 });
    expect(only(result)).toEqual({
      key: "tuning",
      line: 2,
      message: "tuning must be a map of settings.",
    });
    expect(result.config.tuning).toEqual(DEFAULT_CONFIG.tuning);
  });

  const integers: readonly (readonly [string, number, number])[] = [
    ["docTypeMinDocs", 1, 1000000],
    ["historyMaxCommits", 1, 1000000],
    ["bulkCommitMaxFiles", 1, 1000000],
    ["templateMaxEditDistance", 1, 5],
    ["recencyHalfLifeDays", 1, 36500],
  ];

  it.each(integers)("tuning.%s", (name, min, max) => {
    for (const ok of [min, max]) {
      const result = runWith({ tuning: { [name]: ok } });
      expect(result.errors).toEqual([]);
      expect(result.config.tuning).toEqual({
        ...DEFAULT_CONFIG.tuning,
        [name]: ok,
      });
    }
    for (const bad of [min - 1, max + 1, 1.5, "2"]) {
      const result = runWith(
        { tuning: { [name]: bad } },
        { [`tuning.${name}`]: 15 },
      );
      expect(only(result)).toEqual({
        key: `tuning.${name}`,
        line: 15,
        message: `tuning.${name} must be a whole number from ${String(min)} to ${String(max)}.`,
      });
      expect(result.config.tuning).toEqual(DEFAULT_CONFIG.tuning);
    }
  });

  it("fills partial weights from the defaults", () => {
    const result = runWith({ tuning: { confidenceWeights: { share: 1 } } });
    expect(result.errors).toEqual([]);
    expect(result.config.tuning.confidenceWeights).toEqual({
      share: 1,
      docs: 0.2,
      recency: 0.2,
      history: 0.2,
    });
  });

  it("all zero weights is an error", () => {
    const result = runWith(
      {
        tuning: {
          confidenceWeights: { share: 0, docs: 0, recency: 0, history: 0 },
        },
      },
      { "tuning.confidenceWeights": 18 },
    );
    expect(only(result)).toEqual({
      key: "tuning.confidenceWeights",
      line: 18,
      message: "tuning.confidenceWeights needs at least one weight above 0.",
    });
    expect(result.config.tuning.confidenceWeights).toEqual(
      DEFAULT_CONFIG.tuning.confidenceWeights,
    );
  });

  it("a single zero weight is fine", () => {
    const result = runWith({
      tuning: { confidenceWeights: { share: 0, docs: 0, recency: 0.5 } },
    });
    // history keeps its default of 0.2, so the sum is above 0.
    expect(result.errors).toEqual([]);
  });

  it.each([[1.5], [-0.1], ["1"], [NaN]])(
    "a weight of %j is an error",
    (bad) => {
      const result = runWith(
        { tuning: { confidenceWeights: { share: bad, docs: 0.5 } } },
        { "tuning.confidenceWeights.share": 19 },
      );
      expect(only(result)).toEqual({
        key: "tuning.confidenceWeights.share",
        line: 19,
        message: "tuning.confidenceWeights.share must be a number from 0 to 1.",
      });
      expect(result.config.tuning.confidenceWeights).toEqual({
        share: 0.4,
        docs: 0.5,
        recency: 0.2,
        history: 0.2,
      });
    },
  );

  it("a non-map confidenceWeights uses the default weights", () => {
    const result = runWith(
      { tuning: { confidenceWeights: [1] } },
      { "tuning.confidenceWeights": 17 },
    );
    expect(only(result)).toEqual({
      key: "tuning.confidenceWeights",
      line: 17,
      message: "tuning.confidenceWeights must be a map of weights.",
    });
    expect(result.config.tuning).toEqual(DEFAULT_CONFIG.tuning);
  });
});

describe("unknown keys", () => {
  it("warns at the top level, with a hint", () => {
    const result = runWith({ thresold: 0.9 }, { thresold: 5 });
    expect(result.errors).toEqual([]);
    expect(result.warnings).toEqual([
      {
        key: "thresold",
        line: 5,
        message: 'Unknown key "thresold" is ignored. Did you mean "threshold"?',
      },
    ]);
    expect(result.config.threshold).toBe(0.8);
  });

  it("warns without a hint when nothing is close", () => {
    const result = runWith({ zzzzzzzz: 1 });
    expect(result.warnings).toEqual([
      {
        key: "zzzzzzzz",
        line: undefined,
        message: 'Unknown key "zzzzzzzz" is ignored.',
      },
    ]);
  });

  it("warns inside tuning", () => {
    const result = runWith(
      { tuning: { historyMaxCommit: 5 } },
      { "tuning.historyMaxCommit": 12 },
    );
    expect(result.warnings).toEqual([
      {
        key: "tuning.historyMaxCommit",
        line: 12,
        message:
          'Unknown key "historyMaxCommit" is ignored. Did you mean "historyMaxCommits"?',
      },
    ]);
  });

  it("warns inside docTypes", () => {
    const result = runWith({ docTypes: { rule: [] } });
    expect(result.warnings).toEqual([
      {
        key: "docTypes.rule",
        line: undefined,
        message: 'Unknown key "rule" is ignored. Did you mean "rules"?',
      },
    ]);
  });

  it("warns inside a rule and inside confidenceWeights", () => {
    const result = runWith(
      {
        docTypes: { rules: [{ type: "A", include: ["a"], extra: 1 }] },
        tuning: { confidenceWeights: { share: 0.5, bogus: 1 } },
      },
      { "docTypes.rules.0.extra": 3, "tuning.confidenceWeights.bogus": 4 },
    );
    expect(result.errors).toEqual([]);
    expect(result.warnings).toEqual([
      {
        key: "docTypes.rules[1].extra",
        line: 3,
        message: 'Unknown key "extra" is ignored.',
      },
      {
        key: "tuning.confidenceWeights.bogus",
        line: 4,
        message: 'Unknown key "bogus" is ignored.',
      },
    ]);
  });

  it("keeps escape and bidi characters out of the message and key", () => {
    const name = "bad\u001b[31m‮evil";
    const result = runWith({ [name]: 1 });
    expect(result.warnings).toHaveLength(1);
    const [warning] = result.warnings;
    for (const text of [warning?.key, warning?.message]) {
      expect(text).toBeDefined();
      expect(text).not.toContain("\u001b");
      expect(text).not.toContain("‮");
    }
  });

  it("cuts a long unknown key", () => {
    const result = runWith({ ["k".repeat(500)]: 1 });
    expect(result.warnings[0]?.key.length).toBeLessThan(70);
    expect(result.warnings[0]?.message.length).toBeLessThan(120);
  });
});

describe("inherited names", () => {
  it("treats constructor and toString as unknown keys", () => {
    const result = runWith({ constructor: 1, toString: 2 });
    expect(result.errors).toEqual([]);
    expect(result.warnings.map((issue) => issue.key)).toEqual([
      "constructor",
      "toString",
    ]);
    expect(result.config).toEqual(DEFAULT_CONFIG);
  });

  it("does not read inherited values for known keys", () => {
    const result = checkConfig(Object.create({ threshold: 0.6, version: 1 }));
    expect(result.config.threshold).toBe(0.8);
    expect(result.fileVersion).toBeUndefined();
  });

  it("treats an own __proto__ key as unknown", () => {
    const input: unknown = JSON.parse(
      '{"version": 1, "__proto__": {"threshold": 0.6}}',
    );
    const result = checkConfig(input);
    expect(result.warnings).toEqual([
      {
        key: "__proto__",
        line: undefined,
        message: 'Unknown key "__proto__" is ignored.',
      },
    ]);
    expect(result.config.threshold).toBe(0.8);
  });
});

describe("the issue cap", () => {
  it("keeps 20 warnings and counts the rest", () => {
    const input: Record<string, unknown> = { version: 1 };
    for (let i = 0; i < 25; i++) {
      input[`zzzzzzzzzz${String(i)}`] = i;
    }
    const result = checkConfig(input);
    expect(MAX_ISSUES).toBe(20);
    expect(result.warnings).toHaveLength(21);
    expect(result.warnings[20]).toEqual({
      key: "",
      line: undefined,
      message: "5 more warnings not shown.",
    });
    expect(result.warnings[19]?.key).toBe("zzzzzzzzzz19");
  });

  it("keeps 20 errors and counts the rest", () => {
    const result = runWith({ include: Array.from({ length: 30 }, () => "/x") });
    expect(result.errors).toHaveLength(21);
    expect(result.errors[20]).toEqual({
      key: "",
      line: undefined,
      message: "10 more problems not shown.",
    });
  });

  it("adds nothing at exactly 20", () => {
    const input: Record<string, unknown> = { version: 1 };
    for (let i = 0; i < 20; i++) {
      input[`zzzzzzzzzz${String(i)}`] = i;
    }
    expect(checkConfig(input).warnings).toHaveLength(20);
  });
});

describe("safety", () => {
  function expectFrozen(config: TulisConfig): void {
    expect(Object.isFrozen(config)).toBe(true);
    expect(Object.isFrozen(config.include)).toBe(true);
    expect(Object.isFrozen(config.exclude)).toBe(true);
    expect(Object.isFrozen(config.docTypes)).toBe(true);
    expect(Object.isFrozen(config.docTypes.rules)).toBe(true);
    for (const rule of config.docTypes.rules) {
      expect(Object.isFrozen(rule)).toBe(true);
      expect(Object.isFrozen(rule.include)).toBe(true);
    }
    expect(Object.isFrozen(config.tuning)).toBe(true);
    expect(Object.isFrozen(config.tuning.confidenceWeights)).toBe(true);
  }

  it("freezes every level and shares nothing with the input", () => {
    const input = {
      version: 1,
      include: ["a/**"],
      exclude: ["b/**"],
      docTypes: {
        frontmatterKey: "kind",
        rules: [{ type: "A", include: ["c/**"] }],
      },
      tuning: { confidenceWeights: { share: 0.7 } },
    };
    const result = checkConfig(input);
    expectFrozen(result.config);
    const before = structuredClone(result.config);

    input.include.push("changed");
    input.exclude[0] = "changed";
    input.docTypes.rules[0]?.include.push("changed");
    if (input.docTypes.rules[0] !== undefined) {
      input.docTypes.rules[0].type = "Changed";
    }
    input.docTypes.rules.push({ type: "B", include: ["x"] });
    input.tuning.confidenceWeights.share = 0.1;
    expect(result.config).toEqual(before);
  });

  it("freezes the defaults result too", () => {
    expectFrozen(checkConfig({ version: 1 }).config);
    expectFrozen(checkConfig(5).config);
  });

  it("never puts the bad value in a message", () => {
    const evil = "evil\u001b[31m";
    const result = runWith({
      prodBranch: evil,
      threshold: evil,
      minDocs: evil,
      maxFileSize: evil,
      include: [evil, `/${evil}`],
      exclude: evil,
      defaultExcludes: evil,
      docTypes: {
        frontmatterKey: evil,
        rules: [evil, { type: evil, include: [evil] }],
      },
      tuning: {
        docTypeMinDocs: evil,
        confidenceWeights: { share: evil },
        recencyHalfLifeDays: evil,
      },
    });
    expect(result.errors.length).toBeGreaterThan(5);
    for (const issue of result.errors) {
      expect(issue.message).not.toContain("evil");
      expect(issue.key).not.toContain("evil");
    }
  });

  it("never throws on odd input", () => {
    const odd: unknown[] = [
      undefined,
      () => 1,
      Symbol("s"),
      10n,
      new Date(0),
      [[]],
      { version: {}, include: [[]], docTypes: { rules: [null, []] } },
    ];
    for (const value of odd) {
      expect(() => checkConfig(value)).not.toThrow();
    }
  });
});

describe("null means not set", () => {
  it("top-level keys give their defaults with no issues", () => {
    const result = runWith({
      prodBranch: null,
      threshold: null,
      minDocs: null,
      maxFileSize: null,
      include: null,
      exclude: null,
      defaultExcludes: null,
      docTypes: null,
      tuning: null,
    });
    expect(result.errors).toEqual([]);
    expect(result.warnings).toEqual([]);
    expect(result.config).toEqual(DEFAULT_CONFIG);
  });

  it("docTypes keys give their defaults", () => {
    const result = runWith({
      docTypes: { frontmatterKey: null, rules: null },
    });
    expect(result.errors).toEqual([]);
    expect(result.config.docTypes).toEqual(DEFAULT_CONFIG.docTypes);
  });

  it("tuning keys give their defaults", () => {
    const result = runWith({
      tuning: {
        docTypeMinDocs: null,
        confidenceWeights: null,
        historyMaxCommits: null,
      },
    });
    expect(result.errors).toEqual([]);
    expect(result.config.tuning).toEqual(DEFAULT_CONFIG.tuning);
  });

  it("a null weight gives its default", () => {
    const result = runWith({
      tuning: { confidenceWeights: { share: null, docs: 0.5 } },
    });
    expect(result.errors).toEqual([]);
    expect(result.config.tuning.confidenceWeights).toEqual({
      share: 0.4,
      docs: 0.5,
      recency: 0.2,
      history: 0.2,
    });
  });

  it("version null gives the version warning, not an error", () => {
    const result = run({ version: null });
    expect(result.errors).toEqual([]);
    expect(result.fileVersion).toBeUndefined();
    expect(result.warnings).toEqual([
      { key: "version", line: undefined, message: VERSION_WARNING },
    ]);
  });

  it("a rule with a null type or include is missing it", () => {
    const noType = runWith(
      { docTypes: { rules: [{ type: null, include: ["a"] }] } },
      { "docTypes.rules.0": 7 },
    );
    expect(only(noType)).toEqual({
      key: "docTypes.rules[1]",
      line: 7,
      message: "docTypes.rules[1] needs a type.",
    });
    const noInclude = runWith({
      docTypes: { rules: [{ type: "A", include: null }] },
    });
    expect(only(noInclude).message).toBe(
      "docTypes.rules[1] needs an include list.",
    );
  });

  it("null inside a list is still invalid", () => {
    expect(only(runWith({ include: [null] })).key).toBe("include[1]");
    expect(only(runWith({ docTypes: { rules: [null] } })).message).toBe(
      "docTypes.rules[1] must be a map with type and include.",
    );
  });
});
