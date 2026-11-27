import { describe, expect, it } from "vitest";
import type { TaggedToken } from "../language/tag-tokens.js";
import { prepareDoc } from "../prepare/prepare-doc.js";
import { sentenceTags } from "../prepare/sentence-tags.js";
import { findPurposeClause, mayHavePurposeClause } from "./purpose-clause.js";

function tagsOf(text: string): readonly TaggedToken[] {
  const doc = prepareDoc(text + "\n", "markdown");
  if (doc.kind !== "prepared") {
    throw new Error("expected a prepared doc");
  }
  const sentence = doc.blocks[0]?.sentences[0];
  if (sentence === undefined) {
    throw new Error("expected a sentence");
  }
  return sentenceTags(sentence);
}

/** The clause as "position: masked text", or undefined. */
function clauseOf(text: string): string | undefined {
  const tags = tagsOf(text);
  const clause = findPurposeClause(tags);
  if (clause === undefined) {
    return undefined;
  }
  const words = tags.slice(clause.first, clause.last + 1);
  return clause.position + ": " + words.map((t) => t.text).join(" ");
}

describe("start rule", () => {
  const cases: readonly [string, string][] = [
    [
      "To get the IP address, run the following command.",
      "To get the IP address",
    ],
    ["In order to save space, delete old logs.", "In order to save space"],
    ["To begin, log in to the portal.", "To begin"],
    ["To delete a runner, you can use the API.", "To delete a runner"],
    [
      "To turn on access control, add the following to `gitlab.rb`:",
      "To turn on access control",
    ],
    [
      "To get the name, the ID, and the URL, run `glab repo view`.",
      "To get the name , the ID , and the URL",
    ],
  ];
  for (const [text, clause] of cases) {
    it("finds a start clause in: " + text, () => {
      expect(clauseOf(text)).toBe("start: " + clause);
    });
  }

  const none = [
    "To install the agent:",
    "To mitigate the impact, the API provides a watch event.",
    "To use Dpl you need Ruby.",
    "To date, no issues were found.",
    // "date" is a start idiom; the instruction after the comma would otherwise
    // make this a start clause.
    "To date, run the tests.",
  ];
  for (const text of none) {
    it("records nothing for: " + text, () => {
      expect(clauseOf(text)).toBeUndefined();
    });
  }

  // Known tagger miss: the tagger reads "first" as a number and "set" as a
  // noun, so no instruction is seen after the comma. Precision first: nothing
  // is recorded rather than a guess.
  it("records nothing for: To encrypt it, first set `x` to `true`. (known tagger miss)", () => {
    expect(clauseOf("To encrypt it, first set `x` to `true`.")).toBeUndefined();
  });
});

describe("end rule", () => {
  const cases: readonly [string, string][] = [
    [
      "Run the following command to get the IP address.",
      "to get the IP address",
    ],
    ["Select **Save** to apply your changes.", "to apply your changes"],
    ["Use `kubectl logs` to view the output.", "to view the output"],
    [
      "You can use the API to retrieve the current value.",
      "to retrieve the current value",
    ],
    ["Run `make` in order to build the docs.", "in order to build the docs"],
    [
      "Save the file and restart GitLab to apply the changes.",
      "to apply the changes",
    ],
    [
      "Run `kubectl create` to print the object that will be created:",
      "to print the object that will be created",
    ],
    ["Follow these steps to install the agent.", "to install the agent"],
    ["Select **Save** to continue.", "to continue"],
    ["Select the stream to view its details.", "to view its details"],
    ["Type the following command to start the server.", "to start the server"],
  ];
  for (const [text, clause] of cases) {
    it("finds an end clause in: " + text, () => {
      expect(clauseOf(text)).toBe("end: " + clause);
    });
  }

  const none = [
    "You need to restart the server.",
    "Learn how to configure the runner.",
    "Make sure to replace the values.",
    "Configure the runner to use Docker.",
    "Allow API servers to expose the hash.",
    "Restart GitLab for the changes to take effect.",
    "Set `x` to `true`.",
    "Add the user to the group.",
    "Create a role that allows users to read pods.",
    "This makes it easier to create clusters.",
    "Users have the ability to read namespaces.",
    "Kubernetes uses labels to select pods.",
    // The modal is skipped, so "configure" is the main verb (a complement verb).
    "You can configure the runner to use Docker.",
    // A noun that takes an infinitive, and an adjective before "to".
    "Use the option to read the file.",
    "Keep the server ready to run the tests.",
    "Can be set to `true` to disable the limit.",
    "Must be greater than zero to avoid stale content.",
    "Does not allow users to edit files.",
    "The command runs the job to completion.",
    // Round 2 shapes.
    "Specify the group and resource to check:",
    "Select the stream to expand.",
    "Type of integration to create.",
    "List the files to be scanned.",
    "Point your web server to serve the files.",
    "You can schedule Gitaly to run a daily task.",
    "Reconfigure a node to connect to the database.",
    "You must have access to create namespaces.",
    // "have" and "project" read as imperative verbs but are not instructions.
    "Have the team to review the change.",
    "Project settings to use the new runner.",
    "Network settings to use the new runner.",
  ];
  for (const text of none) {
    it("records nothing for: " + text, () => {
      expect(clauseOf(text)).toBeUndefined();
    });
  }

  // The tagger reads the final "to" as a conjunction, not a preposition; the
  // relative-infinitive rule counts a plain "to" as one, so nothing is recorded.
  it("records nothing for: Choose a version to upgrade to.", () => {
    expect(clauseOf("Choose a version to upgrade to.")).toBeUndefined();
  });

  // Known tagger miss: the tagger reads "guide" as a verb before "to", so the
  // scan stops. Precision first: nothing is recorded rather than a guess.
  it("records nothing for: See the deployment guide to learn more. (known tagger miss)", () => {
    expect(
      clauseOf(
        "See the [deployment guide](https://example.com) to learn more.",
      ),
    ).toBeUndefined();
  });
});

describe("rule order", () => {
  it("records only the start clause when both are present", () => {
    expect(clauseOf("To save space, delete old logs to free disk.")).toBe(
      "start: To save space",
    );
  });

  it("handles an empty token list", () => {
    expect(findPurposeClause([])).toBeUndefined();
  });
});

describe("mayHavePurposeClause", () => {
  function tokensOf(text: string) {
    const doc = prepareDoc(text + "\n", "markdown");
    if (doc.kind !== "prepared") {
      throw new Error("expected a prepared doc");
    }
    const sentence = doc.blocks[0]?.sentences[0];
    if (sentence === undefined) {
      throw new Error("expected a sentence");
    }
    return sentence.tokens;
  }

  it("is false without a word to", () => {
    expect(mayHavePurposeClause(tokensOf("Run the command."))).toBe(false);
  });
  it("is false when the first token cannot start an instruction", () => {
    expect(mayHavePurposeClause(tokensOf("The API runs to the end."))).toBe(
      false,
    );
  });
  it("is false for a first placeholder and a first number", () => {
    expect(mayHavePurposeClause(tokensOf("`run` to start."))).toBe(false);
    expect(mayHavePurposeClause(tokensOf("5 steps to start."))).toBe(false);
  });
  it("is true for instruction-like sentences with to", () => {
    for (const text of [
      "Run the command to start.",
      "To start, run the command.",
      "You can use it to start.",
    ]) {
      expect(mayHavePurposeClause(tokensOf(text))).toBe(true);
    }
  });
});
