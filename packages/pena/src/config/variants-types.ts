export const VARIANTS_FORMAT_VERSION = 1;

/** "team" when the group has no `source` key. */
export type VariantSource = "team" | "discovered";

/** A group of words that mean the same thing. */
export interface SynonymGroup {
  readonly id: string;
  readonly kind: "synonym";
  readonly variants: readonly string[];
  readonly source: VariantSource;
}

/** A verb and the noun that goes with it, for example "log in" and "login". */
export interface VerbNounGroup {
  readonly id: string;
  readonly kind: "verb-noun";
  readonly noun: string;
  readonly verb: string;
  readonly source: VariantSource;
}

export type VariantGroup = SynonymGroup | VerbNounGroup;

/** Words of a discovered group the team said no to. */
export interface RejectedGroup {
  readonly variants: readonly string[];
}

export interface TeamVariants {
  /** Enabled team groups, in file order. A group whose ID matches a built-in group replaces it. */
  readonly groups: readonly VariantGroup[];
  /** IDs of entries with `enabled: false` (built-in or team groups switched off), in file order. */
  readonly disabled: readonly string[];
  readonly rejected: readonly RejectedGroup[];
}

export const EMPTY_TEAM_VARIANTS: TeamVariants = Object.freeze({
  groups: Object.freeze([]),
  disabled: Object.freeze([]),
  rejected: Object.freeze([]),
});
