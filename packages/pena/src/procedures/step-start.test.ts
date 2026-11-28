import { describe, expect, it } from "vitest";
import { tagSentence } from "../language/tag-tokens.js";
import type { Token } from "../language/tokens.js";
import { prepareDoc } from "../prepare/prepare-doc.js";
import { sentenceTags } from "../prepare/sentence-tags.js";
import { stepStart } from "./step-start.js";

function stepOf(text: string): ReturnType<typeof stepStart> {
  const doc = prepareDoc("1. " + text + "\n", "markdown");
  if (doc.kind !== "prepared") {
    throw new Error("not prepared");
  }
  const sentence = doc.blocks[0]?.sentences[0];
  if (sentence === undefined) {
    throw new Error("no sentence");
  }
  return stepStart(sentence.tokens, sentenceTags(sentence));
}

function tokenOf(text: string, kind: Token["kind"], at: number): Token {
  return {
    text,
    kind,
    placeholder: undefined,
    maskedStart: at,
    maskedEnd: at + text.length,
    source: { start: at, end: at + text.length },
  };
}

/** Builds "w1 w2 ... wN, select it" style tokens directly. */
function leadInTokens(count: number): Token[] {
  const tokens: Token[] = [];
  let at = 0;
  for (let i = 0; i < count; i += 1) {
    tokens.push(tokenOf("on", "word", at));
    at += 3;
  }
  tokens.push(tokenOf(",", "punctuation", at));
  at += 2;
  tokens.push(tokenOf("select", "word", at));
  at += 7;
  tokens.push(tokenOf("it", "word", at));
  return tokens;
}

describe("stepStart", () => {
  it.each([
    "Install the agent.",
    "Select **Save changes**.",
    "In the left sidebar, select **Settings** > **CI/CD**.",
    "In the upper-right corner, select **Edit**.",
    "If prompted, enter your password.",
    "Optional: Select **Remember me**.",
    "Optionally, run `make test`.",
    "To the right of the header, select **Delete**.",
    "On the left sidebar, expand **Advanced**.",
    "After the job finishes, check the logs.",
    "Under **Visibility**, clear the checkbox.",
    "Next, configure the runner.",
    "Note: Restart the server.",
    "Run:",
    "For **Name**, enter a name.",
    "Then, restart the service.",
    "Once the page loads, select **Next**.",
    "On the left sidebar, under **Settings**, select **General**.",
  ])("imperative: %s", (text) => {
    expect(stepOf(text)).toBe("imperative");
  });

  it.each([
    "The kubelet transitions the Pod into a terminal phase.",
    "You can now select **Save**.",
    "In this example, the following flags were used.",
    "In a large cluster with many nodes and many namespaces and several teams and many workloads, select **Save**.",
    "Optional: The setting is ignored.",
    "Optional:",
    "`kubectl` is installed.",
    "Clicking **Save** applies the change.",
    "Download options are listed below.",
    "Expiration: The token expires after a day.",
    "If you use a proxy, the request fails.",
    "**Save** the file.",
    "In A, B, C, D, select **Save**.",
  ])("other: %s", (text) => {
    expect(stepOf(text)).toBe("other");
  });

  it("other: Uncordon the node (known tagger miss)", () => {
    expect(stepOf("Uncordon the node.")).toBe("other");
  });

  it("undefined: only punctuation", () => {
    const tokens = [tokenOf(".", "punctuation", 0)];
    expect(stepStart(tokens, tagSentence(tokens))).toBeUndefined();
  });

  it("undefined: only a symbol and punctuation", () => {
    const tokens = [tokenOf(">", "symbol", 0), tokenOf(".", "punctuation", 2)];
    expect(stepStart(tokens, tagSentence(tokens))).toBeUndefined();
  });

  it("undefined: empty token list", () => {
    expect(stepStart([], [])).toBeUndefined();
  });

  it("a lead-in of exactly 12 counting tokens still counts", () => {
    const tokens = leadInTokens(12);
    expect(stepStart(tokens, tagSentence(tokens))).toBe("imperative");
  });

  it("a lead-in of 13 counting tokens does not count", () => {
    const tokens = leadInTokens(13);
    expect(stepStart(tokens, tagSentence(tokens))).toBe("other");
  });
});
