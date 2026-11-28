import { describe, expect, it } from "vitest";
import { prepareDoc, type PreparedDoc } from "../prepare/prepare-doc.js";
import { headingCase } from "./heading-case.js";
import {
  countWordCase,
  learnProperNouns,
  properNounKey,
  sumWordCase,
  type WordCaseCount,
  type WordCaseTotal,
} from "./proper-nouns.js";

function prepared(text: string): PreparedDoc {
  const result = prepareDoc(text, "markdown");
  if (result.kind !== "prepared") throw new Error("not prepared");
  return result;
}

const RIGHT_QUOTE = String.fromCodePoint(0x2019);
const ACUTE = String.fromCodePoint(0x301);

describe("properNounKey", () => {
  it("lowercases and drops one trailing 's", () => {
    expect(properNounKey("Datadog")).toBe("datadog");
    expect(properNounKey("Datadog's")).toBe("datadog");
    expect(properNounKey("Datadog" + RIGHT_QUOTE + "s")).toBe("datadog");
    expect(properNounKey("Datadog's's")).toBe("datadog's");
    expect(properNounKey("ÉCOLE")).toBe("école");
  });

  it("gives a decomposed accent the same key as the precomposed one", () => {
    expect(properNounKey("e" + ACUTE)).toBe(properNounKey("é"));
  });
});

const DOC = [
  "Install Datadog on the host. Datadog sends metrics. The agent talks to Datadog: Agent settings live in a file.",
  "",
  "- Select **Settings** and open Datadog" +
    RIGHT_QUOTE +
    "s page in [the Datadog docs](https://x.y) (Datadog-specific).",
  "",
  "| Datadog | x |",
  "|---|---|",
  "| Use Datadog here | y |",
  "",
  "# Datadog heading",
  "",
].join("\n");

describe("countWordCase", () => {
  it("counts paragraph words that are not at a start position", () => {
    const counts = countWordCase(prepared(DOC));
    const lowers = [
      "host",
      "sends",
      "metrics",
      "agent",
      "talks",
      "settings",
      "live",
      "file",
      "open",
      "page",
      "docs",
    ];
    const expected = new Map<string, WordCaseCount>([
      ["datadog", { upper: 4, lower: 0 }],
      ...lowers.map((w): [string, WordCaseCount] => [
        w,
        { upper: 0, lower: 1 },
      ]),
    ]);
    expect(counts).toEqual(expected);
  });

  it("returns plain data that survives structuredClone", () => {
    const counts = countWordCase(prepared(DOC));
    expect(structuredClone(counts)).toEqual(counts);
  });
});

describe("sumWordCase", () => {
  const doc1 = new Map<string, WordCaseCount>([
    ["datadog", { upper: 3, lower: 0 }],
    ["agent", { upper: 1, lower: 2 }],
  ]);
  const doc2 = new Map<string, WordCaseCount>([
    ["datadog", { upper: 0, lower: 1 }],
    ["agent", { upper: 1, lower: 0 }],
  ]);
  const expected = new Map<string, WordCaseTotal>([
    ["datadog", { upper: 3, lower: 1, docs: 1 }],
    ["agent", { upper: 2, lower: 2, docs: 2 }],
  ]);

  it("adds counts and counts docs with a capital", () => {
    expect(sumWordCase([doc1, doc2])).toEqual(expected);
  });

  it("accepts a generator", () => {
    function* gen(): Generator<ReadonlyMap<string, WordCaseCount>> {
      yield doc1;
      yield doc2;
    }
    expect(sumWordCase(gen())).toEqual(expected);
  });
});

describe("learnProperNouns", () => {
  it("applies the cut-offs", () => {
    const totals = new Map<string, WordCaseTotal>([
      ["datadog", { upper: 9, lower: 1, docs: 3 }],
      ["edge", { upper: 5, lower: 0, docs: 2 }],
      ["agent", { upper: 8, lower: 2, docs: 4 }],
      ["rare", { upper: 4, lower: 0, docs: 4 }],
      ["solo", { upper: 20, lower: 0, docs: 1 }],
    ]);
    expect([...learnProperNouns(totals)].sort()).toEqual(["datadog", "edge"]);
  });
});

describe("end to end", () => {
  it("stops Datadog from making a heading title case", () => {
    const docs = [
      "We use Datadog here. Datadog sends metrics.\n",
      "Install the Datadog agent. Then open Datadog.\n",
      "Datadog is nice, and so is Datadog. Ask Datadog.\n",
    ].map(prepared);
    const names = learnProperNouns(sumWordCase(docs.map(countWordCase)));
    expect(names.has("datadog")).toBe(true);
    const heading = prepared("## Disable Datadog\n").blocks[0]?.sentences[0];
    const tokens = heading?.tokens ?? [];
    expect(headingCase(tokens)).toBe("title");
    expect(headingCase(tokens, names)).toBeUndefined();
  });
});
