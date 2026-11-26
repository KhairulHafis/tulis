import { describe, expect, it } from "vitest";
import { toSafeText } from "./safe-text.js";

describe("toSafeText", () => {
  it("leaves plain text unchanged", () => {
    expect(toSafeText("hello world")).toBe("hello world");
  });

  it("replaces ESC", () => {
    expect(toSafeText("\u001b[31mred")).toBe("?[31mred");
  });

  it("replaces C1 and bidi controls", () => {
    expect(toSafeText("a\u009bb")).toBe("a?b");
    expect(toSafeText("a\u202eb")).toBe("a?b");
    expect(toSafeText("\u061c\u200e\u200f\u2066\u2069")).toBe("?????");
  });

  it("replaces NUL, tab and DEL", () => {
    expect(toSafeText("a\u0000b")).toBe("a?b");
    expect(toSafeText("a\tb")).toBe("a?b");
    expect(toSafeText("a\u007fb")).toBe("a?b");
  });

  it("handles newlines", () => {
    expect(toSafeText("a\nb")).toBe("a?b");
    expect(toSafeText("a\nb", { keepNewlines: true })).toBe("a\nb");
  });

  it("collapses CRLF", () => {
    expect(toSafeText("a\r\nb", { keepNewlines: true })).toBe("a\nb");
    expect(toSafeText("a\r\nb")).toBe("a?b");
  });

  it("replaces a lone CR", () => {
    expect(toSafeText("a\rb", { keepNewlines: true })).toBe("a?b");
  });

  it("truncates only when longer than maxLength", () => {
    expect(toSafeText("abcde", { maxLength: 5 })).toBe("abcde");
    expect(toSafeText("abcdef", { maxLength: 5 })).toBe("abcde...");
  });

  it("uses a default maxLength of 100", () => {
    expect(toSafeText("a".repeat(100))).toBe("a".repeat(100));
    expect(toSafeText("a".repeat(101))).toBe(`${"a".repeat(100)}...`);
  });

  it("never leaves a lone high surrogate at the cut", () => {
    const text = "ab\u{1F600}cd";
    expect(toSafeText(text, { maxLength: 3 })).toBe("ab...");
    expect(toSafeText(text, { maxLength: 4 })).toBe("ab\u{1F600}...");
  });

  it("accepts maxLength 1", () => {
    expect(toSafeText("ab", { maxLength: 1 })).toBe("a...");
  });

  it("rejects an invalid maxLength", () => {
    expect(() => toSafeText("a", { maxLength: 0 })).toThrow(Error);
    expect(() => toSafeText("a", { maxLength: 1.5 })).toThrow(Error);
  });
});
