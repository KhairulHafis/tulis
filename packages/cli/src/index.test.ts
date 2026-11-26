import { engineName } from "@tulis/pena";
import { describe, expect, it } from "vitest";
import { describeCli } from "./index.js";

describe("cli", () => {
  it("mentions the engine name", () => {
    expect(describeCli()).toContain(engineName);
  });
});
