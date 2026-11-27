import { describe, expect, it } from "vitest";
import { prepareDoc, type PreparedSentence } from "../prepare/prepare-doc.js";
import { createTermMatcher, type TermEntry } from "./term-matcher.js";

const hyphen2010 = String.fromCodePoint(0x2010);
const hyphen2011 = String.fromCodePoint(0x2011);
const softHyphen = String.fromCodePoint(0x00ad);

function sentenceOf(text: string): [PreparedSentence, string] {
  const doc = prepareDoc(text, "markdown");
  if (doc.kind !== "prepared") {
    throw new Error("expected a prepared doc");
  }
  const sentence = doc.blocks[0]?.sentences[0];
  if (sentence === undefined) {
    throw new Error("expected a sentence");
  }
  return [sentence, doc.parsed.source];
}

const SIGN_IN: readonly TermEntry[] = [
  { text: "log in", group: 0 },
  { text: "sign in", group: 0 },
  { text: "log on", group: 0 },
];

function values(entries: readonly TermEntry[], text: string): string[] {
  return createTermMatcher(entries)
    .find(...sentenceOf(text))
    .map((match) => match.value);
}

describe("createTermMatcher", () => {
  it("matches case, hyphen and space spellings", () => {
    expect(values(SIGN_IN, "Log in, log-in, LOGIN and Log In.")).toEqual([
      "log in",
      "log-in",
      "login",
      "log in",
    ]);
  });

  it("returns the entry index and the range", () => {
    const text = "Please sign in now.";
    const [match] = createTermMatcher(SIGN_IN).find(...sentenceOf(text));
    expect(match?.entry).toBe(1);
    expect(match?.group).toBe(0);
    expect(text.slice(match?.range.start, match?.range.end)).toBe("sign in");
  });

  it("matches inflected forms as the base in the writer's spelling", () => {
    expect(
      values(
        SIGN_IN,
        "She logged-in, Logging on, signs in, and then Logged In.",
      ),
    ).toEqual(["log-in", "log on", "sign in", "log in"]);
    expect(
      values([{ text: "choose", group: 0 }], "Choosing, chose, chosen."),
    ).toEqual(["choose", "choose", "choose"]);
    expect(
      values([{ text: "API token", group: 0 }], "Two API tokens."),
    ).toEqual(["api token"]);
  });

  it("does not match inside a longer word", () => {
    expect(values(SIGN_IN, "A login-ify thing, and blog in it.")).toEqual([]);
  });

  it("never matches across or inside a placeholder", () => {
    expect(values(SIGN_IN, "Run `log` in now.")).toEqual([]);
    expect(values(SIGN_IN, "Log `x` in now.")).toEqual([]);
  });

  it("matches link text", () => {
    expect(values(SIGN_IN, "See [sign in](x.md) first.")).toEqual(["sign in"]);
  });

  it("is leftmost-longest within a group", () => {
    const entries: TermEntry[] = [
      { text: "log", group: 0 },
      { text: "log in", group: 0 },
    ];
    expect(values(entries, "Please log in.")).toEqual(["log in"]);
  });

  it("does not overlap within a group", () => {
    const entries: TermEntry[] = [{ text: "a a", group: 0 }];
    expect(values(entries, "a a a a a.")).toEqual(["a a", "a a"]);
  });

  it("lets two groups match the same words, ordered by group", () => {
    const entries: TermEntry[] = [
      { text: "enter", group: 1 },
      { text: "log in", group: 1 },
      { text: "log in", group: 0 },
    ];
    const matches = createTermMatcher(entries).find(...sentenceOf("Log in."));
    expect(matches.map((match) => match.group)).toEqual([0, 1]);
  });

  it("prefers a base key over an inflected one", () => {
    const entries: TermEntry[] = [
      { text: "log", group: 0 },
      { text: "logs", group: 0 },
    ];
    const [match] = createTermMatcher(entries).find(...sentenceOf("The logs."));
    expect(match?.entry).toBe(1);
    expect(match?.value).toBe("logs");
  });

  it("matches phrases spread over a soft-wrapped line", () => {
    expect(values(SIGN_IN, "Please log\nin here.")).toEqual(["log in"]);
  });

  it("keeps dots in e.g.", () => {
    expect(
      values([{ text: "e.g.", group: 0 }], "Pick one, e.g. this."),
    ).toEqual(["e.g."]);
  });

  it("collapses a long gap to one space", () => {
    const text = "a" + " ".repeat(500) + "b";
    expect(values([{ text: "a b", group: 0 }], text)).toEqual(["a b"]);
  });

  it("matches U+2010, U+2011 and soft-hyphen spellings", () => {
    const entries: TermEntry[] = [{ text: "log in", group: 0 }];
    expect(values(entries, "Do log" + hyphen2011 + "in.")).toEqual(["log-in"]);
    expect(values(entries, "Do log" + hyphen2010 + "in.")).toEqual(["log-in"]);
    expect(values(entries, "Do log" + softHyphen + "in.")).toEqual(["login"]);
  });

  it("matches a dash between words", () => {
    expect(values(SIGN_IN, "Please log - in.")).toEqual(["log - in"]);
  });

  it("does not match across two dashes in a row", () => {
    expect(values(SIGN_IN, "Please log - - in.")).toEqual([]);
  });

  it("never starts a match on a dash token", () => {
    const text = "Please - log in.";
    const [match] = createTermMatcher(SIGN_IN).find(...sentenceOf(text));
    expect(text.slice(match?.range.start, match?.range.end)).toBe("log in");
    expect(match?.value).toBe("log in");
  });

  it("never matches a placeholder, even for a variant written like one", () => {
    const entries: TermEntry[] = [{ text: "{CODE}", group: 0 }];
    expect(values(entries, "Run `x` now.")).toEqual([]);
    const phrase: TermEntry[] = [{ text: "run {CODE}", group: 0 }];
    expect(values(phrase, "Run `x` now.")).toEqual([]);
  });

  it("never ends a match on a dash token", () => {
    const text = "Please sign in -";
    const [match] = createTermMatcher(SIGN_IN).find(...sentenceOf(text));
    expect(text.slice(match?.range.start, match?.range.end)).toBe("sign in");
  });

  it("returns matches sorted by range start, then group", () => {
    const entries: TermEntry[] = [
      { text: "in", group: 2 },
      { text: "log in", group: 1 },
      { text: "log", group: 0 },
      { text: "log", group: 3 },
    ];
    const matches = createTermMatcher(entries).find(...sentenceOf("Log in."));
    expect(matches.map((m) => [m.range.start, m.group])).toEqual([
      [0, 0],
      [0, 1],
      [0, 3],
      [4, 2],
    ]);
  });

  it("restores the base word of an inflected form", () => {
    const cases: [string, string, string][] = [
      ["sign in", "She is signing in.", "sign in"],
      ["sign in", "Signing-in now.", "sign-in"],
      ["sign in", "He signed in.", "sign in"],
      ["log in", "Logging in now.", "log in"],
      ["choose", "She chose it.", "choose"],
      ["choose", "Choosing it.", "choose"],
      ["set up", "Setting up now.", "set up"],
      ["API token", "Two API tokens.", "api token"],
      ["sign-in", "Two sign-ins.", "sign-in"],
      ["close", "It closed.", "close"],
      ["apply", "It applied.", "apply"],
      ["go", "They went.", "go"],
    ];
    for (const [variant, text, expected] of cases) {
      expect(values([{ text: variant, group: 0 }], text)).toEqual([expected]);
    }
  });

  it("does not match across link or emphasis markup", () => {
    const logOn: TermEntry[] = [{ text: "log on", group: 0 }];
    expect(values(logOn, "[PostgreSQL log](../logs.md) on the server")).toEqual(
      [],
    );
    expect(
      values([{ text: "for example", group: 0 }], "Try for [example](x.md)."),
    ).toEqual([]);
    expect(values(SIGN_IN, "**log** in now.")).toEqual([]);
  });

  it("does not match across a block quote marker", () => {
    expect(values(SIGN_IN, "> log\n> in now.")).toEqual([]);
    expect(values(SIGN_IN, "log\n> in now.")).toEqual([]);
  });

  it("matches across a soft line break and inside one link", () => {
    expect(values(SIGN_IN, "Please log\nin now.")).toEqual(["log in"]);
    expect(values(SIGN_IN, "See [log in](x.md) now.")).toEqual(["log in"]);
  });

  it("matches nothing for a sentence with no tokens", () => {
    expect(createTermMatcher(SIGN_IN).find(...sentenceOf("."))).toEqual([]);
  });

  it("counts keys", () => {
    expect(createTermMatcher([]).keyCount).toBe(0);
    expect(createTermMatcher([{ text: "e.g.", group: 0 }]).keyCount).toBe(1);
  });
});
