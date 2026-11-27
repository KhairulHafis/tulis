import { afterEach, describe, expect, it, vi } from "vitest";
import { tagSentence } from "../language/tag-tokens.js";
import { prepareDoc, type PreparedSentence } from "./prepare-doc.js";
import { sentenceTags } from "./sentence-tags.js";

function firstSentence(text: string): PreparedSentence {
  const doc = prepareDoc(text, "markdown");
  if (doc.kind !== "prepared") {
    throw new Error("did not prepare");
  }
  const sentence = doc.blocks[0]?.sentences[0];
  if (sentence === undefined) {
    throw new Error("no sentence");
  }
  return sentence;
}

describe("sentenceTags", () => {
  it("matches tagSentence on the sentence tokens", () => {
    const sentence = firstSentence("Open the file now.\n");
    expect(sentenceTags(sentence)).toEqual(tagSentence(sentence.tokens));
  });

  it("returns the same array on a second call", () => {
    const sentence = firstSentence("Open the file now.\n");
    expect(sentenceTags(sentence)).toBe(sentenceTags(sentence));
  });
});

describe("laziness", () => {
  afterEach(() => {
    vi.doUnmock("../language/tag-tokens.js");
    vi.resetModules();
  });

  it("never tags during prepareDoc, and tags once per sentence", async () => {
    const calls: number[] = [];
    vi.resetModules();
    vi.doMock("../language/tag-tokens.js", () => ({
      tagSentence: (tokens: readonly unknown[]) => {
        calls.push(tokens.length);
        return [];
      },
    }));
    const prepare = await import("./prepare-doc.js");
    const tags = await import("./sentence-tags.js");
    const doc = prepare.prepareDoc("One here. Two there.\n", "markdown");
    expect(calls).toEqual([]);
    if (doc.kind !== "prepared") {
      throw new Error("did not prepare");
    }
    const sentence = doc.blocks[0]?.sentences[0];
    if (sentence === undefined) {
      throw new Error("no sentence");
    }
    tags.sentenceTags(sentence);
    tags.sentenceTags(sentence);
    expect(calls).toHaveLength(1);
  });
});
