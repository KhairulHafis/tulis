import { describe, expect, it } from "vitest";
import { termKey } from "./term-key.js";

const hyphen2010 = String.fromCodePoint(0x2010);
const hyphen2011 = String.fromCodePoint(0x2011);
const softHyphen = String.fromCodePoint(0x00ad);
const combiningAcute = String.fromCodePoint(0x0301);
const composedE = String.fromCodePoint(0x00e9);

describe("termKey", () => {
  it("lower-cases and drops spaces and hyphens", () => {
    expect(termKey("Log-In")).toBe("login");
    expect(termKey("log in")).toBe("login");
    expect(termKey("login")).toBe("login");
  });

  it("drops U+2010, U+2011 and soft hyphens", () => {
    expect(termKey("log" + hyphen2010 + "in")).toBe("login");
    expect(termKey("log" + hyphen2011 + "in")).toBe("login");
    expect(termKey("lo" + softHyphen + "gin")).toBe("login");
  });

  it("drops tabs and line breaks", () => {
    expect(termKey("log\t in\r\n")).toBe("login");
    expect(termKey("log\nin")).toBe("login");
  });

  it("composes to NFC", () => {
    expect(termKey("e" + combiningAcute)).toBe(termKey(composedE));
    expect(termKey("e" + combiningAcute)).toBe(composedE);
  });

  it("keeps the dots of e.g.", () => {
    expect(termKey("E.g.")).toBe("e.g.");
  });
});
