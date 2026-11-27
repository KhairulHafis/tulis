import {
  mkdirSync,
  mkdtempSync,
  readFileSync,
  realpathSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { addConfirmedGroup, addRejectedGroup } from "./edit-variants.js";
import { MAX_VARIANTS_BYTES, loadVariants } from "./load-variants.js";

const folders: string[] = [];

function makeRepo(): string {
  const dir = realpathSync.native(mkdtempSync(join(tmpdir(), "tulis-edit-")));
  folders.push(dir);
  return dir;
}

function filePath(repo: string): string {
  return join(repo, ".tulis", "variants.yaml");
}

function writeVariants(repo: string, content: string | Buffer): void {
  mkdirSync(join(repo, ".tulis"), { recursive: true });
  writeFileSync(filePath(repo), content);
}

function readVariants(repo: string): string {
  return readFileSync(filePath(repo), "utf8");
}

afterEach(() => {
  for (const dir of folders.splice(0)) {
    rmSync(dir, { recursive: true, force: true });
  }
});

const BOM = "\uFEFF";

const CLICK_SELECT = {
  id: "click-select",
  kind: "synonym",
  variants: ["click", "select"],
} as const;

const HEADER = `# Team word groups for Tulis.
# A group with the same id as a built-in group replaces it.
# An entry with only an id and \`enabled: false\` switches a group off.
version: 1
`;

const CLICK_SELECT_TEXT = `groups:
  - id: click-select
    kind: synonym
    variants: ["click", "select"]
    source: discovered
`;

describe("a missing file", () => {
  it("creates the file, then adds below it", async () => {
    const repo = makeRepo();
    expect(await addConfirmedGroup(repo, CLICK_SELECT)).toEqual({
      status: "written",
    });
    expect(readVariants(repo)).toBe(HEADER + CLICK_SELECT_TEXT);

    expect(
      await addConfirmedGroup(repo, {
        id: "open-launch",
        kind: "synonym",
        variants: ["open", "launch"],
      }),
    ).toEqual({ status: "written" });
    expect(readVariants(repo)).toBe(
      `${HEADER}${CLICK_SELECT_TEXT}  - id: open-launch
    kind: synonym
    variants: ["open", "launch"]
    source: discovered
`,
    );

    expect(await addRejectedGroup(repo, ["Save", "store"])).toEqual({
      status: "written",
    });
    expect(readVariants(repo)).toBe(
      `${HEADER}${CLICK_SELECT_TEXT}  - id: open-launch
    kind: synonym
    variants: ["open", "launch"]
    source: discovered
rejected:
  - variants: ["Save", "store"]
`,
    );
  });

  it("creates a rejected section in a new file", async () => {
    const repo = makeRepo();
    await addRejectedGroup(repo, ["open", "close"]);
    expect(readVariants(repo)).toBe(
      `${HEADER}rejected:\n  - variants: ["open", "close"]\n`,
    );
  });

  it("reads back through loadVariants", async () => {
    const repo = makeRepo();
    await addConfirmedGroup(repo, CLICK_SELECT);
    const loaded = await loadVariants(repo);
    expect(loaded.warnings).toEqual([]);
    expect(loaded.variants.groups).toEqual([
      {
        id: "click-select",
        kind: "synonym",
        variants: ["click", "select"],
        source: "discovered",
      },
    ]);
  });
});

const HAND_WRITTEN = `# Our team's words.
version: 1

groups:
  - id: sign-in   # replaces the built-in group
    kind: synonym
    variants: ["log in", "sign in"]
  # a group we turned off
  - id: login-form
    enabled: false

rejected:
  - variants: ["open", "close"]

# Settings for another tool.
other-tool:
  mode: strict
  paths:
    - a
    - b

# End of file.
`;

describe("a hand-written file", () => {
  it("adds a group and changes only the added lines", async () => {
    const repo = makeRepo();
    writeVariants(repo, HAND_WRITTEN);
    expect(await addConfirmedGroup(repo, CLICK_SELECT)).toEqual({
      status: "written",
    });
    expect(readVariants(repo)).toBe(
      HAND_WRITTEN.replace(
        "    enabled: false\n",
        `    enabled: false
  - id: click-select
    kind: synonym
    variants: ["click", "select"]
    source: discovered
`,
      ).replace("sign-in   #", "sign-in #"),
    );
  });

  it("adds a rejected group and changes only the added lines", async () => {
    const repo = makeRepo();
    writeVariants(repo, HAND_WRITTEN);
    expect(await addRejectedGroup(repo, ["save", "store"])).toEqual({
      status: "written",
    });
    expect(readVariants(repo)).toBe(
      HAND_WRITTEN.replace(
        '  - variants: ["open", "close"]\n',
        '  - variants: ["open", "close"]\n  - variants: ["save", "store"]\n',
      ).replace("sign-in   #", "sign-in #"),
    );
  });
});

describe("file style", () => {
  it("keeps an unindented list unindented", async () => {
    const repo = makeRepo();
    writeVariants(
      repo,
      `version: 1\ngroups:\n- id: a-b\n  kind: synonym\n  variants: ["a", "b"]\n`,
    );
    await addConfirmedGroup(repo, CLICK_SELECT);
    expect(readVariants(repo)).toBe(
      `version: 1
groups:
- id: a-b
  kind: synonym
  variants: ["a", "b"]
- id: click-select
  kind: synonym
  variants: ["click", "select"]
  source: discovered
`,
    );
  });

  it("keeps CRLF line endings", async () => {
    const repo = makeRepo();
    writeVariants(
      repo,
      "version: 1\r\ngroups:\r\n  - id: a-b\r\n    enabled: false\r\n",
    );
    await addConfirmedGroup(repo, CLICK_SELECT);
    expect(readVariants(repo)).toBe(
      [
        "version: 1",
        "groups:",
        "  - id: a-b",
        "    enabled: false",
        "  - id: click-select",
        "    kind: synonym",
        '    variants: ["click", "select"]',
        "    source: discovered",
        "",
      ].join("\r\n"),
    );
  });

  it("keeps a byte order mark", async () => {
    const repo = makeRepo();
    writeVariants(
      repo,
      `${BOM}version: 1\ngroups:\n  - id: a-b\n    enabled: false\n`,
    );
    await addConfirmedGroup(repo, CLICK_SELECT);
    expect(readVariants(repo)).toBe(
      `${BOM}version: 1
groups:
  - id: a-b
    enabled: false
  - id: click-select
    kind: synonym
    variants: ["click", "select"]
    source: discovered
`,
    );
  });
});

describe("a missing or empty list", () => {
  it("prints an empty `groups: []` as a block list", async () => {
    const repo = makeRepo();
    writeVariants(repo, "version: 1\ngroups: []\n");
    await addConfirmedGroup(repo, CLICK_SELECT);
    expect(readVariants(repo)).toBe(`version: 1\n${CLICK_SELECT_TEXT}`);
  });

  it("prints an empty `rejected: []` as a block list", async () => {
    const repo = makeRepo();
    writeVariants(repo, "version: 1\nrejected: []\n");
    await addRejectedGroup(repo, ["open", "close"]);
    expect(readVariants(repo)).toBe(
      'version: 1\nrejected:\n  - variants: ["open", "close"]\n',
    );
  });

  it("fills `groups:` with no value", async () => {
    const repo = makeRepo();
    writeVariants(repo, "version: 1\ngroups:\n");
    await addConfirmedGroup(repo, CLICK_SELECT);
    expect(readVariants(repo)).toBe(`version: 1\n${CLICK_SELECT_TEXT}`);
  });

  it("creates `groups` when the key is missing, without adding a version", async () => {
    const repo = makeRepo();
    writeVariants(repo, "rejected:\n  - variants: [a, b]\n");
    await addConfirmedGroup(repo, CLICK_SELECT);
    expect(readVariants(repo)).toBe(
      `rejected:\n  - variants: [a, b]\n${CLICK_SELECT_TEXT}`,
    );
  });

  it("gives a comments-only file a new map and keeps the comment", async () => {
    const repo = makeRepo();
    writeVariants(repo, "# nothing here yet\n");
    await addConfirmedGroup(repo, CLICK_SELECT);
    expect(readVariants(repo)).toBe(
      `# nothing here yet\n\n${CLICK_SELECT_TEXT}`,
    );
  });

  it("keeps working for a rejected group in a comments-only file", async () => {
    const repo = makeRepo();
    writeVariants(repo, "# nothing here yet\n");
    await addRejectedGroup(repo, ["open", "close"]);
    expect(readVariants(repo)).toBe(
      '# nothing here yet\n\nrejected:\n  - variants: ["open", "close"]\n',
    );
  });
});

describe("already present", () => {
  it("leaves the file alone when the id exists", async () => {
    const repo = makeRepo();
    const original =
      "version: 1\ngroups:\n  - id: click-select\n    kind: synonym\n    variants: [a, b]\n";
    writeVariants(repo, original);
    expect(await addConfirmedGroup(repo, CLICK_SELECT)).toEqual({
      status: "already-present",
    });
    expect(readVariants(repo)).toBe(original);
  });

  it("counts a switched-off entry with the same id", async () => {
    const repo = makeRepo();
    const original =
      "version: 1\ngroups:\n  - id: click-select\n    enabled: false\n";
    writeVariants(repo, original);
    expect(await addConfirmedGroup(repo, CLICK_SELECT)).toEqual({
      status: "already-present",
    });
    expect(readFileSync(filePath(repo))).toEqual(Buffer.from(original));
  });

  it("matches rejected words in any order and letter case", async () => {
    const repo = makeRepo();
    const original = 'version: 1\nrejected:\n  - variants: ["Open", "close"]\n';
    writeVariants(repo, original);
    expect(await addRejectedGroup(repo, ["CLOSE", " open "])).toEqual({
      status: "already-present",
    });
    expect(readFileSync(filePath(repo))).toEqual(Buffer.from(original));
  });
});

describe("kinds", () => {
  it("writes a verb-noun group with double-quoted noun and verb", async () => {
    const repo = makeRepo();
    await addConfirmedGroup(repo, {
      id: "log-in",
      kind: "verb-noun",
      noun: "login",
      verb: "log in",
    });
    expect(readVariants(repo)).toBe(
      `${HEADER}groups:
  - id: log-in
    kind: verb-noun
    noun: "login"
    verb: "log in"
    source: discovered
`,
    );
    const loaded = await loadVariants(repo);
    expect(loaded.variants.groups).toEqual([
      {
        id: "log-in",
        kind: "verb-noun",
        noun: "login",
        verb: "log in",
        source: "discovered",
      },
    ]);
  });

  it("stores the trimmed words", async () => {
    const repo = makeRepo();
    await addConfirmedGroup(repo, {
      id: "a-b",
      kind: "synonym",
      variants: ["  click ", "select\t"],
    });
    expect(readVariants(repo)).toContain('variants: ["click", "select"]');
  });
});

describe("refused", () => {
  it("refuses a file with errors", async () => {
    const repo = makeRepo();
    const original = "version: 1\ngroups:\n  - id: Bad Id\n";
    writeVariants(repo, original);
    const outcome = await addConfirmedGroup(repo, CLICK_SELECT);
    expect(outcome.status).toBe("refused");
    expect(readVariants(repo)).toBe(original);
  });

  it("refuses a file that is not valid YAML", async () => {
    const repo = makeRepo();
    const original = "version: 1\ngroups: [\n";
    writeVariants(repo, original);
    const outcome = await addRejectedGroup(repo, ["a", "b"]);
    expect(outcome).toEqual({
      status: "refused",
      reason: "The file is not valid YAML, so Tulis won't change it.",
    });
    expect(readVariants(repo)).toBe(original);
  });

  it("refuses a file from a newer Tulis", async () => {
    const repo = makeRepo();
    const original = "version: 2\ngroups: []\n";
    writeVariants(repo, original);
    const outcome = await addConfirmedGroup(repo, CLICK_SELECT);
    expect(outcome.status).toBe("refused");
    expect(readVariants(repo)).toBe(original);
  });

  it("refuses when the file would grow past 256 KB", async () => {
    const repo = makeRepo();
    const lines = ["version: 1"];
    let size = 11;
    const comment = `# ${"x".repeat(97)}`;
    while (size + comment.length + 1 < MAX_VARIANTS_BYTES - 20) {
      lines.push(comment);
      size += comment.length + 1;
    }
    const original = `${lines.join("\n")}\n`;
    expect(Buffer.byteLength(original)).toBeLessThanOrEqual(MAX_VARIANTS_BYTES);
    writeVariants(repo, original);
    expect(await addConfirmedGroup(repo, CLICK_SELECT)).toEqual({
      status: "refused",
      reason:
        "The change would make the file larger than 256 KB, so it was not written.",
    });
    expect(readVariants(repo)).toBe(original);
  });

  it("refuses a file whose `groups` is not a list", async () => {
    const repo = makeRepo();
    const original = "version: 1\ngroups: nope\n";
    writeVariants(repo, original);
    expect((await addConfirmedGroup(repo, CLICK_SELECT)).status).toBe(
      "refused",
    );
    expect(readVariants(repo)).toBe(original);
  });
});

describe("bad input", () => {
  it("throws a TypeError for a bad id", async () => {
    const repo = makeRepo();
    await expect(
      addConfirmedGroup(repo, { ...CLICK_SELECT, id: "Not An Id" }),
    ).rejects.toThrow(TypeError);
  });

  it("throws a TypeError for one word", async () => {
    const repo = makeRepo();
    await expect(
      addConfirmedGroup(repo, { ...CLICK_SELECT, variants: ["click"] }),
    ).rejects.toThrow(TypeError);
    await expect(addRejectedGroup(repo, ["open"])).rejects.toThrow(TypeError);
  });

  it("throws a TypeError for a control character", async () => {
    const repo = makeRepo();
    await expect(addRejectedGroup(repo, ["open", "clo\nse"])).rejects.toThrow(
      TypeError,
    );
  });

  it("writes nothing when the input is bad", async () => {
    const repo = makeRepo();
    await expect(addRejectedGroup(repo, ["open"])).rejects.toThrow(TypeError);
    expect(() => readVariants(repo)).toThrow();
  });
});
