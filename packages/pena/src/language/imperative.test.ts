import { describe, expect, it } from "vitest";
import { createProductNameMatcher } from "../markdown/product-names.js";
import { parseMarkdown } from "../markdown/parse-markdown.js";
import { collectProseBlocks, proseUnit } from "../markdown/prose-units.js";
import { findImperativeStart } from "./imperative.js";
import { tagSentence, type TaggedToken } from "./tag-tokens.js";
import { tokenizeSentence } from "./tokens.js";

/** Tags the first sentence of the first prose block of a Markdown text. */
function taggedOf(markdown: string): TaggedToken[] {
  const parsed = parseMarkdown(markdown, "markdown");
  if (parsed.kind !== "parsed") {
    throw new Error("did not parse");
  }
  const block = collectProseBlocks(parsed.tree)[0];
  if (block === undefined) {
    throw new Error("no prose block");
  }
  const unit = proseUnit(block, parsed, {
    productNames: createProductNameMatcher(["GitLab"]),
  });
  const sentence = unit.sentences[0];
  if (sentence === undefined) {
    throw new Error("no sentence");
  }
  return tagSentence(tokenizeSentence(unit.masked, sentence));
}

function firstWord(text: string): string {
  return text.replace(/^[^A-Za-z]+/u, "").split(/[^A-Za-z]/u)[0] ?? "";
}

const stepsYes = [
  "Install the agent.",
  "Update the config file.",
  "Copy the token.",
  "Run the following command:",
  "Set the variable.",
  "Log in to the console.",
  "Back up your data.",
  "Click **Save**.",
  "Select **Settings** > **General**.",
  "Open **Settings**.",
  "Configure `kubectl` to use the new context.",
  "Check the status of the pod.",
  "Restart the pod.",
  "Enable SSO for your group.",
  "Edit `config.toml`:",
  "Expand **Advanced**.",
  "Go to **Admin area**.",
  "Sign in to GitLab.",
  "Verify that the user's SAML `NameID` matches the SCIM `externalId`.",
  "Turn on the **Allow access** toggle.",
  "Download the latest release.",
  "Review the changes.",
  "Parse the exported dependency information.",
  "Select or type the operator to use.",
  "Grant them a role that allows them to create role bindings.",
  "Navigate to your home directory:",
  "Commit the changes:",
  "Apply the CNI plugin of your choice.",
  "Save the file and reconfigure GitLab.",
  "Clone the repository.",
  "Delete the job.",
  "Create a JSON config file for the API server.",
  "Familiarize yourself with the documentation repository.",
  "Test the connection.",
  "Generate a CA key pair:",
  "Uninstall the old version.",
];

const stepsNo = [
  "The agent starts.",
  "In the left sidebar, select **Settings** > **CI/CD**.",
  "If your cluster uses bootstrap tokens, update the ConfigMap.",
  "Optionally, run `make test`.",
  "You can use device plugins to integrate custom hardware.",
  "After installing the plugin, clean up the installation files:",
  "`kubectl apply` creates the object.",
  "Once applied, you can verify that the DaemonSet is running.",
  "There are no open requests.",
  "A Deployment makes sure a Pod is running.",
  "Installing the agent takes a few minutes.",
  "Optional: Select **Save**.",
  "1.2 GB of disk space is required.",
];

const headingsYes = [
  "Install the agent",
  "Upgrade GitLab",
  "Create a cluster",
  "Configure the runner",
  "Back up the database",
  "Set up SSH keys",
  "Enable two-factor authentication",
  "Add a user to a group",
  "Delete a project",
  "Run a pipeline manually",
  "Use a custom certificate",
  "View the logs",
  "Migrate to the new storage",
  "Troubleshoot failed jobs",
  "Deploy the application",
];

const headingsNo = [
  "Overview",
  "Installing the agent",
  "Prerequisites",
  "Troubleshooting",
  "Related topics",
  "Known issues",
  "How it works",
  "What's new",
  "`kubectl apply` options",
  "Example configuration",
  "Supported versions",
  "GitLab Runner",
  "Configuration options",
  "Before you begin",
  "Limitations",
  "Next steps",
  "Download options",
];

describe("findImperativeStart on steps", () => {
  for (const step of stepsYes) {
    it("finds the command verb in: " + step, () => {
      const found = findImperativeStart(taggedOf("1. " + step));
      expect(found?.text).toBe(firstWord(step));
    });
  }
  for (const step of stepsNo) {
    it("finds no command verb in: " + step, () => {
      expect(findImperativeStart(taggedOf("1. " + step))).toBeUndefined();
    });
  }
});

describe("findImperativeStart on headings", () => {
  for (const heading of headingsYes) {
    it("finds the command verb in: " + heading, () => {
      const found = findImperativeStart(taggedOf("## " + heading));
      expect(found?.text).toBe(firstWord(heading));
    });
  }
  for (const heading of headingsNo) {
    it("finds no command verb in: " + heading, () => {
      expect(findImperativeStart(taggedOf("## " + heading))).toBeUndefined();
    });
  }
});

describe("findImperativeStart on edge cases", () => {
  it("returns undefined for no tokens", () => {
    expect(findImperativeStart([])).toBeUndefined();
  });
  it("looks at the first token only", () => {
    const tokens = taggedOf("Optionally, run the command.");
    expect(tokens[2]?.pos).toBe("verb");
    expect(findImperativeStart(tokens)).toBeUndefined();
  });
});
