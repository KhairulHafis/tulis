import { expectLinearTime } from "@tulis/testkit";
import { describe, it } from "vitest";
import { tagSentence } from "../language/tag-tokens.js";
import type { Token } from "../language/tokens.js";
import { stepStart } from "./step-start.js";

/** Builds a Token for each space-separated piece; "," is punctuation. */
function tokensOf(pieces: readonly string[]): Token[] {
  const tokens: Token[] = [];
  let at = 0;
  for (const piece of pieces) {
    tokens.push({
      text: piece,
      kind: piece === "," ? "punctuation" : "word",
      placeholder: undefined,
      maskedStart: at,
      maskedEnd: at + piece.length,
      source: { start: at, end: at + piece.length },
    });
    at += piece.length + 1;
  }
  return tokens;
}

/** A short lead-in of three commas, then many words. */
function longAfterLeadIn(size: number): Token[] {
  const pieces = ["In", "a", ",", "on", "b", ",", "at", "c", ",", "select"];
  for (let i = 0; i < size; i += 1) {
    pieces.push("item");
  }
  return tokensOf(pieces);
}

/** "a , a , a , ..." with `size` commas. */
function manyCommas(size: number): Token[] {
  const pieces: string[] = [];
  for (let i = 0; i < size; i += 1) {
    pieces.push("a", ",");
  }
  pieces.push("a");
  return tokensOf(pieces);
}

function prepare(
  build: (size: number) => Token[],
): (size: number) => () => unknown {
  return (size: number) => {
    const tokens = build(size);
    const tags = tagSentence(tokens);
    return () => stepStart(tokens, tags);
  };
}

describe("stepStart is bounded on hostile input", () => {
  it("one long sentence after a short lead-in", () => {
    expectLinearTime({
      prepare: prepare(longAfterLeadIn),
      probe: { size: 10000, limitMs: 50 },
      sizes: [1000, 4000, 16000],
      smallLimitMs: 30,
      largeLimitMs: 50,
      slack: 4,
      floorMs: 5,
    });
  });

  it("thousands of commas between single words", () => {
    expectLinearTime({
      prepare: prepare(manyCommas),
      probe: { size: 10000, limitMs: 50 },
      sizes: [1000, 4000, 16000],
      smallLimitMs: 30,
      largeLimitMs: 50,
      slack: 4,
      floorMs: 5,
    });
  });
});
