import { engineName } from "@tulis/pena";
import { describe, expect, it } from "vitest";
import { describeExtension } from "./index.js";

describe("vscode extension", () => {
  it("mentions the engine name", () => {
    expect(describeExtension()).toContain(engineName);
  });
});
