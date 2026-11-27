import { afterEach, describe, expect, it, vi } from "vitest";
import { MaskedTextBuilder, type MaskedText } from "../markdown/masked-text.js";
import { createProductNameMatcher } from "../markdown/product-names.js";
import { parseMarkdown } from "../markdown/parse-markdown.js";
import { collectProseBlocks, proseUnit } from "../markdown/prose-units.js";
import type { Sentence } from "../markdown/sentences.js";
import {
  SENTENCE_START_VERBS,
  tagSentence,
  type PartOfSpeech,
  type TaggedToken,
  type VerbForm,
} from "./tag-tokens.js";
import { tokenizeSentence, type Token } from "./tokens.js";

/** The tokens of the first sentence of the first prose block. */
function tokensOf(markdown: string): Token[] {
  const parsed = parseMarkdown(markdown, "markdown");
  if (parsed.kind !== "parsed") {
    throw new Error("did not parse");
  }
  const block = collectProseBlocks(parsed.tree)[0];
  if (block === undefined) {
    throw new Error("no prose block");
  }
  const unit = proseUnit(block, parsed, {
    productNames: createProductNameMatcher(["Acme"]),
  });
  const sentence = unit.sentences[0];
  if (sentence === undefined) {
    throw new Error("no sentence");
  }
  return tokenizeSentence(unit.masked, sentence);
}

function tagged(markdown: string): TaggedToken[] {
  return tagSentence(tokensOf(markdown));
}

/** Finds a token by its text. */
function at(tokens: readonly TaggedToken[], text: string): TaggedToken {
  const found = tokens.find((token) => token.text === text);
  if (found === undefined) {
    throw new Error("no token " + text);
  }
  return found;
}

function expectTag(
  tokens: readonly TaggedToken[],
  text: string,
  pos: PartOfSpeech,
  verbForm?: VerbForm,
): void {
  const token = at(tokens, text);
  expect([text, token.pos, token.verbForm]).toEqual([text, pos, verbForm]);
}

describe("tagSentence parts of speech", () => {
  it("tags a gerund", () => {
    expectTag(
      tagged("Installing the agent takes minutes."),
      "Installing",
      "verb",
      "gerund",
    );
  });

  it("tags a past tense verb", () => {
    expectTag(
      tagged("The agent installed the plugin."),
      "installed",
      "verb",
      "past",
    );
  });

  it("tags a present tense verb", () => {
    expectTag(
      tagged("The agent installs the plugin."),
      "installs",
      "verb",
      "present",
    );
  });

  it("tags a base verb after a modal, and the modal has no form", () => {
    const tokens = tagged("You can run it.");
    expectTag(tokens, "can", "verb", undefined);
    expectTag(tokens, "run", "verb", "base");
  });

  it("tags pronouns, determiners, prepositions and nouns", () => {
    const tokens = tagged("She gave them the book in the room.");
    expectTag(tokens, "She", "pronoun");
    expectTag(tokens, "them", "pronoun");
    expectTag(tokens, "the", "determiner");
    expectTag(tokens, "in", "preposition");
    expectTag(tokens, "room", "noun");
  });

  it("tags conjunctions, adverbs and adjectives", () => {
    const tokens = tagged("Use it now and keep a fine copy.");
    expectTag(tokens, "and", "conjunction");
    expectTag(tokens, "now", "adverb");
    expectTag(tokens, "fine", "adjective");
  });

  it("tags a capitalised name in the middle of a sentence", () => {
    expectTag(tagged("We met Alice at the door."), "Alice", "properNoun");
  });

  it("gives words the tagger does not know the pos other", () => {
    expectTag(tagged("Well install it."), "Well", "other");
  });

  it("leaves verbForm undefined for words that are not verbs", () => {
    for (const token of tagged("The agent installed the plugin.")) {
      if (token.pos !== "verb") {
        expect(token.verbForm).toBeUndefined();
      }
    }
  });
});

describe("tagSentence token kinds", () => {
  it("tags each placeholder kind as placeholder", () => {
    const tokens = tagged("Use `kubectl` and **Save** and Acme.");
    const placeholders = tokens.filter((token) => token.kind === "placeholder");
    expect(placeholders.map((token) => token.placeholder)).toEqual([
      "CODE",
      "UI",
      "PRODUCT",
    ]);
    for (const token of placeholders) {
      expect([token.pos, token.verbForm]).toEqual(["placeholder", undefined]);
    }
  });

  it("tags punctuation and symbols whatever the tagger says", () => {
    const tokens = tagged("Run it, now: 5 > 3 & done.");
    expectTag(tokens, ",", "punctuation");
    expectTag(tokens, ":", "punctuation");
    expectTag(tokens, ".", "punctuation");
    expectTag(tokens, ">", "symbol");
    expectTag(tokens, "&", "punctuation");
  });

  it("tags numbers as number", () => {
    const tokens = tagged("Wait 12 minutes for 1.2 GB.");
    expectTag(tokens, "12", "number");
    expectTag(tokens, "1.2", "number");
  });

  it("lets placeholders help the tagger: Click before a placeholder", () => {
    expectTag(tagged("Click **Save**."), "Click", "verb", "base");
  });

  it("shows commas and colons to the tagger", () => {
    // The colon changes how the tagger reads the first word.
    const plain = tagged("Install the agent.");
    const colon = tagged("Install: the agent.");
    expect(plain[0]?.pos).toBe("verb");
    expect(colon[0]?.pos).not.toBe("verb");
  });

  it("handles leading punctuation", () => {
    const tokens = tagged('"Install the agent."');
    expectTag(tokens, '"', "punctuation");
    expect(tokens.map((token) => token.pos)).toContain("determiner");
  });
});

describe("tagSentence start corrections", () => {
  it("corrects a start word the tagger reads as a noun", () => {
    expectTag(tagged("Download the file."), "Download", "verb", "base");
  });

  it("corrects Select before a placeholder", () => {
    expectTag(tagged("Select **Settings**."), "Select", "verb", "base");
  });

  it("keeps Download options a noun", () => {
    const tokens = tagged("Download options");
    expectTag(tokens, "Download", "noun");
  });

  it("does not correct a start word later in the sentence", () => {
    const tokens = tokensOf("The agent will select it.");
    const result = tagSentence(tokens);
    expectTag(result, "select", "verb", "base");
  });

  it("keeps the start verbs lowercase and non-empty", () => {
    for (const word of SENTENCE_START_VERBS) {
      expect(word).toBe(word.toLowerCase());
      expect(word.length).toBeGreaterThan(0);
    }
    expect(SENTENCE_START_VERBS.has("select")).toBe(true);
  });

  it("tags a lone Overview as a noun in any case", () => {
    expectTag(tagged("Overview"), "Overview", "noun");
    expectTag(tagged("OVERVIEW"), "OVERVIEW", "noun");
    expectTag(tagged("overview"), "overview", "noun");
  });

  it("leaves Overview alone when it is not the only word", () => {
    const tokens = tagged("Overview of the agent");
    expect(at(tokens, "Overview").pos).not.toBe("other");
  });
});

describe("tagSentence alignment", () => {
  it("tags contractions as one word each, without losing alignment", () => {
    const tokens = tagged("I'm sure it's fine, don't worry, it can't fail.");
    expectTag(tokens, "I'm", "pronoun");
    expectTag(tokens, "it's", "pronoun");
    expectTag(tokens, "don't", "verb");
    expectTag(tokens, "worry", "verb", "base");
    expectTag(tokens, "fail", "verb", "base");
    expect(at(tokens, "can't").pos).toBe("verb");
  });

  it("handles a curly apostrophe", () => {
    const tokens = tagged("It won’t work.");
    expectTag(tokens, "won’t", "verb");
    expectTag(tokens, "work", "verb", "base");
  });

  it("handles hyphenated words", () => {
    const tokens = tagged("A well-known fix is a built-in default.");
    expect(at(tokens, "well-known").pos).not.toBe("other");
    expect(at(tokens, "built-in").pos).not.toBe("other");
    expectTag(tokens, "is", "verb", "present");
  });

  it("returns one token per token, in order, with the fields unchanged", () => {
    const tokens = tokensOf("Select **Settings** > **General**, then 3 `x`.");
    const result = tagSentence(tokens);
    expect(result).toHaveLength(tokens.length);
    result.forEach((item, index) => {
      const original = tokens[index];
      expect(original).toBeDefined();
      expect({
        text: item.text,
        kind: item.kind,
        placeholder: item.placeholder,
        maskedStart: item.maskedStart,
        maskedEnd: item.maskedEnd,
        source: item.source,
      }).toEqual(original);
    });
  });

  it("does not change the tokens it is given", () => {
    const tokens = tokensOf("Install the agent.");
    const copy = structuredClone(tokens);
    tagSentence(tokens);
    expect(tokens).toEqual(copy);
  });

  it("returns an empty list for no tokens", () => {
    expect(tagSentence([])).toEqual([]);
  });

  it("tags a sentence with no terms", () => {
    const result = tagged("...");
    expect(result.every((token) => token.pos === "punctuation")).toBe(true);
  });
});

/** A masked text and sentence for plain text, for hand-made input. */
function plain(text: string): { masked: MaskedText; sentence: Sentence } {
  const builder = new MaskedTextBuilder();
  builder.appendReplacement(text, 0, text.length);
  return {
    masked: builder.build(),
    sentence: {
      text,
      maskedStart: 0,
      maskedEnd: text.length,
      source: { start: 0, end: text.length },
    },
  };
}

interface FakeTerm {
  text: string;
}

/** Loads tag-tokens with a fake compromise, so the answer can be wrong. */
async function withFakeTagger(
  fake: (terms: readonly FakeTerm[]) => unknown,
): Promise<typeof import("./tag-tokens.js")> {
  vi.resetModules();
  vi.doMock("compromise/two", () => ({
    default: (input: readonly { terms: readonly FakeTerm[] }[]) => ({
      json: () => fake(input[0]?.terms ?? []),
    }),
  }));
  return import("./tag-tokens.js");
}

describe("tagSentence with a misbehaving tagger", () => {
  afterEach(() => {
    vi.doUnmock("compromise/two");
    vi.resetModules();
  });

  const verbTag = (terms: readonly FakeTerm[]): unknown[] => [
    { terms: terms.map((term) => ({ text: term.text, tags: ["Verb"] })) },
  ];

  it("hands the tagger chunks of at most 1,000 terms", async () => {
    const sizes: number[] = [];
    const { tagSentence: fakeTagged } = await withFakeTagger((terms) => {
      sizes.push(terms.length);
      return verbTag(terms);
    });
    const { masked, sentence } = plain("word ".repeat(2500).trim());
    const result = fakeTagged(tokenizeSentence(masked, sentence));
    expect(result).toHaveLength(2500);
    expect(sizes).toEqual([1000, 1000, 500]);
    expect(result.every((token) => token.pos === "verb")).toBe(true);
  });

  it("tags a chunk other when the term count differs", async () => {
    const { tagSentence: fakeTagged } = await withFakeTagger((terms) => [
      { terms: terms.slice(1).map((t) => ({ text: t.text, tags: ["Verb"] })) },
    ]);
    const { masked, sentence } = plain("the agent runs");
    const result = fakeTagged(tokenizeSentence(masked, sentence));
    expect(result).toHaveLength(3);
    expect(result.map((token) => token.pos)).toEqual([
      "other",
      "other",
      "other",
    ]);
  });

  it("tags other chunks only: a good chunk keeps its tags", async () => {
    let call = 0;
    const { tagSentence: fakeTagged } = await withFakeTagger((terms) => {
      call += 1;
      return call === 1 ? [{ terms: [] }] : verbTag(terms);
    });
    const { masked, sentence } = plain("word ".repeat(1500).trim());
    const result = fakeTagged(tokenizeSentence(masked, sentence));
    expect(result[0]?.pos).toBe("other");
    expect(result[999]?.pos).toBe("other");
    expect(result[1000]?.pos).toBe("verb");
  });

  it("does not re-align an empty term that is not a contraction", async () => {
    const { tagSentence: fakeTagged } = await withFakeTagger((terms) => [
      {
        terms: [...terms, { text: "" }].map((t) => ({
          text: t.text,
          tags: ["Verb"],
        })),
      },
    ]);
    const { masked, sentence } = plain("the agent");
    const result = fakeTagged(tokenizeSentence(masked, sentence));
    expect(result.map((token) => token.pos)).toEqual(["other", "other"]);
  });

  it("does not throw on shapes it does not expect", async () => {
    for (const shape of [undefined, null, 5, [], [null], [{ terms: 3 }]]) {
      const { tagSentence: fakeTagged } = await withFakeTagger(() => shape);
      const { masked, sentence } = plain("the agent");
      const result = fakeTagged(tokenizeSentence(masked, sentence));
      expect(result.map((token) => token.pos)).toEqual(["other", "other"]);
    }
  });
});
