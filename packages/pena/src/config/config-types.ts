export const CONFIG_FORMAT_VERSION = 1;

/** A path into the parsed file: map keys as strings, list positions as 0-based numbers. */
export type ConfigPath = readonly (string | number)[];
/** Returns the 1-based line of a key or list item, or undefined. */
export type LineLookup = (path: ConfigPath) => number | undefined;

export interface DocTypeRule {
  readonly type: string;
  readonly include: readonly string[];
}
export interface DocTypesConfig {
  /** Front matter key that names a doc's type; undefined means off. */
  readonly frontmatterKey: string | undefined;
  /** Rules that assign a doc type by path globs. */
  readonly rules: readonly DocTypeRule[];
}
export interface ConfidenceWeights {
  readonly share: number;
  readonly docs: number;
  readonly recency: number;
  readonly history: number;
}
export interface TuningConfig {
  /** Fewest docs a doc type needs to use its own counts; below this it uses whole-repo counts. */
  readonly docTypeMinDocs: number;
  /** How much each factor counts toward a convention's confidence. */
  readonly confidenceWeights: ConfidenceWeights;
  /** Most commits of history to read. */
  readonly historyMaxCommits: number;
  /** A commit touching more files than this is treated as a bulk commit. */
  readonly bulkCommitMaxFiles: number;
  /** Most words two templates may differ by and still suggest a new variant group. */
  readonly templateMaxEditDistance: number;
  /** Days after which a doc's recency weight halves. */
  readonly recencyHalfLifeDays: number;
}
export interface TulisConfig {
  /** The branch treated as production. */
  readonly prodBranch: string;
  /** Share a winner needs for a convention to count. */
  readonly threshold: number;
  /** Fewest docs a convention must be seen in before it counts. */
  readonly minDocs: number;
  /** Largest file size read, in bytes. */
  readonly maxFileSize: number;
  /** Globs of files to include. */
  readonly include: readonly string[];
  /** The team's own exclude globs, added on top of the default excludes. */
  readonly exclude: readonly string[];
  /** When false, the default excludes are not applied. */
  readonly defaultExcludes: boolean;
  /** How docs are sorted into types. */
  readonly docTypes: DocTypesConfig;
  /** Advanced numbers that tune the analysis. */
  readonly tuning: TuningConfig;
}
/** One problem found in a config file. */
export interface ConfigIssue {
  /** The setting it concerns, for example "tuning.historyMaxCommits" or "docTypes.rules[2].type" (list positions count from 1). Empty for the file as a whole. */
  readonly key: string;
  readonly line: number | undefined;
  readonly message: string;
}
