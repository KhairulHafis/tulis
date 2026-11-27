import { isCheckId } from "../check-id.js";
import type { SourceRange } from "../markdown/ignored-ranges.js";
import { SourceLines } from "../markdown/source-lines.js";
import type { PreparedDoc } from "../prepare/prepare-doc.js";
import type { Extractor } from "./extractor.js";
import {
  MAX_EVIDENCE_LENGTH,
  MAX_OBSERVATIONS_PER_EXTRACTOR,
  MAX_OBSERVATION_VALUE_LENGTH,
  type Finding,
  type Observation,
} from "./observation.js";
import type { ExtractorRegistry } from "./registry.js";

export type ExtractionProblemKind = "threw" | "bad-finding" | "too-many";

export interface ExtractionProblem {
  readonly extractorId: string;
  readonly kind: ExtractionProblemKind;
  readonly count: number;
}

export interface ExtractionResult {
  readonly observations: readonly Observation[];
  readonly problems: readonly ExtractionProblem[];
}

const EVIDENCE_LEAD = 100;

function isHighSurrogate(code: number): boolean {
  return code >= 0xd800 && code <= 0xdbff;
}

function isLowSurrogate(code: number): boolean {
  return code >= 0xdc00 && code <= 0xdfff;
}

function hasControlCharacter(value: string): boolean {
  for (let i = 0; i < value.length; i++) {
    const code = value.charCodeAt(i);
    if (code < 0x20 || code === 0x7f) {
      return true;
    }
  }
  return false;
}

/** Reads a returned value as a finding, or undefined when it has no shape. */
function readFinding(value: unknown): Finding | undefined {
  if (
    typeof value !== "object" ||
    value === null ||
    !("dimension" in value) ||
    !("value" in value) ||
    !("range" in value)
  ) {
    return undefined;
  }
  const { dimension, range } = value;
  const answer = value.value;
  if (
    typeof dimension !== "string" ||
    typeof answer !== "string" ||
    typeof range !== "object" ||
    range === null ||
    !("start" in range) ||
    !("end" in range)
  ) {
    return undefined;
  }
  const { start, end } = range;
  if (typeof start !== "number" || typeof end !== "number") {
    return undefined;
  }
  return { dimension, value: answer, range: { start, end } };
}

function isGoodFinding(
  extractorId: string,
  finding: Finding,
  sourceLength: number,
  unit: SourceRange | undefined,
): boolean {
  const { dimension, value, range } = finding;
  if (
    !isCheckId(dimension) ||
    dimension.split(".")[0] !== extractorId.split(".")[0]
  ) {
    return false;
  }
  if (
    value.length === 0 ||
    value.length > MAX_OBSERVATION_VALUE_LENGTH ||
    hasControlCharacter(value)
  ) {
    return false;
  }
  if (
    !Number.isInteger(range.start) ||
    !Number.isInteger(range.end) ||
    range.start < 0 ||
    range.start > range.end ||
    range.end > sourceLength
  ) {
    return false;
  }
  return (
    unit === undefined || (range.start >= unit.start && range.end <= unit.end)
  );
}

function evidenceFor(
  source: string,
  unit: SourceRange,
  rangeStart: number,
): string {
  let start = unit.start;
  let end = unit.end;
  if (end - start > MAX_EVIDENCE_LENGTH) {
    start = Math.max(unit.start, rangeStart - EVIDENCE_LEAD);
    end = Math.min(unit.end, start + MAX_EVIDENCE_LENGTH);
    if (
      start > unit.start &&
      isLowSurrogate(source.charCodeAt(start)) &&
      isHighSurrogate(source.charCodeAt(start - 1))
    ) {
      start += 1;
    }
    if (
      end < unit.end &&
      isHighSurrogate(source.charCodeAt(end - 1)) &&
      isLowSurrogate(source.charCodeAt(end))
    ) {
      end -= 1;
    }
  }
  return source.slice(start, end).replace(/\s+/g, " ").trim();
}

interface Outcome {
  readonly observations: Observation[];
  bad: number;
  tooMany: number;
}

function runOne(
  extractor: Extractor,
  doc: PreparedDoc,
  lines: SourceLines,
  outcome: Outcome,
): void {
  const source = doc.parsed.source;

  const accept = (returned: unknown, unit: SourceRange | undefined): void => {
    if (!Array.isArray(returned)) {
      throw new TypeError("An extractor did not return a list.");
    }
    const items: unknown[] = returned;
    for (const item of items) {
      const finding = readFinding(item);
      if (
        finding === undefined ||
        !isGoodFinding(extractor.id, finding, source.length, unit)
      ) {
        outcome.bad += 1;
        continue;
      }
      if (outcome.observations.length >= MAX_OBSERVATIONS_PER_EXTRACTOR) {
        outcome.tooMany += 1;
        continue;
      }
      const { range } = finding;
      outcome.observations.push({
        dimension: finding.dimension,
        value: finding.value,
        range: { start: range.start, end: range.end },
        line: lines.at(range.start).line,
        text: evidenceFor(source, unit ?? range, range.start),
      });
    }
  };

  if (extractor.scope === "document") {
    accept(extractor.extract(doc), undefined);
    return;
  }
  for (const block of doc.blocks) {
    if (
      extractor.blockKinds !== undefined &&
      !extractor.blockKinds.includes(block.kind)
    ) {
      continue;
    }
    const start = block.node.position?.start.offset;
    const end = block.node.position?.end.offset;
    if (start === undefined || end === undefined) {
      continue;
    }
    if (extractor.scope === "block") {
      accept(extractor.extract(block, { doc }), { start, end });
      continue;
    }
    for (const sentence of block.sentences) {
      accept(extractor.extract(sentence, { doc, block }), sentence.source);
    }
  }
}

function compareObservations(a: Observation, b: Observation): number {
  if (a.range.start !== b.range.start) {
    return a.range.start - b.range.start;
  }
  if (a.range.end !== b.range.end) {
    return a.range.end - b.range.end;
  }
  if (a.dimension !== b.dimension) {
    return a.dimension < b.dimension ? -1 : 1;
  }
  if (a.value !== b.value) {
    return a.value < b.value ? -1 : 1;
  }
  return 0;
}

/** Applies every registered extractor to a prepared doc. Plain data out. */
export function runExtractors(
  registry: ExtractorRegistry,
  doc: PreparedDoc,
): ExtractionResult {
  const lines = new SourceLines(doc.parsed.source);
  const observations: Observation[] = [];
  const problems: ExtractionProblem[] = [];

  for (const extractor of registry.extractors) {
    const outcome: Outcome = { observations: [], bad: 0, tooMany: 0 };
    try {
      runOne(extractor, doc, lines, outcome);
    } catch {
      // The error may hold doc text, so it is never kept.
      problems.push({ extractorId: extractor.id, kind: "threw", count: 1 });
      continue;
    }
    if (outcome.bad > 0) {
      problems.push({
        extractorId: extractor.id,
        kind: "bad-finding",
        count: outcome.bad,
      });
    }
    if (outcome.tooMany > 0) {
      problems.push({
        extractorId: extractor.id,
        kind: "too-many",
        count: outcome.tooMany,
      });
    }
    observations.push(...outcome.observations);
  }

  observations.sort(compareObservations);
  return { observations, problems };
}
