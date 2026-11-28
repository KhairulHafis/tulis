import { describe, expect, it } from "vitest";
import { expectLinearTime } from "@tulis/testkit";
import type { Token } from "../language/tokens.js";
import { headingCase } from "./heading-case.js";
import { headingEndPunct } from "./heading-end-punct.js";

function token(text: string, kind: Token["kind"], at: number): Token {
  return {
    text,
    kind,
    placeholder: undefined,
    maskedStart: at,
    maskedEnd: at + text.length,
    source: { start: at, end: at + text.length },
  };
}

/** `count` words alternating with colons, built untimed. */
function hostile(count: number, word: string): readonly Token[] {
  const tokens: Token[] = [];
  for (let i = 0; i < count; i += 1) {
    tokens.push(token(word, "word", i * 2));
    tokens.push(token(":", "punctuation", i * 2 + 1));
  }
  return tokens;
}

describe("headingCase on hostile headings", () => {
  it("answers on 2,000 and 16,000 words alternating with colons", () => {
    expect(headingCase(hostile(2000, "Alpha"))).toBeUndefined();
    expect(headingCase(hostile(16000, "alpha"))).toBeUndefined();
  });

  it("decides on a long heading with a deciding word", () => {
    const tokens = [
      token("Alpha", "word", 0),
      token("beta", "word", 6),
      ...hostile(2000, "Gamma"),
    ];
    expect(headingCase(tokens)).toBe("sentence");
  });

  it("grows roughly linearly", () => {
    expectLinearTime({
      prepare: (size) => {
        const tokens = [token("Alpha", "word", 0), ...hostile(size, "Beta")];
        return () => {
          headingCase(tokens);
          headingEndPunct(tokens);
        };
      },
      probe: { size: 2000, limitMs: 100 },
      sizes: [4000, 8000, 16000],
      smallLimitMs: 100,
      largeLimitMs: 300,
      slack: 4,
      floorMs: 20,
    });
  });
});
