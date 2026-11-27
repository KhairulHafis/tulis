import type { ProseUnitKind } from "../markdown/prose-units.js";
import type {
  PreparedBlock,
  PreparedDoc,
  PreparedSentence,
} from "../prepare/prepare-doc.js";
import type { Finding } from "./observation.js";

export type ExtractorScope = "document" | "block" | "sentence";

export interface BlockContext {
  readonly doc: PreparedDoc;
}

export interface SentenceContext {
  readonly doc: PreparedDoc;
  readonly block: PreparedBlock;
}

/** Runs once per doc. Pure: prepared doc in, findings out. */
export interface DocumentExtractor {
  readonly id: string;
  readonly scope: "document";
  extract(doc: PreparedDoc): readonly Finding[];
}

/** Runs once per block whose kind is in `blockKinds` (all when left out). */
export interface BlockExtractor {
  readonly id: string;
  readonly scope: "block";
  readonly blockKinds?: readonly ProseUnitKind[];
  extract(block: PreparedBlock, ctx: BlockContext): readonly Finding[];
}

/** Runs once per sentence of each block whose kind is in `blockKinds`. */
export interface SentenceExtractor {
  readonly id: string;
  readonly scope: "sentence";
  readonly blockKinds?: readonly ProseUnitKind[];
  extract(sentence: PreparedSentence, ctx: SentenceContext): readonly Finding[];
}

export type Extractor = DocumentExtractor | BlockExtractor | SentenceExtractor;
