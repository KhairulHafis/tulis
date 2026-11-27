import { tokenizeSentence, type Token } from "../language/tokens.js";
import {
  frontmatterTitle,
  isNonEnglish,
  readFrontmatter,
  type FrontmatterData,
  type FrontmatterWarning,
} from "../markdown/frontmatter-data.js";
import {
  findIgnoredRanges,
  type IgnoredRange,
  type IgnoreWarning,
  type SourceRange,
} from "../markdown/ignored-ranges.js";
import type { MaskableBlock } from "../markdown/mask-block.js";
import type { MaskedText } from "../markdown/masked-text.js";
import {
  parseMarkdown,
  type MarkdownParseFailure,
  type MarkdownSyntax,
  type ParsedMarkdown,
} from "../markdown/parse-markdown.js";
import type { ProductNameMatcher } from "../markdown/product-names.js";
import {
  collectProseBlocks,
  proseUnit,
  type ProseUnit,
  type ProseUnitKind,
} from "../markdown/prose-units.js";
import type { Sentence } from "../markdown/sentences.js";
import { SourceLines, type LineColumn } from "../markdown/source-lines.js";

export interface PrepareOptions {
  readonly productNames?: ProductNameMatcher;
}

export interface PreparedSentence {
  /** Masked text, exactly as the splitter gave it. */
  readonly text: string;
  readonly maskedStart: number;
  readonly maskedEnd: number;
  readonly source: SourceRange;
  /** Position of source.start and of source.end (end exclusive, like unist). */
  readonly start: LineColumn;
  readonly end: LineColumn;
  readonly tokens: readonly Token[];
}

export interface PreparedBlock {
  readonly kind: ProseUnitKind;
  /** The mdast node, for heading depth, table position and so on. */
  readonly node: MaskableBlock;
  readonly masked: MaskedText;
  readonly sentences: readonly PreparedSentence[];
}

export type PreparedTitle =
  | { readonly from: "h1"; readonly text: string; readonly line: number }
  | {
      readonly from: "frontmatter";
      readonly text: string;
      readonly line: number;
    };

export type PrepareWarning =
  | ({ readonly from: "ignore" } & IgnoreWarning)
  | ({ readonly from: "frontmatter" } & FrontmatterWarning);

export interface PreparedDoc {
  readonly kind: "prepared";
  readonly syntax: MarkdownSyntax;
  readonly parsed: ParsedMarkdown;
  readonly frontmatter: FrontmatterData | undefined;
  readonly title: PreparedTitle | undefined;
  /** Prose blocks in document order, after dropping ignored passages. */
  readonly blocks: readonly PreparedBlock[];
  /** Ignore ranges that name check IDs; the checker applies them. */
  readonly checkIgnores: readonly IgnoredRange[];
  /** Frontmatter warnings first, then ignore warnings, each in source order. */
  readonly warnings: readonly PrepareWarning[];
  /** Ignore warnings dropped after the first 100. */
  readonly moreWarnings: number;
}

export type PrepareSkipReason =
  "invalid-mdx" | "too-deep" | "non-english" | "preparation-error";

export interface SkippedDoc {
  readonly kind: "skipped";
  readonly syntax: MarkdownSyntax;
  readonly reason: PrepareSkipReason;
  /** Only for invalid-mdx and too-deep: the parser's safe message. */
  readonly message: string | undefined;
  readonly line: number | undefined;
  readonly column: number | undefined;
}

export type PrepareResult = PreparedDoc | SkippedDoc;

/**
 * Answers "does a sentence overlap, or sit inside, one of these ranges" in
 * logarithmic time: ranges sorted by start, with the largest end so far.
 */
class RangeIndex {
  readonly #starts: number[] = [];
  readonly #maxEnds: number[] = [];

  constructor(ranges: readonly SourceRange[]) {
    const sorted = [...ranges].sort((a, b) => a.start - b.start);
    let maxEnd = -1;
    for (const range of sorted) {
      maxEnd = Math.max(maxEnd, range.end);
      this.#starts.push(range.start);
      this.#maxEnds.push(maxEnd);
    }
  }

  /** How many ranges start before `limit` (or at it, when `inclusive`). */
  #countStartingBefore(limit: number, inclusive: boolean): number {
    let low = 0;
    let high = this.#starts.length;
    while (low < high) {
      const middle = (low + high) >> 1;
      const start = this.#starts[middle] ?? 0;
      if (inclusive ? start <= limit : start < limit) {
        low = middle + 1;
      } else {
        high = middle;
      }
    }
    return low;
  }

  overlaps(range: SourceRange): boolean {
    const count = this.#countStartingBefore(range.end, false);
    return count > 0 && (this.#maxEnds[count - 1] ?? -1) > range.start;
  }

  contains(range: SourceRange): boolean {
    const count = this.#countStartingBefore(range.start, true);
    return count > 0 && (this.#maxEnds[count - 1] ?? -1) >= range.end;
  }
}

function skipped(
  syntax: MarkdownSyntax,
  reason: PrepareSkipReason,
  failure?: MarkdownParseFailure,
): SkippedDoc {
  return {
    kind: "skipped",
    syntax,
    reason,
    message: failure?.message,
    line: failure?.line,
    column: failure?.column,
  };
}

function prepareSentences(
  unit: ProseUnit,
  index: { ignored: RangeIndex; html: RangeIndex },
  lines: SourceLines,
): PreparedSentence[] {
  const kept: PreparedSentence[] = [];
  for (const sentence of unit.sentences) {
    if (index.ignored.overlaps(sentence.source)) {
      continue;
    }
    if (index.html.contains(sentence.source)) {
      continue;
    }
    kept.push(preparedSentence(unit.masked, sentence, lines));
  }
  return kept;
}

function preparedSentence(
  masked: MaskedText,
  sentence: Sentence,
  lines: SourceLines,
): PreparedSentence {
  return {
    text: sentence.text,
    maskedStart: sentence.maskedStart,
    maskedEnd: sentence.maskedEnd,
    source: sentence.source,
    start: lines.at(sentence.source.start),
    end: lines.at(sentence.source.end),
    tokens: tokenizeSentence(masked, sentence),
  };
}

function findTitle(
  units: readonly ProseUnit[],
  parsed: ParsedMarkdown,
  data: FrontmatterData | undefined,
): PreparedTitle | undefined {
  for (const unit of units) {
    if (unit.block.type === "heading" && unit.block.depth === 1) {
      const line = unit.block.position?.start.line;
      if (line !== undefined) {
        return { from: "h1", text: unit.masked.text.trim(), line };
      }
    }
  }
  if (data !== undefined && parsed.frontmatter !== undefined) {
    const text = frontmatterTitle(data);
    if (text !== undefined) {
      return {
        from: "frontmatter",
        text,
        line: parsed.frontmatter.position.start.line,
      };
    }
  }
  return undefined;
}

function buildWarnings(
  data: FrontmatterData | undefined,
  ignoreWarnings: readonly IgnoreWarning[],
): PrepareWarning[] {
  const warnings: PrepareWarning[] = [];
  for (const warning of data?.warnings ?? []) {
    warnings.push({
      from: "frontmatter",
      code: warning.code,
      line: warning.line,
    });
  }
  for (const warning of ignoreWarnings) {
    warnings.push({
      from: "ignore",
      code: warning.code,
      line: warning.line,
      column: warning.column,
    });
  }
  return warnings;
}

function prepareParsed(
  parsed: ParsedMarkdown,
  options: PrepareOptions,
): PrepareResult {
  const data =
    parsed.frontmatter === undefined
      ? undefined
      : readFrontmatter(parsed.frontmatter);
  if (data !== undefined && isNonEnglish(data)) {
    return skipped(parsed.syntax, "non-english");
  }

  const scan = findIgnoredRanges(parsed);
  const index = {
    ignored: new RangeIndex(scan.ignored.filter((r) => r.checks.length === 0)),
    html: new RangeIndex(scan.htmlRanges),
  };
  const lines = new SourceLines(parsed.source);

  const units = collectProseBlocks(parsed.tree).map((block) =>
    proseUnit(block, parsed, options),
  );
  const blocks: PreparedBlock[] = [];
  for (const unit of units) {
    const sentences = prepareSentences(unit, index, lines);
    if (sentences.length > 0) {
      blocks.push({
        kind: unit.kind,
        node: unit.block,
        masked: unit.masked,
        sentences,
      });
    }
  }

  return {
    kind: "prepared",
    syntax: parsed.syntax,
    parsed,
    frontmatter: data,
    title: findTitle(units, parsed, data),
    blocks,
    checkIgnores: scan.ignored.filter((r) => r.checks.length > 0),
    warnings: buildWarnings(data, scan.warnings),
    moreWarnings: scan.moreWarnings,
  };
}

/** Prepares one doc for the checks. Never throws. */
export function prepareDoc(
  text: string,
  syntax: MarkdownSyntax,
  options: PrepareOptions = {},
): PrepareResult {
  try {
    const parsed = parseMarkdown(text, syntax);
    if (parsed.kind === "failed") {
      return skipped(syntax, parsed.problem, parsed);
    }
    return prepareParsed(parsed, options);
  } catch {
    return skipped(syntax, "preparation-error");
  }
}
