import { describe, expect, it } from "vitest";
import { inflectedForms } from "./word-forms.js";

function expectForms(variant: string, expected: readonly string[]): void {
  expect(inflectedForms(variant)).toEqual(
    expect.arrayContaining([...expected]),
  );
}

describe("inflectedForms", () => {
  it("inflects the first word of a phrase", () => {
    expectForms("log in", ["logs in", "logged in", "logging in"]);
    expectForms("sign in", ["signs in", "signed in", "signing in"]);
    expectForms("click", ["clicks", "clicked", "clicking"]);
  });

  it("knows irregular verbs", () => {
    expectForms("choose", ["chooses", "chose", "chosen", "choosing"]);
    expectForms("go", ["goes", "went", "gone", "going"]);
  });

  it("doubles the last letter and keeps the plain forms", () => {
    expectForms("log", ["logged", "logging", "loged", "loging"]);
  });

  it("does not make a regular past form for an irregular verb", () => {
    const forms = inflectedForms("set up");
    expect(forms).toContain("sets up");
    expect(forms).toContain("setting up");
    expect(forms).not.toContain("setted up");
  });

  it("handles final e, y and ie", () => {
    expectForms("close", ["closes", "closed", "closing"]);
    expectForms("apply", ["applies", "applied", "applying"]);
    expectForms("tie", ["tying"]);
    expectForms("free", ["freed", "freeing"]);
  });

  it("handles endings in ch, oe and w", () => {
    expectForms("match", ["matches", "matched", "matching"]);
    expectForms("shoe", ["shoes", "shoed", "shoeing"]);
    const flow = inflectedForms("flow");
    expect(flow).toContain("flowed");
    expect(flow).not.toContain("flowwed");
    expect(flow).not.toContain("flowwing");
  });

  it("pluralises the last word of a phrase", () => {
    expectForms("access token", ["access tokens"]);
    expectForms("API token", ["api tokens"]);
    expectForms("for example", ["for examples"]);
  });

  it("gives nothing for words with digits or dots", () => {
    expect(inflectedForms("e.g.")).toEqual([]);
    expect(inflectedForms("2fa")).toEqual([]);
  });

  it("has no repeats and never the base", () => {
    for (const variant of ["cut", "set up", "log in", "API token", "go"]) {
      const forms = inflectedForms(variant);
      expect(new Set(forms).size).toBe(forms.length);
      expect(forms).not.toContain(variant.toLowerCase());
    }
  });

  it("treats a hyphenated word as one word", () => {
    expectForms("log-in", ["log-ins"]);
  });
});
