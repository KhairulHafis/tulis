import type { TulisConfig } from "./config-types.js";
import { DEFAULT_MAX_FILE_SIZE } from "./file-size.js";

export const LANGUAGE_CODES: readonly string[] = Object.freeze([
  "ar",
  "bn",
  "de",
  "es",
  "fa",
  "fr",
  "he",
  "hi",
  "id",
  "it",
  "ja",
  "ko",
  "nl",
  "pl",
  "pt",
  "ru",
  "sv",
  "th",
  "tr",
  "uk",
  "vi",
  "zh",
]);

const CODE_LIST = LANGUAGE_CODES.join(",");

export const DEFAULT_EXCLUDES: readonly string[] = Object.freeze([
  `**/{${CODE_LIST}}/**`,
  `**/{${CODE_LIST}}-[a-zA-Z][a-zA-Z]/**`,
  "**/zh-{hans,hant,Hans,Hant}/**",
  "**/.github/**",
  "**/.gitlab/**",
  "**/vendor/**",
  "**/node_modules/**",
  "**/{README,CHANGELOG}.{md,mdx}",
]);

export const DEFAULT_CONFIG: TulisConfig = Object.freeze({
  prodBranch: "main",
  threshold: 0.8,
  minDocs: 5,
  maxFileSize: DEFAULT_MAX_FILE_SIZE,
  include: Object.freeze(["**/*.md", "**/*.mdx"]),
  exclude: Object.freeze([]),
  defaultExcludes: true,
  docTypes: Object.freeze({
    frontmatterKey: undefined,
    rules: Object.freeze([]),
  }),
  tuning: Object.freeze({
    docTypeMinDocs: 5,
    confidenceWeights: Object.freeze({
      share: 0.4,
      docs: 0.2,
      recency: 0.2,
      history: 0.2,
    }),
    historyMaxCommits: 5000,
    bulkCommitMaxFiles: 50,
    templateMaxEditDistance: 1,
    recencyHalfLifeDays: 730,
  }),
});

/** DEFAULT_EXCLUDES then config.exclude when defaultExcludes is true; otherwise config.exclude only. */
export function effectiveExcludes(config: TulisConfig): readonly string[] {
  return config.defaultExcludes
    ? [...DEFAULT_EXCLUDES, ...config.exclude]
    : [...config.exclude];
}
