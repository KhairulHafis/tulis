import { describe, expect, it } from "vitest";
import { prepareDoc, type PreparedDoc } from "../prepare/prepare-doc.js";
import type {
  BlockExtractor,
  DocumentExtractor,
  Extractor,
  SentenceExtractor,
} from "./extractor.js";
import {
  MAX_EVIDENCE_LENGTH,
  MAX_OBSERVATIONS_PER_EXTRACTOR,
  MAX_OBSERVATION_VALUE_LENGTH,
  type Finding,
} from "./observation.js";
import { createExtractorRegistry } from "./registry.js";
import { runExtractors } from "./run-extractors.js";

function prepared(text: string): PreparedDoc {
  const result = prepareDoc(text, "markdown");
  if (result.kind !== "prepared") {
    throw new Error("expected a prepared doc, got " + result.reason);
  }
  return result;
}

function run(doc: PreparedDoc, ...extractors: Extractor[]) {
  return runExtractors(createExtractorRegistry(extractors), doc);
}

const endsWithPeriod: SentenceExtractor = {
  id: "sentence.period",
  scope: "sentence",
  extract: (sentence) => [
    {
      dimension: "sentence.period",
      value: sentence.text.endsWith(".") ? "yes" : "no",
      range: sentence.source,
    },
  ],
};

const headingDepth: BlockExtractor = {
  id: "heading.depth",
  scope: "block",
  blockKinds: ["heading"],
  extract: (block) => [
    {
      dimension: "heading.depth",
      value: block.node.type === "heading" ? String(block.node.depth) : "?",
      range: {
        start: block.node.position?.start.offset ?? 0,
        end: block.node.position?.end.offset ?? 0,
      },
    },
  ],
};

const blockCount: DocumentExtractor = {
  id: "doc.blocks",
  scope: "document",
  extract: (doc) => [
    {
      dimension: "doc.blocks",
      value: String(doc.blocks.length),
      range: { start: 0, end: Math.min(5, doc.parsed.source.length) },
    },
  ],
};

/** A sentence extractor that returns the given findings for every sentence. */
function fixed(id: string, findings: readonly Finding[]): SentenceExtractor {
  return { id, scope: "sentence", extract: () => findings };
}

const DOC = "# Title here\n\nOne fine day.\nNo stop here\n";

describe("sample extractors", () => {
  it("runs a sentence extractor on each sentence", () => {
    const doc = prepared(DOC);
    const { observations, problems } = run(doc, endsWithPeriod);
    expect(problems).toEqual([]);
    expect(observations).toEqual([
      {
        dimension: "sentence.period",
        value: "no",
        range: { start: 2, end: 12 },
        line: 1,
        text: "Title here",
      },
      {
        dimension: "sentence.period",
        value: "yes",
        range: { start: 14, end: 27 },
        line: 3,
        text: "One fine day.",
      },
      {
        dimension: "sentence.period",
        value: "no",
        range: { start: 28, end: 40 },
        line: 4,
        text: "No stop here",
      },
    ]);
  });

  it("runs a block extractor on headings only", () => {
    const { observations } = run(
      prepared("## Two\n\nBody text.\n"),
      headingDepth,
    );
    expect(observations).toEqual([
      {
        dimension: "heading.depth",
        value: "2",
        range: { start: 0, end: 6 },
        line: 1,
        text: "## Two",
      },
    ]);
  });

  it("runs a document extractor once", () => {
    const { observations } = run(prepared(DOC), blockCount);
    expect(observations).toEqual([
      {
        dimension: "doc.blocks",
        value: "2",
        range: { start: 0, end: 5 },
        line: 1,
        text: "# Tit",
      },
    ]);
  });

  it("handles a doc with no blocks", () => {
    const doc = prepared("");
    const result = run(doc, endsWithPeriod, headingDepth, blockCount);
    expect(result.problems).toEqual([]);
    expect(result.observations.map((o) => o.dimension)).toEqual(["doc.blocks"]);
    expect(result.observations[0]?.value).toBe("0");
  });

  it("returns nothing for an empty registry", () => {
    expect(run(prepared(DOC))).toEqual({ observations: [], problems: [] });
  });
});

describe("blockKinds", () => {
  it("limits sentence extractors to the listed kinds", () => {
    const doc = prepared("# Head\n\nPara.\n\n| a |\n| - |\n| cell |\n");
    const only = (kinds: readonly ("paragraph" | "heading" | "tableCell")[]) =>
      run(doc, { ...endsWithPeriod, blockKinds: kinds }).observations.map(
        (o) => o.text,
      );
    expect(only(["heading"])).toEqual(["Head"]);
    expect(only(["paragraph"])).toEqual(["Para."]);
    expect(only(["tableCell"])).toEqual(["a", "cell"]);
    expect(only(["heading", "paragraph"])).toEqual(["Head", "Para."]);
  });

  it("runs on all blocks when left out", () => {
    const doc = prepared("# Head\n\nPara.\n");
    expect(run(doc, endsWithPeriod).observations).toHaveLength(2);
  });
});

describe("bad findings", () => {
  const doc = prepared("Hello there.\n");
  const range = { start: 0, end: 5 };
  const good = { dimension: "term.x", value: "v", range };

  function problemsFor(finding: Finding) {
    return run(doc, fixed("term.synonyms", [finding]));
  }

  it("keeps a good finding from the same family", () => {
    const result = problemsFor(good);
    expect(result.observations).toHaveLength(1);
    expect(result.problems).toEqual([]);
  });

  it.each([
    ["dimension is not a check ID", { ...good, dimension: "Bad" }],
    ["dimension has another first part", { ...good, dimension: "heading.x" }],
    ["value is empty", { ...good, value: "" }],
    [
      "value is too long",
      { ...good, value: "a".repeat(MAX_OBSERVATION_VALUE_LENGTH + 1) },
    ],
    ["value has a newline", { ...good, value: "a\nb" }],
    ["value has a NUL", { ...good, value: "a" + String.fromCodePoint(0) }],
    ["value has DEL", { ...good, value: "a" + String.fromCodePoint(0x7f) }],
    ["start is negative", { ...good, range: { start: -1, end: 3 } }],
    ["start is fractional", { ...good, range: { start: 0.5, end: 3 } }],
    ["end is NaN", { ...good, range: { start: 0, end: Number.NaN } }],
    ["start is after end", { ...good, range: { start: 4, end: 3 } }],
    ["end is past the source", { ...good, range: { start: 0, end: 500 } }],
  ])("drops a finding when %s", (_name, finding) => {
    const result = problemsFor(finding);
    expect(result.observations).toEqual([]);
    expect(result.problems).toEqual([
      { extractorId: "term.synonyms", kind: "bad-finding", count: 1 },
    ]);
  });

  // A document extractor has no unit range, so only the source bounds apply.
  it.each([
    ["start is negative", { start: -1, end: 3 }],
    ["end is fractional", { start: 0, end: 3.5 }],
    ["end is past the source", { start: 0, end: 500 }],
  ])("drops a document finding when %s", (_name, badRange) => {
    const result = run(doc, {
      id: "term.doc",
      scope: "document",
      extract: () => [{ ...good, range: badRange }],
    });
    expect(result.observations).toEqual([]);
    expect(result.problems).toEqual([
      { extractorId: "term.doc", kind: "bad-finding", count: 1 },
    ]);
  });

  it("drops a dimension that shares the first part but is no check ID", () => {
    const result = problemsFor({ ...good, dimension: "term" });
    expect(result.observations).toEqual([]);
    expect(result.problems).toEqual([
      { extractorId: "term.synonyms", kind: "bad-finding", count: 1 },
    ]);
  });

  it("accepts a value of the maximum length and an empty range", () => {
    const result = problemsFor({
      ...good,
      value: "a".repeat(MAX_OBSERVATION_VALUE_LENGTH),
      range: { start: 3, end: 3 },
    });
    expect(result.observations).toHaveLength(1);
  });

  it("counts bad findings once per extractor", () => {
    const result = run(
      doc,
      fixed("term.synonyms", [
        { ...good, value: "" },
        good,
        { ...good, value: "" },
      ]),
    );
    expect(result.observations).toHaveLength(1);
    expect(result.problems).toEqual([
      { extractorId: "term.synonyms", kind: "bad-finding", count: 2 },
    ]);
  });

  it("drops malformed values that are not findings", () => {
    const sloppy: Extractor = {
      id: "term.sloppy",
      scope: "document",
      extract: () =>
        [
          null,
          5,
          {},
          { dimension: "term.x", value: "v" },
        ] as unknown as Finding[],
    };
    const result = run(doc, sloppy);
    expect(result.observations).toEqual([]);
    expect(result.problems).toEqual([
      { extractorId: "term.sloppy", kind: "bad-finding", count: 4 },
    ]);
  });

  it("drops a block finding outside the block", () => {
    const two = prepared("One.\n\nTwo.\n");
    const wrong: BlockExtractor = {
      id: "term.block",
      scope: "block",
      extract: () => [
        { dimension: "term.x", value: "v", range: { start: 0, end: 10 } },
      ],
    };
    const result = run(two, wrong);
    expect(result.observations).toEqual([]);
    expect(result.problems).toEqual([
      { extractorId: "term.block", kind: "bad-finding", count: 2 },
    ]);
  });

  it("drops a sentence finding outside the sentence", () => {
    const two = prepared("One.\n\nTwo.\n");
    const result = run(
      two,
      fixed("term.s", [
        { dimension: "term.x", value: "v", range: { start: 0, end: 4 } },
      ]),
    );
    // Sentence 1 is [0,4]; sentence 2 is [6,10], so only the first accepts.
    expect(result.observations).toHaveLength(1);
    expect(result.problems).toEqual([
      { extractorId: "term.s", kind: "bad-finding", count: 1 },
    ]);
  });
});

describe("failing extractors", () => {
  const doc = prepared("One.\n\nTwo.\n");

  it("drops everything from a throwing extractor and keeps the others", () => {
    let calls = 0;
    const thrower: SentenceExtractor = {
      id: "term.thrower",
      scope: "sentence",
      extract: (sentence) => {
        calls += 1;
        if (calls === 2) {
          throw new Error("boom");
        }
        return [{ dimension: "term.t", value: "v", range: sentence.source }];
      },
    };
    const result = run(doc, thrower, endsWithPeriod);
    expect(result.problems).toEqual([
      { extractorId: "term.thrower", kind: "threw", count: 1 },
    ]);
    expect(result.observations.map((o) => o.dimension)).toEqual([
      "sentence.period",
      "sentence.period",
    ]);
  });

  it("treats a non-list return as a throw", () => {
    const odd: Extractor = {
      id: "term.odd",
      scope: "document",
      extract: () => undefined as unknown as Finding[],
    };
    expect(run(doc, odd).problems).toEqual([
      { extractorId: "term.odd", kind: "threw", count: 1 },
    ]);
  });

  it("caps good findings and reports the number dropped", () => {
    const many: Finding[] = [];
    for (let i = 0; i < MAX_OBSERVATIONS_PER_EXTRACTOR + 3; i++) {
      many.push({
        dimension: "term.x",
        value: "v" + String(i),
        range: { start: 0, end: 1 },
      });
    }
    const result = run(doc, {
      id: "term.many",
      scope: "document",
      extract: () => many,
    });
    expect(result.observations).toHaveLength(MAX_OBSERVATIONS_PER_EXTRACTOR);
    expect(result.problems).toEqual([
      { extractorId: "term.many", kind: "too-many", count: 3 },
    ]);
    expect(
      result.observations.some(
        (o) => o.value === "v" + String(MAX_OBSERVATIONS_PER_EXTRACTOR),
      ),
    ).toBe(false);
  });

  it("lists problems in registry order, one per extractor and kind", () => {
    const bad = { dimension: "x", value: "v", range: { start: 0, end: 1 } };
    const result = run(
      doc,
      fixed("term.second", [bad]),
      fixed("heading.first", [bad]),
    );
    expect(result.problems.map((p) => p.extractorId)).toEqual([
      "term.second",
      "heading.first",
    ]);
  });
});

describe("evidence", () => {
  const long = (n: number) => "word ".repeat(n).trim();

  function evidenceOf(
    text: string,
    start: number,
    end: number,
    scope: "document" | "sentence" = "sentence",
  ): string {
    const doc = prepared(text);
    const result = run(doc, {
      id: "term.e",
      scope,
      extract: () => [
        { dimension: "term.x", value: "v", range: { start, end } },
      ],
    });
    return result.observations[0]?.text ?? "";
  }

  it("collapses whitespace runs and trims", () => {
    const doc = prepared("One   two\nthree\t four.\n");
    const result = run(doc, endsWithPeriod);
    expect(result.observations[0]?.text).toBe("One two three four.");
  });

  it("uses a window of the sentence when it is long", () => {
    const sentence = long(200) + ".";
    const doc = prepared(sentence + "\n");
    const start = 600;
    const result = run(doc, {
      id: "term.e",
      scope: "sentence",
      extract: (s) => [
        {
          dimension: "term.x",
          value: "v",
          range: { start, end: s.source.end },
        },
      ],
    });
    const text = result.observations[0]?.text ?? "";
    expect(text).toBe(sentence.slice(500, 800).replace(/\s+/g, " ").trim());
    expect(text.length).toBeLessThanOrEqual(MAX_EVIDENCE_LENGTH);
  });

  it("starts the window at the unit start when the range is early", () => {
    const sentence = long(200) + ".";
    const doc = prepared(sentence + "\n");
    const result = run(doc, {
      id: "term.e",
      scope: "sentence",
      extract: (s) => [
        {
          dimension: "term.x",
          value: "v",
          range: { start: 10, end: s.source.start + 15 },
        },
      ],
    });
    expect(result.observations[0]?.text).toBe(sentence.slice(0, 300).trim());
  });

  it("ends the window at the unit end", () => {
    const sentence = long(100) + ".";
    const doc = prepared(sentence + "\n");
    const end = doc.blocks[0]?.sentences[0]?.source.end ?? 0;
    const result = run(doc, {
      id: "term.e",
      scope: "sentence",
      extract: () => [
        { dimension: "term.x", value: "v", range: { start: end - 1, end } },
      ],
    });
    expect(result.observations[0]?.text).toBe(
      sentence.slice(end - 1 - 100, end).trim(),
    );
  });

  it("never cuts a surrogate pair at the end of the window", () => {
    const emoji = String.fromCodePoint(0x1f600);
    // Window is [0, 300); put the pair across index 299 and 300.
    const text = "a".repeat(299) + emoji + " tail";
    const doc = prepared(text + "\n");
    const got = evidenceOf(text, 0, 1);
    expect(doc.parsed.source.length).toBeGreaterThan(MAX_EVIDENCE_LENGTH);
    expect(got).toBe("a".repeat(299));
  });

  it("never cuts a surrogate pair at the start of the window", () => {
    const emoji = String.fromCodePoint(0x1f600);
    // Window start = rangeStart - 100 = 150, the middle of the pair.
    const text = "a".repeat(149) + emoji + "b".repeat(400);
    const start = 250;
    const got = evidenceOf(text, start, start + 1);
    expect(got.startsWith("b")).toBe(true);
    expect(got.length).toBe(299);
  });

  it("uses the finding's own range for a document extractor", () => {
    expect(evidenceOf("Some   words\nhere.\n", 5, 17, "document")).toBe(
      "words here",
    );
  });
});

describe("order and shape", () => {
  it("sorts by start, end, dimension, then value", () => {
    const doc = prepared("Hello there friend.\n");
    const f = (
      dimension: string,
      value: string,
      start: number,
      end: number,
    ): Finding => ({
      dimension,
      value,
      range: { start, end },
    });
    const result = run(doc, {
      id: "term.order",
      scope: "document",
      extract: () => [
        f("term.b", "a", 2, 4),
        f("term.a", "b", 1, 9),
        f("term.a", "b", 1, 3),
        f("term.b", "a", 1, 3),
        f("term.a", "a", 1, 3),
        f("term.a", "b", 0, 9),
      ],
    });
    expect(
      result.observations.map((o) => [
        o.range.start,
        o.range.end,
        o.dimension,
        o.value,
      ]),
    ).toEqual([
      [0, 9, "term.a", "b"],
      [1, 3, "term.a", "a"],
      [1, 3, "term.a", "b"],
      [1, 3, "term.b", "a"],
      [1, 9, "term.a", "b"],
      [2, 4, "term.b", "a"],
    ]);
  });

  it("returns plain data", () => {
    const result = run(prepared(DOC), endsWithPeriod, headingDepth, blockCount);
    expect(structuredClone(result)).toStrictEqual(result);
  });

  it("copies ranges instead of sharing the extractor's objects", () => {
    const doc = prepared("One.\n");
    const shared = { start: 0, end: 3 };
    const result = run(
      doc,
      fixed("term.s", [{ dimension: "term.x", value: "v", range: shared }]),
    );
    expect(result.observations[0]?.range).not.toBe(shared);
  });
});
