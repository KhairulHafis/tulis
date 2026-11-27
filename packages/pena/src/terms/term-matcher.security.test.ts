import { describe, expect, it } from "vitest";
import { expectLinearTime } from "@tulis/testkit";
import { prepareDoc, type PreparedSentence } from "../prepare/prepare-doc.js";
import { createTermMatcher, type TermEntry } from "./term-matcher.js";
import { termKey } from "./term-key.js";
import { inflectedForms } from "./word-forms.js";

function sentenceOf(text: string): [PreparedSentence, string] {
  const doc = prepareDoc(text, "markdown");
  if (doc.kind !== "prepared") {
    throw new Error("expected a prepared doc");
  }
  const sentence = doc.blocks[0]?.sentences[0];
  if (sentence === undefined) {
    throw new Error("expected a sentence");
  }
  return [sentence, doc.parsed.source];
}

/** A number as lower-case letters, so variants hold no digits. */
function letters(n: number): string {
  let rest = n;
  let out = "";
  do {
    out = String.fromCharCode(97 + (rest % 26)) + out;
    rest = Math.floor(rest / 26);
  } while (rest > 0);
  return out;
}

describe("linear time", () => {
  // Filler keys make a scan from the start of the key array slow, so the
  // test can tell range narrowing from a scan.
  const filler: TermEntry[] = [];
  for (let i = 0; i < 3000; i += 1) {
    filler.push({ text: "0" + letters(i) + " word", group: 1 });
  }
  const longVariant = "a a a a a a a a a a a a a a a a a a b";
  const matcher = createTermMatcher([
    { text: longVariant, group: 0 },
    ...filler,
  ]);

  it("handles many windows that grow to the longest key and fail", () => {
    expectLinearTime({
      prepare: (words) => {
        const input = sentenceOf("a ".repeat(words).trim() + ".");
        return () => matcher.find(...input);
      },
      probe: { size: 1500, limitMs: 400 },
      sizes: [1500, 3000, 6000],
      smallLimitMs: 400,
      largeLimitMs: 1000,
      slack: 3,
      floorMs: 50,
    });
  });

  it("handles one long run of joined words", () => {
    const joined = createTermMatcher([{ text: "log-log-in", group: 0 }]);
    expectLinearTime({
      prepare: (size) => {
        const input = sentenceOf(
          "log-".repeat(Math.ceil(size / 4)).slice(0, size) + "log.",
        );
        return () => joined.find(...input);
      },
      probe: { size: 20_000, limitMs: 400 },
      sizes: [20_000, 40_000, 80_000],
      smallLimitMs: 400,
      largeLimitMs: 1000,
      slack: 3,
      floorMs: 50,
    });
  });

  it("handles a long run of dashes and words", () => {
    const dashed = createTermMatcher([{ text: "log in", group: 0 }]);
    expectLinearTime({
      prepare: (size) => {
        const input = sentenceOf("log - ".repeat(Math.ceil(size / 6)));
        return () => dashed.find(...input);
      },
      probe: { size: 20_000, limitMs: 400 },
      sizes: [20_000, 40_000, 80_000],
      smallLimitMs: 400,
      largeLimitMs: 1000,
      slack: 3,
      floorMs: 50,
    });
  });
});

/** `groups` groups of 20 variants of 100 characters each. */
function largeEntries(groups: number): TermEntry[] {
  const entries: TermEntry[] = [];
  for (let group = 0; group < groups; group += 1) {
    for (let variant = 0; variant < 20; variant += 1) {
      let text = "";
      let word = 0;
      while (text.length < 100) {
        text += letters(group * 20 + variant + word * 7919) + "xyz ";
        word += 1;
      }
      entries.push({ text: text.slice(0, 99) + "q", group });
    }
  }
  return entries;
}

describe("building a matcher", () => {
  it("holds one key per spelling for the largest allowed input", () => {
    const entries = largeEntries(1000);
    let expectedKeys = 0;
    for (const entry of entries) {
      const keys = new Set([termKey(entry.text)]);
      for (const form of inflectedForms(entry.text)) {
        keys.add(termKey(form));
      }
      expectedKeys += keys.size;
    }
    const matcher = createTermMatcher(entries);
    expect(matcher.keyCount).toBe(expectedKeys);
    expect(matcher.keyCount).toBeGreaterThanOrEqual(entries.length);
  });

  // The largest input takes about 0.4 s, too slow to time on a loaded
  // Windows runner, so the growth is checked on smaller ones.
  it("grows in step with the number of variants", () => {
    expectLinearTime({
      prepare: (groups) => {
        const entries = largeEntries(groups);
        return () => createTermMatcher(entries);
      },
      probe: { size: 200, limitMs: 1500 },
      sizes: [25, 50, 100, 200],
      smallLimitMs: 400,
      largeLimitMs: 1500,
      slack: 3,
      floorMs: 100,
    });
  });
});

describe("invisible characters", () => {
  const rtlOverride = String.fromCodePoint(0x202e);
  const bidiIsolate = String.fromCodePoint(0x2066);
  const zeroWidthSpace = String.fromCodePoint(0x200b);
  const softHyphen = String.fromCodePoint(0x00ad);
  const bell = String.fromCodePoint(0x07);
  const verticalTab = String.fromCodePoint(0x0b);
  const nextLine = String.fromCodePoint(0x85);
  const matcher = createTermMatcher([
    { text: "log in", group: 0 },
    { text: "sign in", group: 0 },
  ]);

  function found(text: string): string[] {
    return matcher.find(...sentenceOf(text)).map((match) => match.value);
  }

  it("does not match across a bidi control", () => {
    expect(found("Then log" + rtlOverride + " in now.")).toEqual([]);
    expect(found("Then log " + bidiIsolate + "in now.")).toEqual([]);
  });

  it("does not match across a zero-width space", () => {
    expect(found("Then lo" + zeroWidthSpace + "g in now.")).toEqual([]);
    expect(found("Then log" + zeroWidthSpace + "in now.")).toEqual([]);
  });

  it("matches the same words without the invisible character", () => {
    expect(found("Then log in now.")).toEqual(["log in"]);
  });

  it("never returns a value with a control character or a soft hyphen", () => {
    const samples = [
      "Then log" + softHyphen + " in now.",
      "Then lo" + softHyphen + "g in now.",
      "Then sign" + bell + " in now.",
      "Then sign\t\tin" + verticalTab + " now.",
      "Then log " + softHyphen + " in now.",
      "Log" + nextLine + "in sign in.",
      "log in" + softHyphen,
    ];
    let total = 0;
    for (const sample of samples) {
      for (const value of found(sample)) {
        total += 1;
        expect(value).not.toMatch(/\p{Cc}/u);
        expect(value).not.toContain(softHyphen);
      }
    }
    expect(total).toBeGreaterThan(0);
  });
});
