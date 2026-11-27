import { describe, expect, it } from "vitest";
import { expectLinearTime } from "@tulis/testkit";
import { MaskedTextBuilder } from "../markdown/masked-text.js";
import { tagSentence } from "./tag-tokens.js";
import { tokenizeSentence, type Token } from "./tokens.js";

/** Tokens of a plain sentence, built untimed. */
function tokensOf(text: string): Token[] {
  const builder = new MaskedTextBuilder();
  builder.appendReplacement(text, 0, text.length);
  const masked = builder.build();
  return tokenizeSentence(masked, {
    text,
    maskedStart: 0,
    maskedEnd: text.length,
    source: { start: 0, end: text.length },
  });
}

const MIXED = "the agent installs, 12 plugins and runs it; don't stop. ";

/** A sentence of `count` mixed words (comma, number, contraction included). */
function mixedWords(count: number): string {
  const perUnit = MIXED.trim().split(/\s+/u).length;
  return MIXED.repeat(Math.ceil(count / perUnit));
}

describe("tagSentence on hostile input", () => {
  it("stays linear for a long sentence of mixed words", () => {
    expectLinearTime({
      prepare: (size) => {
        const tokens = tokensOf(mixedWords(size));
        return () => {
          expect(tagSentence(tokens)).toHaveLength(tokens.length);
        };
      },
      probe: { size: 500, limitMs: 150 },
      sizes: [1000, 8000],
      smallLimitMs: 400,
      largeLimitMs: 3000,
      slack: 6,
      floorMs: 80,
    });
  });

  it("stays linear for many punctuation tokens after one word", () => {
    // Appending to `post` must not rebuild the string each time.
    expectLinearTime({
      prepare: (size) => {
        const tokens = tokensOf("word" + ",".repeat(size));
        return () => {
          expect(tagSentence(tokens)).toHaveLength(size + 1);
        };
      },
      probe: { size: 5000, limitMs: 150 },
      sizes: [20_000, 160_000],
      smallLimitMs: 400,
      largeLimitMs: 3000,
      slack: 6,
      floorMs: 80,
    });
  });

  it("handles a 1,000,000 character word", () => {
    // A small probe first, so a slow path fails here instead of hanging.
    const probe = tokensOf("a".repeat(20_000));
    const probeStart = performance.now();
    tagSentence(probe);
    expect(performance.now() - probeStart).toBeLessThan(150);
    const tokens = tokensOf("a".repeat(1_000_000));
    const started = performance.now();
    const result = tagSentence(tokens);
    expect(performance.now() - started).toBeLessThan(1500);
    expect(result).toHaveLength(1);
    expect(result[0]?.text).toHaveLength(1_000_000);
  });

  it("gives words named like object properties normal tags", () => {
    const before = Object.getOwnPropertyNames(Object.prototype).sort();
    const names = ["constructor", "__proto__", "toString", "hasOwnProperty"];
    const tokens = tokensOf("The " + names.join(" and ") + " run.");
    const result = tagSentence(tokens);
    expect(result.map((token) => token.text)).toEqual(
      tokens.map((token) => token.text),
    );
    for (const name of ["constructor", "toString", "hasOwnProperty", "proto"]) {
      const found = result.find((token) => token.text === name);
      expect(found?.kind).toBe("word");
      expect(found?.pos).toBe("noun");
    }
    expect(result[0]?.pos).toBe("determiner");
    expect(result.find((token) => token.text === "and")?.pos).toBe(
      "conjunction",
    );
    expect(result.at(-1)?.pos).toBe("punctuation");
    expect(Object.getOwnPropertyNames(Object.prototype).sort()).toEqual(before);
    expect(Reflect.get({}, "polluted")).toBeUndefined();
    expect(Reflect.get(Object.prototype, "constructor")).toBe(Object);
  });

  it("gives the same answer when it tags the same sentence twice", () => {
    const tokens = tokensOf("Install the agent, then don't run it twice.");
    const other = tokensOf("Constructor __proto__ toString");
    const first = tagSentence(tokens);
    tagSentence(other);
    expect(tagSentence(tokens)).toEqual(first);
  });

  it("handles 5,000 punctuation tokens and no words", () => {
    const tokens = tokensOf(",.;:!?".repeat(834).slice(0, 5000));
    expect(tokens).toHaveLength(5000);
    const result = tagSentence(tokens);
    expect(result).toHaveLength(5000);
    expect(result.every((token) => token.pos === "punctuation")).toBe(true);
  });

  it("handles bidi controls and lone surrogates", () => {
    const rlo = String.fromCodePoint(0x202e);
    const rlm = String.fromCodePoint(0x200f);
    const lri = String.fromCodePoint(0x2066);
    const pdi = String.fromCodePoint(0x2069);
    const text = "Run a\ud83d" + rlo + "b" + rlm + "\ude00 " + lri + "c" + pdi;
    const tokens = tokensOf(text);
    const result = tagSentence(tokens);
    expect(result.map((token) => token.text)).toEqual(
      tokens.map((token) => token.text),
    );
    expect(result[0]?.pos).toBe("verb");
    for (const token of result) {
      expect(token.text.length).toBeGreaterThan(0);
    }
  });
});
