import { describe, expect, it } from "vitest";
import { expectLinearTime, repeatToSize } from "@tulis/testkit";
import {
  MaskedTextBuilder,
  placeholderText,
  type MaskedText,
} from "../markdown/masked-text.js";
import type { Sentence } from "../markdown/sentences.js";
import { tokenizeSentence } from "./tokens.js";

/** One masked text and the sentence that covers all of it, built untimed. */
function whole(text: string): { masked: MaskedText; sentence: Sentence } {
  const builder = new MaskedTextBuilder();
  builder.appendReplacement(text, 0, text.length);
  return {
    masked: builder.build(),
    sentence: {
      text,
      maskedStart: 0,
      maskedEnd: text.length,
      source: { start: 0, end: text.length },
    },
  };
}

describe("tokenizeSentence on hostile input", () => {
  it("does not treat a typed {CODE} as a placeholder", () => {
    const { masked, sentence } = whole("Type {CODE} here");
    const tokens = tokenizeSentence(masked, sentence);
    expect(tokens.map((token) => token.text)).toEqual([
      "Type",
      "{",
      "CODE",
      "}",
      "here",
    ]);
    expect(tokens.every((token) => token.kind !== "placeholder")).toBe(true);
    expect(tokens.every((token) => token.placeholder === undefined)).toBe(true);
  });

  it("takes a real placeholder only from the placeholder list", () => {
    const builder = new MaskedTextBuilder();
    builder.appendReplacement("A {CODE} and ", 0, 13);
    builder.appendPlaceholder("CODE", 13, 20);
    const masked = builder.build();
    const sentence: Sentence = {
      text: masked.text,
      maskedStart: 0,
      maskedEnd: masked.text.length,
      source: { start: 0, end: 20 },
    };
    const tokens = tokenizeSentence(masked, sentence);
    expect(tokens.map((token) => token.kind)).toEqual([
      "word",
      "punctuation",
      "word",
      "punctuation",
      "word",
      "placeholder",
    ]);
  });

  const cases: [string, string][] = [
    ["mixed joiners", "a-'._"],
    ["repeated hyphens and dots", "--..."],
    ["a joiner between every letter", "a.b-c_d'e "],
    ["one long joined word", "a-"],
  ];
  for (const [name, unit] of cases) {
    it("stays linear for " + name, () => {
      expectLinearTime({
        prepare: (size) => {
          const { masked, sentence } = whole(repeatToSize(unit, size));
          return () => tokenizeSentence(masked, sentence);
        },
        probe: { size: 5000, limitMs: 100 },
        sizes: [25_000, 50_000, 100_000],
        smallLimitMs: 300,
        largeLimitMs: 900,
        slack: 4,
        floorMs: 50,
      });
    });
  }

  it("handles a 1,000,000 character word", () => {
    // A small probe first, so a quadratic scan fails here instead of hanging.
    const probe = whole("a".repeat(5000));
    const probeStart = performance.now();
    tokenizeSentence(probe.masked, probe.sentence);
    expect(performance.now() - probeStart).toBeLessThan(100);
    const { masked, sentence } = whole("a".repeat(1_000_000));
    const started = performance.now();
    const tokens = tokenizeSentence(masked, sentence);
    expect(performance.now() - started).toBeLessThan(900);
    expect(tokens).toHaveLength(1);
    expect(tokens[0]?.maskedEnd).toBe(1_000_000);
  });

  it("handles lone surrogates and bidi controls", () => {
    const rlo = String.fromCodePoint(0x202e);
    const rlm = String.fromCodePoint(0x200f);
    const lri = String.fromCodePoint(0x2066);
    const pdi = String.fromCodePoint(0x2069);
    const text = "a\ud83d" + rlo + "b" + rlm + "\ude00 " + lri + "c" + pdi;
    const { masked, sentence } = whole(text);
    const tokens = tokenizeSentence(masked, sentence);
    expect(tokens.map((token) => token.text).join("")).toBe(
      text.replace(" ", ""),
    );
    for (const token of tokens) {
      expect(token.text.length).toBeGreaterThan(0);
      expect(token.text).toBe(
        masked.text.slice(token.maskedStart, token.maskedEnd),
      );
    }
    expect(tokens[1]?.kind).toBe("symbol");
    expect(tokens[1]?.text).toBe("\ud83d");
  });

  it("stays linear for many placeholders in one sentence", () => {
    // Looking up the next placeholder must not rescan the list each time.
    const placeholderSentence = (count: number) => {
      const builder = new MaskedTextBuilder();
      for (let i = 0; i < count; i++) {
        builder.appendPlaceholder("CODE", i * 2, i * 2 + 2);
      }
      const masked = builder.build();
      expect(masked.text).toBe(placeholderText("CODE").repeat(count));
      const sentence: Sentence = {
        text: masked.text,
        maskedStart: 0,
        maskedEnd: masked.text.length,
        source: { start: 0, end: count * 2 },
      };
      return { masked, sentence };
    };
    expectLinearTime({
      prepare: (size) => {
        const { masked, sentence } = placeholderSentence(size);
        return () => {
          const tokens = tokenizeSentence(masked, sentence);
          expect(tokens).toHaveLength(size);
        };
      },
      probe: { size: 2000, limitMs: 100 },
      sizes: [5000, 40_000],
      smallLimitMs: 300,
      largeLimitMs: 900,
      slack: 4,
      floorMs: 50,
    });
  });
});
