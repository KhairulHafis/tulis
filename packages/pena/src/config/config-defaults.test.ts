import { describe, expect, it } from "vitest";
import {
  DEFAULT_CONFIG,
  DEFAULT_EXCLUDES,
  LANGUAGE_CODES,
  effectiveExcludes,
} from "./config-defaults.js";
import type { TulisConfig } from "./config-types.js";

describe("DEFAULT_CONFIG", () => {
  it("has every default value", () => {
    expect(DEFAULT_CONFIG).toEqual({
      prodBranch: "main",
      threshold: 0.8,
      minDocs: 5,
      maxFileSize: 1048576,
      include: ["**/*.md", "**/*.mdx"],
      exclude: [],
      defaultExcludes: true,
      docTypes: { frontmatterKey: undefined, rules: [] },
      tuning: {
        docTypeMinDocs: 5,
        confidenceWeights: {
          share: 0.4,
          docs: 0.2,
          recency: 0.2,
          history: 0.2,
        },
        historyMaxCommits: 5000,
        bulkCommitMaxFiles: 50,
        templateMaxEditDistance: 1,
        recencyHalfLifeDays: 730,
      },
    });
  });

  it("is frozen all the way down", () => {
    const frozen = [
      DEFAULT_CONFIG,
      DEFAULT_CONFIG.include,
      DEFAULT_CONFIG.exclude,
      DEFAULT_CONFIG.docTypes,
      DEFAULT_CONFIG.docTypes.rules,
      DEFAULT_CONFIG.tuning,
      DEFAULT_CONFIG.tuning.confidenceWeights,
      LANGUAGE_CODES,
      DEFAULT_EXCLUDES,
    ];
    for (const item of frozen) {
      expect(Object.isFrozen(item)).toBe(true);
    }
    expect(() => {
      (DEFAULT_CONFIG as { prodBranch: string }).prodBranch = "x";
    }).toThrow(TypeError);
    expect(() => {
      (DEFAULT_CONFIG.include as string[]).push("x");
    }).toThrow(TypeError);
  });
});

describe("LANGUAGE_CODES", () => {
  it("has 22 codes and leaves out ambiguous ones", () => {
    expect(LANGUAGE_CODES).toHaveLength(22);
    for (const code of ["en", "ee", "ml", "ca", "cs", "ms"]) {
      expect(LANGUAGE_CODES).not.toContain(code);
    }
  });
});

describe("DEFAULT_EXCLUDES", () => {
  it("lists the expected globs in order", () => {
    expect(DEFAULT_EXCLUDES).toEqual([
      "**/{ar,bn,de,es,fa,fr,he,hi,id,it,ja,ko,nl,pl,pt,ru,sv,th,tr,uk,vi,zh}/**",
      "**/{ar,bn,de,es,fa,fr,he,hi,id,it,ja,ko,nl,pl,pt,ru,sv,th,tr,uk,vi,zh}-[a-zA-Z][a-zA-Z]/**",
      "**/zh-{hans,hant,Hans,Hant}/**",
      "**/.github/**",
      "**/.gitlab/**",
      "**/vendor/**",
      "**/node_modules/**",
      "**/{README,CHANGELOG}.{md,mdx}",
    ]);
  });
});

describe("effectiveExcludes", () => {
  it("puts default excludes first, then the team's", () => {
    const config: TulisConfig = { ...DEFAULT_CONFIG, exclude: ["a/**"] };
    expect(effectiveExcludes(config)).toEqual([...DEFAULT_EXCLUDES, "a/**"]);
  });

  it("returns only the team's excludes when defaults are off", () => {
    const config: TulisConfig = {
      ...DEFAULT_CONFIG,
      defaultExcludes: false,
      exclude: ["a/**"],
    };
    expect(effectiveExcludes(config)).toEqual(["a/**"]);
  });

  it("returns a new array and leaves its input alone", () => {
    const exclude = ["a/**"];
    const config: TulisConfig = {
      ...DEFAULT_CONFIG,
      defaultExcludes: false,
      exclude,
    };
    const result = effectiveExcludes(config);
    expect(result).not.toBe(exclude);
    expect(exclude).toEqual(["a/**"]);
    expect(effectiveExcludes(DEFAULT_CONFIG)).not.toBe(DEFAULT_EXCLUDES);
  });
});
