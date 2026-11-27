import { describe, expect, it } from "vitest";
import { engineName, prepareDoc } from "./index.js";

describe("pena", () => {
  it("exports the engine name", () => {
    expect(engineName).toBe("Pena");
  });

  it("exports prepareDoc, which prepares a one-line doc", () => {
    const doc = prepareDoc("Hello there.\n", "markdown");
    expect(doc.kind).toBe("prepared");
    if (doc.kind === "prepared") {
      expect(doc.blocks[0]?.sentences[0]?.text).toBe("Hello there.");
    }
  });
});
