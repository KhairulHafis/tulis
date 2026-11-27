import type { SourceRange } from "../markdown/ignored-ranges.js";

export const MAX_OBSERVATION_VALUE_LENGTH = 200;
export const MAX_EVIDENCE_LENGTH = 300;
/** Per extractor, per doc. */
export const MAX_OBSERVATIONS_PER_EXTRACTOR = 10_000;

/** What an extractor returns. */
export interface Finding {
  readonly dimension: string;
  readonly value: string;
  readonly range: SourceRange;
}

/** A finding checked and completed by the runner. */
export interface Observation {
  readonly dimension: string;
  readonly value: string;
  readonly range: SourceRange;
  /** 1-based line of range.start. */
  readonly line: number;
  /**
   * Evidence: source text of the unit the extractor was given, whitespace
   * runs collapsed to one space, trimmed.
   */
  readonly text: string;
}
