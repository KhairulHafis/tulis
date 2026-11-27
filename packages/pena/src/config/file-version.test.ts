import { describe, expect, it } from "vitest";
import {
  INVALID_VERSION_MESSAGE,
  MISSING_VERSION_MESSAGE,
  newerVersionMessage,
  readFileVersion,
} from "./file-version.js";

describe("readFileVersion", () => {
  it("reports a missing key", () => {
    expect(readFileVersion({}, 1)).toEqual({ status: "missing" });
  });

  it("treats null as missing", () => {
    expect(readFileVersion({ version: null }, 1)).toEqual({
      status: "missing",
    });
  });

  it("accepts 1 and the current version", () => {
    expect(readFileVersion({ version: 1 }, 3)).toEqual({
      status: "supported",
      version: 1,
    });
    expect(readFileVersion({ version: 3 }, 3)).toEqual({
      status: "supported",
      version: 3,
    });
  });

  it("reports a newer version", () => {
    expect(readFileVersion({ version: 4 }, 3)).toEqual({
      status: "newer",
      version: 4,
    });
  });

  it.each([0, -1, 1.5, "1", true, [], {}, Number.NaN, 2 ** 60, Infinity])(
    "refuses %j",
    (version) => {
      expect(readFileVersion({ version }, 1)).toEqual({ status: "invalid" });
    },
  );

  it("ignores an inherited version", () => {
    const map: Record<string, unknown> = {};
    Object.setPrototypeOf(map, { version: 2 });
    expect(readFileVersion(map, 1)).toEqual({ status: "missing" });
  });

  it("does not treat __proto__ as a version", () => {
    const map = JSON.parse('{"__proto__": {"version": 2}}') as Record<
      string,
      unknown
    >;
    expect(readFileVersion(map, 1)).toEqual({ status: "missing" });
  });
});

describe("version messages", () => {
  it("keeps the wording", () => {
    expect(MISSING_VERSION_MESSAGE).toBe(
      "No version line, so the file is read as version 1. Add `version: 1` at the top.",
    );
    expect(INVALID_VERSION_MESSAGE).toBe(
      "version must be a whole number, 1 or more.",
    );
    expect(newerVersionMessage(3)).toBe(
      "This file was made by a newer version of Tulis (file version 3). Please upgrade Tulis.",
    );
  });
});
