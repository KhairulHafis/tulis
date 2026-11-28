import type { List, ListItem, Root, RootContent } from "mdast";
import type { SourceRange } from "../markdown/ignored-ranges.js";
import {
  type PreparedBlock,
  type PreparedDoc,
  type PreparedSentence,
} from "../prepare/prepare-doc.js";
import { sentenceTags } from "../prepare/sentence-tags.js";
import { readStepNumber } from "./numbering.js";
import { stepStart, type StepStart } from "./step-start.js";

export interface ProcedureStep {
  readonly block: PreparedBlock | undefined;
  readonly firstSentence: PreparedSentence | undefined;
  readonly number: number | undefined;
  readonly start: StepStart | undefined;
}

export interface Procedure {
  readonly range: SourceRange;
  readonly nested: boolean;
  readonly steps: readonly ProcedureStep[];
  readonly before: PreparedBlock | undefined;
}

/** A node still to visit, with what its parent knows about it. */
interface Visit {
  readonly node: Root | RootContent;
  readonly insideItem: boolean;
  /** Offset of the previous sibling, when it has one. */
  readonly previousOffset: number | undefined;
}

const cache = new WeakMap<PreparedDoc, readonly Procedure[]>();

function offsetOf(node: Root | RootContent): number | undefined {
  return node.position?.start.offset;
}

function blocksByOffset(doc: PreparedDoc): Map<number, PreparedBlock> {
  const map = new Map<number, PreparedBlock>();
  for (const block of doc.blocks) {
    const offset = block.node.position?.start.offset;
    if (offset !== undefined) {
      map.set(offset, block);
    }
  }
  return map;
}

function buildStep(
  item: ListItem,
  doc: PreparedDoc,
  blocks: ReadonlyMap<number, PreparedBlock>,
): ProcedureStep {
  const firstChild = item.children[0];
  const childOffset =
    firstChild === undefined ? undefined : offsetOf(firstChild);
  const found = childOffset === undefined ? undefined : blocks.get(childOffset);
  const block = found?.kind === "paragraph" ? found : undefined;
  const firstSentence = block?.sentences[0];
  const itemOffset = offsetOf(item);
  return {
    block,
    firstSentence,
    number:
      itemOffset === undefined
        ? undefined
        : readStepNumber(doc.parsed.source, itemOffset),
    start:
      firstSentence === undefined
        ? undefined
        : stepStart(firstSentence.tokens, sentenceTags(firstSentence)),
  };
}

/** At least one judged step, and at least half of the judged steps imperative. */
function isProcedure(steps: readonly ProcedureStep[]): boolean {
  let judged = 0;
  let imperative = 0;
  for (const step of steps) {
    if (step.start !== undefined) {
      judged += 1;
      if (step.start === "imperative") {
        imperative += 1;
      }
    }
  }
  return judged > 0 && 2 * imperative >= judged;
}

function buildProcedure(
  list: List,
  visit: Visit,
  doc: PreparedDoc,
  blocks: ReadonlyMap<number, PreparedBlock>,
): Procedure | undefined {
  const steps = list.children.map((item) => buildStep(item, doc, blocks));
  const start = list.position?.start.offset;
  const end = list.position?.end.offset;
  if (start === undefined || end === undefined || !isProcedure(steps)) {
    return undefined;
  }
  let before: PreparedBlock | undefined;
  if (!visit.insideItem && visit.previousOffset !== undefined) {
    const candidate = blocks.get(visit.previousOffset);
    if (candidate?.kind === "paragraph" || candidate?.kind === "heading") {
      before = candidate;
    }
  }
  return {
    range: { start, end },
    nested: visit.insideItem,
    steps,
    before,
  };
}

function findUncached(doc: PreparedDoc): Procedure[] {
  const blocks = blocksByOffset(doc);
  const procedures: Procedure[] = [];
  const stack: Visit[] = [
    { node: doc.parsed.tree, insideItem: false, previousOffset: undefined },
  ];
  for (let visit = stack.pop(); visit !== undefined; visit = stack.pop()) {
    const node = visit.node;
    const type: string = node.type;
    if (type === "mdxJsxFlowElement") {
      continue;
    }
    if (node.type === "list" && node.ordered === true) {
      const procedure = buildProcedure(node, visit, doc, blocks);
      if (procedure !== undefined) {
        procedures.push(procedure);
      }
    }
    if (!("children" in node)) {
      continue;
    }
    const insideItem = visit.insideItem || type === "listItem";
    const children: readonly RootContent[] = node.children;
    for (let i = children.length - 1; i >= 0; i--) {
      const child = children[i];
      if (child !== undefined) {
        const previous = children[i - 1];
        stack.push({
          node: child,
          insideItem,
          previousOffset:
            previous === undefined ? undefined : offsetOf(previous),
        });
      }
    }
  }
  return procedures;
}

/** The procedures in a doc, in document order. Cached per prepared doc. */
export function findProcedures(doc: PreparedDoc): readonly Procedure[] {
  let found = cache.get(doc);
  if (found === undefined) {
    found = findUncached(doc);
    cache.set(doc, found);
  }
  return found;
}
