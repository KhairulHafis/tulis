/**
 * A small file-pattern matcher that never uses regular expressions and never
 * backtracks, so a crafted pattern or path cannot freeze Tulis.
 *
 * Method:
 * 1. Parse the pattern into a small tree of nodes (a character, `?`, `*`,
 *    a class, the three `**` forms, and an alternation for `{a,b}`).
 * 2. Build a list of states from the tree, Thompson style. Every node adds a
 *    fixed number of states, so the state count grows only with the pattern
 *    length. A branch of `{a,b}` is built once and all branches share the same
 *    continuation, so braces are never expanded into a list.
 * 3. To match, walk the path once, keeping the set of active states. Each
 *    step costs at most the number of states, so a match costs at most
 *    (path length + 1) times the number of states.
 *
 * Recursion happens only over the pattern tree (patterns are short), never
 * over the path.
 */

export type GlobProblem = "extended-pattern" | "posix-class" | "reversed-range";

export class GlobError extends Error {
  readonly problem: GlobProblem;

  constructor(problem: GlobProblem) {
    super(`Unsupported pattern syntax: ${problem}.`);
    this.name = "GlobError";
    this.problem = problem;
  }
}

export interface CompiledGlob {
  readonly glob: string;
  /** The fixed folders before the first special character, ending in "/", or "" when the pattern starts with one. */
  readonly base: string;
  matches(path: string): boolean;
}

const SLASH = 0x2f;
const STAR = 0x2a;
const QUESTION = 0x3f;
const OPEN_BRACKET = 0x5b;
const CLOSE_BRACKET = 0x5d;
const OPEN_BRACE = 0x7b;
const CLOSE_BRACE = 0x7d;
const COMMA = 0x2c;
const OPEN_PAREN = 0x28;
const BANG = 0x21;
const CARET = 0x5e;
const DASH = 0x2d;
const COLON = 0x3a;
/** Characters that start an extended pattern when followed by `(`: `*`, `?`, `+`, `@`, `!`. */
const EXTENDED_STARTS: readonly number[] = [STAR, QUESTION, 0x2b, 0x40, BANG];

// ---------------------------------------------------------------- the tree

interface CharNode {
  readonly kind: "char";
  readonly code: number;
}
interface AnyNode {
  readonly kind: "any";
}
interface StarNode {
  readonly kind: "star";
}
interface ClassNode {
  readonly kind: "class";
  readonly negated: boolean;
  readonly singles: readonly number[];
  readonly ranges: readonly (readonly [number, number])[];
}
/** `**` followed by `/` as whole segments: zero or more folders, `(.*\/)?`. */
interface GlobSlashNode {
  readonly kind: "globSlash";
}
/** `/**` at the end: nothing, or `/` and anything, `(\/.*)?`. */
interface GlobTailNode {
  readonly kind: "globTail";
}
/** A lone `**` segment with no `/` next to it: one or more characters. */
interface GlobAllNode {
  readonly kind: "globAll";
}
interface AltNode {
  readonly kind: "alt";
  readonly branches: readonly (readonly Node[])[];
}
type Node =
  | CharNode
  | AnyNode
  | StarNode
  | ClassNode
  | GlobSlashNode
  | GlobTailNode
  | GlobAllNode
  | AltNode;

// ------------------------------------------------------------------ parsing

interface Group {
  readonly close: number;
  /** Positions of the commas at this group's own level. */
  readonly commas: readonly number[];
}

/**
 * The index of the `]` that closes the class opened at `start`, or -1 when
 * there is none before the end of the segment (then `[` is a literal).
 */
function findClassEnd(cps: readonly number[], start: number): number {
  let at = start + 1;
  const first = cps[at];
  if (first === BANG || first === CARET) {
    at += 1;
  }
  // A `]` right after `[`, `[!` or `[^` is a member, not the end.
  if (cps[at] === CLOSE_BRACKET) {
    at += 1;
  }
  for (; at < cps.length; at += 1) {
    const code = cps[at];
    if (code === SLASH) {
      return -1;
    }
    if (code === CLOSE_BRACKET) {
      return at;
    }
  }
  return -1;
}

/**
 * Finds every `{...}` that is a real alternation: it has a closing `}` and at
 * least one comma at its own level. Classes are skipped whole, so a `,` or `}`
 * inside `[...]` is not seen. One pass with a stack of open braces.
 */
function findGroups(cps: readonly number[]): Map<number, Group> {
  const groups = new Map<number, Group>();
  const open: { readonly at: number; readonly commas: number[] }[] = [];
  let at = 0;
  while (at < cps.length) {
    const code = cps[at];
    if (code === OPEN_BRACKET) {
      const end = findClassEnd(cps, at);
      if (end !== -1) {
        at = end + 1;
        continue;
      }
    } else if (code === OPEN_BRACE) {
      open.push({ at, commas: [] });
    } else if (code === COMMA) {
      open[open.length - 1]?.commas.push(at);
    } else if (code === CLOSE_BRACE) {
      const group = open.pop();
      if (group !== undefined && group.commas.length > 0) {
        groups.set(group.at, { close: at, commas: group.commas });
      }
    }
    at += 1;
  }
  return groups;
}

class Parser {
  private readonly groups: Map<number, Group>;

  constructor(private readonly cps: readonly number[]) {
    this.groups = findGroups(cps);
  }

  parse(): Node[] {
    return this.sequence(0, this.cps.length, true, true);
  }

  /** The members of the class whose contents are `cps[from, to)`. */
  private parseClass(from: number, to: number, negated: boolean): ClassNode {
    const cps = this.cps;
    for (let at = from; at + 1 < to; at += 1) {
      if (cps[at] === OPEN_BRACKET && cps[at + 1] === COLON) {
        throw new GlobError("posix-class");
      }
    }
    const singles: number[] = [];
    const ranges: (readonly [number, number])[] = [];
    let at = from;
    while (at < to) {
      const low = cps[at] ?? 0;
      // `a-z` is a range; a `-` first or last is a plain member.
      if (cps[at + 1] === DASH && at + 2 < to) {
        const high = cps[at + 2] ?? 0;
        if (high < low) {
          throw new GlobError("reversed-range");
        }
        ranges.push([low, high]);
        at += 3;
      } else {
        singles.push(low);
        at += 1;
      }
    }
    return { kind: "class", negated, singles, ranges };
  }

  /**
   * Parses `cps[from, to)`. `atStart` and `atEnd` say whether the range begins
   * and ends at a segment edge of the whole pattern, which decides whether a
   * `**` is a whole segment.
   */
  private sequence(
    from: number,
    to: number,
    atStart: boolean,
    atEnd: boolean,
  ): Node[] {
    const cps = this.cps;
    const out: Node[] = [];
    let at = from;
    while (at < to) {
      const code = cps[at] ?? 0;

      if (code === STAR) {
        let end = at;
        while (end < to && cps[end] === STAR) {
          end += 1;
        }
        if (cps[end] === OPEN_PAREN) {
          throw new GlobError("extended-pattern");
        }
        const startsSegment = at === from ? atStart : cps[at - 1] === SLASH;
        if (end - at === 2 && startsSegment) {
          if (end < to && cps[end] === SLASH) {
            out.push({ kind: "globSlash" });
            at = end + 1;
            continue;
          }
          if (end === to && atEnd) {
            const last = out[out.length - 1];
            if (last?.kind === "char" && last.code === SLASH) {
              out.pop();
              out.push({ kind: "globTail" });
            } else {
              out.push({ kind: "globAll" });
            }
            at = end;
            continue;
          }
        }
        // A single `*`, `**` inside a segment, or a longer run: one star.
        out.push({ kind: "star" });
        at = end;
        continue;
      }

      if (EXTENDED_STARTS.includes(code) && cps[at + 1] === OPEN_PAREN) {
        throw new GlobError("extended-pattern");
      }

      if (code === QUESTION) {
        out.push({ kind: "any" });
        at += 1;
        continue;
      }

      if (code === OPEN_BRACKET) {
        const end = findClassEnd(cps, at);
        if (end !== -1) {
          const first = cps[at + 1];
          const negated = first === BANG || first === CARET;
          out.push(this.parseClass(at + (negated ? 2 : 1), end, negated));
          at = end + 1;
          continue;
        }
      }

      if (code === OPEN_BRACE) {
        const group = this.groups.get(at);
        if (group !== undefined) {
          const startsSegment = at === from ? atStart : cps[at - 1] === SLASH;
          const endsSegment =
            group.close + 1 === to ? atEnd : cps[group.close + 1] === SLASH;
          const starts = [at + 1, ...group.commas.map((comma) => comma + 1)];
          const ends = [...group.commas, group.close];
          out.push({
            kind: "alt",
            branches: starts.map((start, index) =>
              this.sequence(
                start,
                ends[index] ?? start,
                startsSegment,
                endsSegment,
              ),
            ),
          });
          at = group.close + 1;
          continue;
        }
      }

      // Everything else, including a `{`, `}`, `,`, `(`, `)`, `|`, `]` or
      // `[` that has no special meaning here, is a plain character.
      out.push({ kind: "char", code });
      at += 1;
    }
    return out;
  }
}

// ------------------------------------------------------------------- states

interface CharState {
  readonly kind: "char";
  readonly code: number;
  next: number;
}
/** One character except `/`. */
interface AnyState {
  readonly kind: "any";
  next: number;
}
/** `*`: any run of non-slash characters. Reads one and stays here, and can also leave to `next` without reading. */
interface StarState {
  readonly kind: "star";
  readonly next: number;
}
/** One character, `/` included. */
interface AnySlashState {
  readonly kind: "anySlash";
  next: number;
}
interface ClassState {
  readonly kind: "class";
  readonly negated: boolean;
  readonly singles: readonly number[];
  readonly ranges: readonly (readonly [number, number])[];
  next: number;
}
/** Moves to either state without reading a character. */
interface SplitState {
  readonly kind: "split";
  readonly first: number;
  readonly second: number;
}
interface MatchState {
  readonly kind: "match";
}
type State =
  | CharState
  | AnyState
  | StarState
  | AnySlashState
  | ClassState
  | SplitState
  | MatchState;

function classMatches(state: ClassState, code: number): boolean {
  let found = state.singles.includes(code);
  for (const [low, high] of state.ranges) {
    if (found) {
      break;
    }
    found = code >= low && code <= high;
  }
  return found !== state.negated;
}

class StateBuilder {
  readonly states: State[] = [];

  add<T extends State>(state: T): T {
    this.states.push(state);
    return state;
  }

  split(first: number, second: number): number {
    this.add({ kind: "split", first, second });
    return this.states.length - 1;
  }

  /** A consuming state; its `next` can be set later. Returns the state and its id. */
  loopState(kind: "any" | "anySlash"): {
    state: AnyState | AnySlashState;
    id: number;
  } {
    const state = this.add<AnyState | AnySlashState>({ kind, next: -1 });
    return { state, id: this.states.length - 1 };
  }

  /** Builds `nodes` so that they continue into `next`. Returns the first state. */
  sequence(nodes: readonly Node[], next: number): number {
    let entry = next;
    for (let index = nodes.length - 1; index >= 0; index -= 1) {
      const node = nodes[index];
      if (node !== undefined) {
        entry = this.node(node, entry);
      }
    }
    return entry;
  }

  private node(node: Node, next: number): number {
    switch (node.kind) {
      case "char":
        this.add({ kind: "char", code: node.code, next });
        return this.states.length - 1;
      case "any":
        this.add({ kind: "any", next });
        return this.states.length - 1;
      case "class":
        this.add({
          kind: "class",
          negated: node.negated,
          singles: node.singles,
          ranges: node.ranges,
          next,
        });
        return this.states.length - 1;
      case "star": {
        this.add({ kind: "star", next });
        return this.states.length - 1;
      }
      case "globSlash": {
        // entry: skip, or read any characters and then a `/`.
        this.add({ kind: "char", code: SLASH, next });
        const slashId = this.states.length - 1;
        const loop = this.loopState("anySlash");
        const body = this.split(loop.id, slashId);
        loop.state.next = body;
        return this.split(next, body);
      }
      case "globTail": {
        // entry: leave, or read `/` and then any characters.
        const loop = this.loopState("anySlash");
        const rest = this.split(next, loop.id);
        loop.state.next = rest;
        this.add({ kind: "char", code: SLASH, next: rest });
        const slashId = this.states.length - 1;
        return this.split(next, slashId);
      }
      case "globAll": {
        // One or more characters of any kind.
        const loop = this.loopState("anySlash");
        const rest = this.split(next, loop.id);
        loop.state.next = rest;
        return loop.id;
      }
      case "alt": {
        // Every branch continues into the same `next`.
        const entries = node.branches.map((branch) =>
          this.sequence(branch, next),
        );
        let entry = entries[entries.length - 1] ?? next;
        for (let index = entries.length - 2; index >= 0; index -= 1) {
          entry = this.split(entries[index] ?? next, entry);
        }
        return entry;
      }
    }
  }
}

// ----------------------------------------------------------------- matching

const KIND_CHAR = 0;
const KIND_ANY = 1;
const KIND_ANY_SLASH = 2;
const KIND_CLASS = 3;
const KIND_SPLIT = 4;
const KIND_MATCH = 5;
const KIND_STAR = 6;

/**
 * The states in flat arrays, which keeps the inner loop fast. For a split,
 * `first` and `second` are its two targets. For other states, `first` is the
 * character code and `second` is the next state.
 */
interface Program {
  readonly kinds: Uint8Array;
  readonly first: Int32Array;
  readonly second: Int32Array;
  /** The class of each class state (undefined for the other kinds). */
  readonly classes: readonly (ClassState | undefined)[];
}

function flatten(states: readonly State[]): Program {
  const kinds = new Uint8Array(states.length);
  const first = new Int32Array(states.length);
  const second = new Int32Array(states.length);
  const classes: (ClassState | undefined)[] = [];
  states.forEach((state, id) => {
    classes.push(state.kind === "class" ? state : undefined);
    switch (state.kind) {
      case "char":
        kinds[id] = KIND_CHAR;
        first[id] = state.code;
        second[id] = state.next;
        break;
      case "any":
        kinds[id] = KIND_ANY;
        second[id] = state.next;
        break;
      case "star":
        kinds[id] = KIND_STAR;
        second[id] = state.next;
        break;
      case "anySlash":
        kinds[id] = KIND_ANY_SLASH;
        second[id] = state.next;
        break;
      case "class":
        kinds[id] = KIND_CLASS;
        second[id] = state.next;
        break;
      case "split":
        kinds[id] = KIND_SPLIT;
        first[id] = state.first;
        second[id] = state.second;
        break;
      case "match":
        kinds[id] = KIND_MATCH;
        break;
    }
  });
  return { kinds, first, second, classes };
}

/** A set of state ids with O(1) add, built to be reused step after step. */
class ActiveSet {
  readonly ids: Uint32Array;
  size = 0;
  private readonly seen: Uint32Array;
  private stamp = 0;

  constructor(count: number) {
    this.ids = new Uint32Array(count);
    this.seen = new Uint32Array(count);
  }

  clear(): void {
    this.size = 0;
    this.stamp += 1;
  }

  has(id: number): boolean {
    return this.seen[id] === this.stamp;
  }

  /** Adds `start` and everything reachable from it through splits. `stack` is scratch space. */
  addWithSplits(program: Program, start: number, stack: Uint32Array): void {
    if (this.has(start)) {
      return;
    }
    const { kinds, first, second } = program;
    let top = 0;
    this.seen[start] = this.stamp;
    stack[top] = start;
    top += 1;
    while (top > 0) {
      top -= 1;
      const id = stack[top] ?? 0;
      if (kinds[id] === KIND_SPLIT) {
        const one = first[id] ?? 0;
        const two = second[id] ?? 0;
        if (!this.has(one)) {
          this.seen[one] = this.stamp;
          stack[top] = one;
          top += 1;
        }
        if (!this.has(two)) {
          this.seen[two] = this.stamp;
          stack[top] = two;
          top += 1;
        }
      } else {
        this.ids[this.size] = id;
        this.size += 1;
        if (kinds[id] === KIND_STAR) {
          // A star can also leave without reading a character.
          const out = second[id] ?? 0;
          if (!this.has(out)) {
            this.seen[out] = this.stamp;
            stack[top] = out;
            top += 1;
          }
        }
      }
    }
  }
}

/** The leading plain characters of the pattern, cut after the last `/`. */
function baseOf(nodes: readonly Node[]): string {
  let prefix = "";
  for (const node of nodes) {
    if (node.kind === "char") {
      prefix += String.fromCodePoint(node.code);
    } else {
      if (node.kind === "globTail") {
        prefix += "/";
      }
      break;
    }
  }
  return prefix.slice(0, prefix.lastIndexOf("/") + 1);
}

/** Compiles `glob`. Throws GlobError for syntax we don't support. Meant for patterns of up to a few hundred characters. */
export function compileGlob(glob: string): CompiledGlob {
  const cps = Array.from(glob, (char) => char.codePointAt(0) ?? 0);
  const nodes = new Parser(cps).parse();

  const builder = new StateBuilder();
  builder.add({ kind: "match" });
  const matchId = 0;
  const start = builder.sequence(nodes, matchId);
  const program = flatten(builder.states);
  const count = builder.states.length;

  return Object.freeze({
    glob,
    base: baseOf(nodes),
    matches(path: string): boolean {
      const { kinds, first, second, classes } = program;
      let current = new ActiveSet(count);
      let following = new ActiveSet(count);
      const stack = new Uint32Array(count);
      current.clear();
      current.addWithSplits(program, start, stack);

      let at = 0;
      while (at < path.length && current.size > 0) {
        const code = path.codePointAt(at) ?? 0;
        at += code > 0xffff ? 2 : 1;
        following.clear();
        for (let index = 0; index < current.size; index += 1) {
          const id = current.ids[index] ?? 0;
          const kind = kinds[id];
          let ok = false;
          if (kind === KIND_CHAR) {
            ok = first[id] === code;
          } else if (kind === KIND_ANY || kind === KIND_STAR) {
            ok = code !== SLASH;
          } else if (kind === KIND_ANY_SLASH) {
            ok = true;
          } else if (kind === KIND_CLASS) {
            const group = classes[id];
            ok =
              code !== SLASH &&
              group !== undefined &&
              classMatches(group, code);
          }
          if (ok) {
            // A star stays where it is; every other state moves on.
            const target = kind === KIND_STAR ? id : (second[id] ?? 0);
            if (!following.has(target)) {
              following.addWithSplits(program, target, stack);
            }
          }
        }
        const swap = current;
        current = following;
        following = swap;
      }
      return at >= path.length && current.has(matchId);
    },
  });
}

/** The problem compileGlob would throw for, or undefined when the pattern is supported. */
export function findGlobProblem(glob: string): GlobProblem | undefined {
  try {
    compileGlob(glob);
    return undefined;
  } catch (error) {
    if (error instanceof GlobError) {
      return error.problem;
    }
    throw error;
  }
}
