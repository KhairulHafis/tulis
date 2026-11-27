import { describe, expect, it, vi } from "vitest";
import type { VariantGroup } from "../config/variants-types.js";
import { createBuiltInExtractors } from "../extract/built-in-extractors.js";
import { createExtractorRegistry } from "../extract/registry.js";
import { runExtractors } from "../extract/run-extractors.js";
import { prepareDoc, type PreparedDoc } from "../prepare/prepare-doc.js";
import { createVerbNounExtractor } from "./verb-noun-extractor.js";

const tagCalls: unknown[] = [];

vi.mock("../language/tag-tokens.js", async (importOriginal) => {
  const original =
    await importOriginal<typeof import("../language/tag-tokens.js")>();
  return {
    ...original,
    tagSentence: (...args: Parameters<typeof original.tagSentence>) => {
      tagCalls.push(args);
      return original.tagSentence(...args);
    },
  };
});

const groups: readonly VariantGroup[] = [
  {
    id: "login-form",
    kind: "verb-noun",
    noun: "login",
    verb: "log in",
    source: "seed",
  },
  {
    id: "setup-form",
    kind: "verb-noun",
    noun: "setup",
    verb: "set up",
    source: "seed",
  },
  {
    id: "backup-form",
    kind: "verb-noun",
    noun: "backup",
    verb: "back up",
    source: "seed",
  },
];

function prepared(text: string): PreparedDoc {
  const doc = prepareDoc(text, "markdown");
  if (doc.kind !== "prepared") {
    throw new Error("expected a prepared doc");
  }
  return doc;
}

function run(text: string, use: readonly VariantGroup[] = groups) {
  const result = runExtractors(
    createExtractorRegistry([createVerbNounExtractor(use)]),
    prepared(text),
  );
  return {
    problems: result.problems,
    found: result.observations.map(
      (o) => o.dimension.replace("term.", "") + " = " + o.value,
    ),
  };
}

type Fixture = readonly [string, readonly string[]];

const fixtures: readonly Fixture[] = [
  ["login to the SAP portal to begin", ["login-form.verb = login"]],
  ["Log in to the SAP portal.", ["login-form.verb = log in"]],
  ["Login to GitLab with your username.", ["login-form.verb = login"]],
  ["Users login into the console.", ["login-form.verb = login"]],
  ["Your login expires after 30 days.", ["login-form.noun = login"]],
  ["Enter your login details.", ["login-form.noun = login"]],
  ["The login page opens.", ["login-form.noun = login"]],
  [
    "After a successful login, the dashboard opens.",
    ["login-form.noun = login"],
  ],
  ["You must log in first.", ["login-form.verb = log in"]],
  ["You can login with SSO.", ["login-form.verb = login"]],
  ["If you are logged in, select Settings.", ["login-form.verb = log in"]],
  ["The user logs in every morning.", ["login-form.verb = log in"]],
  ["Failed logins are recorded.", ["login-form.noun = login"]],
  ["The provider's login instructions are here.", ["login-form.noun = login"]],
  ["Show the logged-in user.", []],
  ["Log-in to the portal.", ["login-form.verb = log-in"]],
  ["The log-in screen appears.", []],
  ["To login, enter your password.", ["login-form.verb = login"]],
  ["Set up the cluster.", ["setup-form.verb = set up"]],
  ["Setup the cluster.", ["setup-form.verb = setup"]],
  ["The setup takes five minutes.", ["setup-form.noun = setup"]],
  ["A highly available setup needs three nodes.", ["setup-form.noun = setup"]],
  ["You should setup etcd first.", ["setup-form.verb = setup"]],
  [
    "Before you set up Geo, confirm the following:",
    ["setup-form.verb = set up"],
  ],
  ["Setting up a cluster is complex.", ["setup-form.verb = set up"]],
  ["Everything is set up correctly.", ["setup-form.verb = set up"]],
  ["Compare the two setups.", ["setup-form.noun = setup"]],
  ["The stacked etcd setup is the default.", ["setup-form.noun = setup"]],
  ["Follow the setup guide.", ["setup-form.noun = setup"]],
  ["To set up the runner, run the script.", ["setup-form.verb = set up"]],
  ["The set up is quick.", ["setup-form.noun = set up"]],
  ["See the Kubernetes setup.", ["setup-form.noun = setup"]],
  ["The script sets up the database.", ["setup-form.verb = set up"]],
  ["Back up your data.", ["backup-form.verb = back up"]],
  ["Backup your data before you upgrade.", ["backup-form.verb = backup"]],
  ["Create a backup of the instance.", ["backup-form.noun = backup"]],
  ["Regular backups keep data safe.", ["backup-form.noun = backup"]],
  ["The backup files are stored in S3.", ["backup-form.noun = backup"]],
  [
    "You can back up repositories with the API.",
    ["backup-form.verb = back up"],
  ],
  ["Scroll back up to the top.", []],
  ["Run a backup to S3 every night.", ["backup-form.noun = backup"]],
  ["Restart the server and log in again.", ["login-form.verb = log in"]],
  [
    "Log in to the portal and check your login history.",
    ["login-form.verb = log in", "login-form.noun = login"],
  ],
  ["[Log](https://example.com) in to the portal.", []],
  ["Run the `login` command.", []],
  [
    "The backup is set up by the script.",
    ["backup-form.noun = backup", "setup-form.verb = set up"],
  ],
  [
    "Now that the servers are all set up, configure Sentinel.",
    ["setup-form.verb = set up"],
  ],
  [
    "You must have a GitLab instance set up and configured.",
    ["setup-form.verb = set up"],
  ],
  [
    "Adjust your cluster setup to fix the problem.",
    ["setup-form.noun = setup"],
  ],
  [
    "For OAuth login to happen, the site must be online.",
    ["login-form.noun = login"],
  ],
  ["Login to see your settings.", ["login-form.verb = login"]],
  ["You can view a job log in full screen mode.", []],
  [
    "In a multi-server setup you must use object storage.",
    ["setup-form.noun = setup"],
  ],
  ["After that's set up, import it.", ["setup-form.verb = set up"]],
];

describe("verb-noun fixtures", () => {
  it("has the 54 fixtures", () => {
    expect(fixtures).toHaveLength(54);
  });

  it.each(fixtures.map((fixture, i) => [i + 1, ...fixture] as const))(
    "fixture %i: %s",
    (_number, text, expected) => {
      const result = run(text + "\n");
      expect(result.problems).toEqual([]);
      expect(result.found).toEqual(expected);
    },
  );

  it("reads a heading as a paragraph", () => {
    expect(run("## Setup the cluster\n").found).toEqual([
      "setup-form.verb = setup",
    ]);
  });
});

describe("createVerbNounExtractor", () => {
  it("ignores synonym groups", () => {
    const synonym: VariantGroup = {
      id: "sign-in",
      kind: "synonym",
      variants: ["log in", "sign in"],
      source: "seed",
    };
    expect(run("Log in to the portal.\n", [synonym]).found).toEqual([]);
    expect(run("Log in to the portal.\n", [synonym, ...groups]).found).toEqual([
      "login-form.verb = log in",
    ]);
  });

  it("gives no findings without verb-noun groups", () => {
    expect(run("Log in to the portal.\n", []).found).toEqual([]);
  });

  it("has the id term.verb-noun, sentence scope", () => {
    const extractor = createVerbNounExtractor(groups);
    expect(extractor.id).toBe("term.verb-noun");
    expect(extractor.scope).toBe("sentence");
  });

  it("never tags a sentence with no match, and tags a matching one once", () => {
    tagCalls.length = 0;
    run("Nothing to see here. Or here.\n");
    expect(tagCalls).toHaveLength(0);
    run("Log in to the portal and check your login history.\n");
    expect(tagCalls).toHaveLength(1);
  });

  it("counts two groups that share a word each on their own", () => {
    const shared: readonly VariantGroup[] = [
      {
        id: "a-form",
        kind: "verb-noun",
        noun: "login",
        verb: "log in",
        source: "seed",
      },
      {
        id: "b-form",
        kind: "verb-noun",
        noun: "login",
        verb: "sign in",
        source: "seed",
      },
    ];
    const result = run("Your login expires.\n", shared);
    expect(result.problems).toEqual([]);
    expect(result.found.sort()).toEqual([
      "a-form.noun = login",
      "b-form.noun = login",
    ]);
  });

  it("is second in the built-in list and its dimensions are accepted", () => {
    const extractors = createBuiltInExtractors({ groups });
    expect(extractors[1]?.id).toBe("term.verb-noun");
    const result = runExtractors(
      createExtractorRegistry(extractors),
      prepared("Log in to the portal and check your login history.\n"),
    );
    expect(result.problems).toEqual([]);
    expect(result.observations.map((o) => o.dimension)).toEqual([
      "term.login-form.verb",
      "term.login-form.noun",
    ]);
  });
});
