import { describe, expect, it } from "vitest";
import { expectLinearTime } from "@tulis/testkit";
import { prepareDoc, type PreparedDoc } from "../prepare/prepare-doc.js";
import {
  countWordCase,
  learnProperNouns,
  MAX_DOC_WORD_KEYS,
  MAX_PROPER_NOUN_KEY_LENGTH,
  MAX_PROPER_NOUNS,
  MAX_TOTAL_WORD_KEYS,
  sumWordCase,
  type WordCaseCount,
  type WordCaseTotal,
} from "./proper-nouns.js";

function prepared(text: string): PreparedDoc {
  const result = prepareDoc(text, "markdown");
  if (result.kind !== "prepared") throw new Error("not prepared");
  return result;
}

/** A letters-only word for each number, so every word is distinct. */
function nameFor(n: number): string {
  let rest = n;
  let out = "";
  for (let i = 0; i < 4; i += 1) {
    out = String.fromCharCode(97 + (rest % 26)) + out;
    rest = Math.floor(rest / 26);
  }
  return "Q" + out;
}

describe("size caps", () => {
  it("keeps MAX_DOC_WORD_KEYS keys per doc, and known keys keep counting", () => {
    const words: string[] = [];
    for (let i = 0; i < MAX_DOC_WORD_KEYS + 5; i += 1) words.push(nameFor(i));
    // The first word is a start position; the repeat comes after the cap.
    const text = "Start " + words.join(" ") + " " + nameFor(0) + ".\n";
    const counts = countWordCase(prepared(text));
    expect(counts.size).toBe(MAX_DOC_WORD_KEYS);
    expect(counts.get(nameFor(0).toLowerCase())).toEqual({
      upper: 2,
      lower: 0,
    });
    expect(counts.has(nameFor(MAX_DOC_WORD_KEYS).toLowerCase())).toBe(false);
  });

  it("keeps MAX_TOTAL_WORD_KEYS keys in the totals, and known keys keep summing", () => {
    const big = new Map<string, WordCaseCount>();
    for (let i = 0; i < MAX_TOTAL_WORD_KEYS + 5; i += 1) {
      big.set("k" + String(i), { upper: 1, lower: 0 });
    }
    const totals = sumWordCase([big, big]);
    expect(totals.size).toBe(MAX_TOTAL_WORD_KEYS);
    expect(totals.get("k0")).toEqual({ upper: 2, lower: 0, docs: 2 });
    expect(totals.has("k" + String(MAX_TOTAL_WORD_KEYS))).toBe(false);
  });

  it("learns at most MAX_PROPER_NOUNS, keeping the most upper uses then the smallest keys", () => {
    const totals = new Map<string, WordCaseTotal>();
    // 5 names with extra uses, then many ties.
    for (let i = 0; i < 5; i += 1) {
      totals.set("z" + String(i), { upper: 50, lower: 0, docs: 2 });
    }
    for (let i = 0; i < MAX_PROPER_NOUNS + 5; i += 1) {
      totals.set("t" + String(i).padStart(6, "0"), {
        upper: 10,
        lower: 0,
        docs: 2,
      });
    }
    const learned = learnProperNouns(totals);
    expect(learned.size).toBe(MAX_PROPER_NOUNS);
    for (let i = 0; i < 5; i += 1)
      expect(learned.has("z" + String(i))).toBe(true);
    expect(learned.has("t000000")).toBe(true);
    expect(
      learned.has("t" + String(MAX_PROPER_NOUNS - 6).padStart(6, "0")),
    ).toBe(true);
    expect(
      learned.has("t" + String(MAX_PROPER_NOUNS - 5).padStart(6, "0")),
    ).toBe(false);
  });

  it("does not count a key over the length cap", () => {
    const long = "Q" + "a".repeat(MAX_PROPER_NOUN_KEY_LENGTH);
    const ok = "Q" + "a".repeat(MAX_PROPER_NOUN_KEY_LENGTH - 1);
    const counts = countWordCase(prepared("Start " + long + " " + ok + ".\n"));
    expect(counts.has(long.toLowerCase())).toBe(false);
    expect(counts.has(ok.toLowerCase())).toBe(true);
  });
});

describe("timing", () => {
  it("counts in linear time", () => {
    expectLinearTime({
      prepare: (size) => {
        const doc = prepared(
          "Start " +
            Array.from({ length: size }, (_, i) => nameFor(i)).join(" ") +
            ".\n",
        );
        return () => countWordCase(doc);
      },
      // Clean code takes about 12 ms at the largest size, a quadratic scan about
      // 500 ms, so the large limit sits between with room for slow CI.
      probe: { size: 2000, limitMs: 100 },
      sizes: [2000, 4000, 16000],
      smallLimitMs: 100,
      largeLimitMs: 300,
      slack: 4,
      floorMs: 20,
    });
  });
});
