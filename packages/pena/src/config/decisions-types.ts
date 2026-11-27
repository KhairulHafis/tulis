export const DECISIONS_FORMAT_VERSION = 1;
/** The folder inside `.tulis/` that holds one dismissals file per writer. */
export const DECISIONS_FOLDER = "decisions";

/** How often one writer dismissed one type of flag. */
export interface Dismissal {
  /** The check ID of the flag type, for example "term.sign-in". */
  readonly check: string;
  readonly count: number;
  /** Day of the latest dismissal, "YYYY-MM-DD". Never a time. */
  readonly last: string;
}

/** One writer's file, checked. */
export interface WriterDecisions {
  /** For example "khairul-hafis.yaml". */
  readonly fileName: string;
  readonly dismissals: readonly Dismissal[];
}
