import type { ConfigIssue } from "./config-types.js";

/** One problem found in a team file (config, variants or decisions). */
export type TeamIssue = ConfigIssue;

/** "<file> line 4: <message>" or "<file>: <message>". */
export function formatTeamIssue(file: string, issue: TeamIssue): string {
  return issue.line === undefined
    ? `${file}: ${issue.message}`
    : `${file} line ${String(issue.line)}: ${issue.message}`;
}

/** A team file could not be used. The CLI maps this to exit code 2. */
export class TeamFileUseError extends Error {
  /** The file, relative to the repo root, for example ".tulis/variants.yaml". */
  readonly file: string;
  readonly issues: readonly TeamIssue[];
  /** Shown after the errors, because a typo warning often explains an error. */
  readonly warnings: readonly TeamIssue[];

  constructor(
    file: string,
    issues: readonly TeamIssue[],
    warnings: readonly TeamIssue[] = [],
  ) {
    super(
      [
        `Could not use ${file}.`,
        ...issues.map((issue) => `  ${formatTeamIssue(file, issue)}`),
        ...warnings.map((warning) => `  ${formatTeamIssue(file, warning)}`),
      ].join("\n"),
    );
    this.name = "TeamFileUseError";
    this.file = file;
    this.issues = issues;
    this.warnings = warnings;
  }
}
