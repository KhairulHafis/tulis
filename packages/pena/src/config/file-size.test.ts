import { describe, expect, it } from "vitest";
import {
  DEFAULT_MAX_FILE_SIZE,
  MAX_MAX_FILE_SIZE,
  MIN_MAX_FILE_SIZE,
  parseFileSize,
} from "./file-size.js";

describe("parseFileSize", () => {
  it("has the expected constants", () => {
    expect(MIN_MAX_FILE_SIZE).toBe(1024);
    expect(MAX_MAX_FILE_SIZE).toBe(10485760);
    expect(DEFAULT_MAX_FILE_SIZE).toBe(1048576);
  });

  it.each([
    ["1KB", 1024],
    ["500KB", 512000],
    ["1MB", 1048576],
    ["10MB", 10485760],
    ["99999KB", 99999 * 1024],
    [0, 0],
    [1024, 1024],
    [1048576, 1048576],
  ])("accepts %s", (input, expected) => {
    expect(parseFileSize(input)).toBe(expected);
  });

  it.each([
    "1mb",
    "1 MB",
    "1.5MB",
    "01MB",
    "0KB",
    "100000KB",
    "1GB",
    "1KiB",
    "1B",
    "MB",
    "",
    "1048576",
    -1,
    1.5,
    NaN,
    Infinity,
    2 ** 53,
    true,
    null,
    undefined,
    {},
    [],
  ])("refuses %j", (input) => {
    expect(parseFileSize(input)).toBeUndefined();
  });

  it("refuses a very long digit string quickly", () => {
    const start = Date.now();
    expect(parseFileSize("1".repeat(100000) + "MB")).toBeUndefined();
    expect(Date.now() - start).toBeLessThan(500);
  });
});
