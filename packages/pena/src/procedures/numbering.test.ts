import { describe, expect, it } from "vitest";
import { procedureNumbering, readStepNumber } from "./numbering.js";

describe("readStepNumber", () => {
  it("reads a dot marker", () => {
    expect(readStepNumber("1. Go", 0)).toBe(1);
  });
  it("reads a parenthesis marker", () => {
    expect(readStepNumber("2) Go", 0)).toBe(2);
  });
  it("reads nine digits", () => {
    expect(readStepNumber("123456789. Go", 0)).toBe(123456789);
  });
  it("reads a number inside a quote at the given offset", () => {
    expect(readStepNumber("> 7. Go", 2)).toBe(7);
  });
  it("rejects a ten digit run", () => {
    expect(readStepNumber("1234567890. Go", 0)).toBeUndefined();
  });
  it("rejects text with no digits", () => {
    expect(readStepNumber("- Go", 0)).toBeUndefined();
  });
  it("rejects digits with no marker", () => {
    expect(readStepNumber("12 Go", 0)).toBeUndefined();
  });
  it("rejects a digit run at the very end of the source", () => {
    expect(readStepNumber("abc 12", 4)).toBeUndefined();
  });
  it("rejects an offset past the end", () => {
    expect(readStepNumber("1.", 5)).toBeUndefined();
  });
  it("rejects a negative offset", () => {
    expect(readStepNumber("1.", -1)).toBeUndefined();
  });
});

describe("procedureNumbering", () => {
  it("finds all ones", () => {
    expect(procedureNumbering([1, 1, 1])).toBe("all-ones");
  });
  it.each([[[1, 2, 3]], [[4, 5, 6]], [[0, 1]]])("%j is sequential", (list) => {
    expect(procedureNumbering(list)).toBe("sequential");
  });
  it.each([[[1]], [[]], [[1, 3, 4]], [[1, 1, 2]], [[2, 2]], [[1, undefined]]])(
    "%j has no pattern",
    (list) => {
      expect(procedureNumbering(list)).toBeUndefined();
    },
  );
});
