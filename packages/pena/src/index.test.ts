import { describe, expect, it } from "vitest";
import { engineName } from "./index.js";

describe("pena", () => {
  it("exports the engine name", () => {
    expect(engineName).toBe("Pena");
  });
});
