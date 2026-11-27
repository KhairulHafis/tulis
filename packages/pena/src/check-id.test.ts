import { describe, expect, it } from "vitest";
import { isCheckId, MAX_CHECK_LENGTH } from "./check-id.js";

describe("isCheckId", () => {
  it.each(["term.sign-in", "a.b", "a.b.c.d", "a1.2b", "10.20", "a-b-c.d-e"])(
    "accepts %s",
    (value) => {
      expect(isCheckId(value)).toBe(true);
    },
  );

  it.each([
    ["one part", "term"],
    ["five parts", "a.b.c.d.e"],
    ["uppercase", "Term.sign-in"],
    ["underscore", "term.sign_in"],
    ["leading hyphen", "term.-sign"],
    ["trailing hyphen", "term.sign-"],
    ["double hyphen", "term.sign--in"],
    ["empty part", "term..sign"],
    ["trailing dot", "term."],
    ["empty", ""],
    ["space", "term. sign"],
  ])("rejects %s", (_name, value) => {
    expect(isCheckId(value)).toBe(false);
  });

  it("accepts exactly 128 characters and rejects 129", () => {
    const at = `a.${"b".repeat(MAX_CHECK_LENGTH - 2)}`;
    expect(at).toHaveLength(128);
    expect(isCheckId(at)).toBe(true);
    expect(isCheckId(`${at}b`)).toBe(false);
  });
});
