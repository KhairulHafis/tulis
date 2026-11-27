import {
  existsSync,
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
import { recordDismissal } from "./edit-decisions.js";
import { loadDecisions } from "./load-decisions.js";

const folders: string[] = [];
const CHECK = "term.sign-in";
const NAME = "amy.yaml";

function makeRepo(): string {
  const dir = realpathSync.native(mkdtempSync(join(tmpdir(), "tulis-edd-")));
  folders.push(dir);
  return dir;
}

function filePath(repo: string): string {
  return join(repo, ".tulis", "decisions", NAME);
}

function seed(repo: string, text: string): void {
  mkdirSync(join(repo, ".tulis", "decisions"), { recursive: true });
  writeFileSync(filePath(repo), text);
}

function read(repo: string): string {
  return readFileSync(filePath(repo), "utf8");
}

afterEach(() => {
  for (const dir of folders.splice(0)) {
    rmSync(dir, { recursive: true, force: true });
  }
});

const HEADER =
  "# Flags this writer dismissed. Tulis adds these up across writers.\nversion: 1\n";

function entry(check: string, count: number, last: string): string {
  return `  - check: ${check}\n    count: ${String(count)}\n    last: "${last}"\n`;
}

describe("recordDismissal on a missing file", () => {
  it("creates the file with the header, version and entry", async () => {
    const repo = makeRepo();
    expect(existsSync(join(repo, ".tulis"))).toBe(false);
    expect(await recordDismissal(repo, NAME, CHECK, "2026-11-27")).toEqual({
      status: "written",
    });
    expect(read(repo)).toBe(
      `${HEADER}dismissals:\n${entry(CHECK, 1, "2026-11-27")}`,
    );
  });

  it("counts a second call on the same day", async () => {
    const repo = makeRepo();
    await recordDismissal(repo, NAME, CHECK, "2026-11-27");
    await recordDismissal(repo, NAME, CHECK, "2026-11-27");
    expect(read(repo)).toBe(
      `${HEADER}dismissals:\n${entry(CHECK, 2, "2026-11-27")}`,
    );
  });

  it("moves last forward on a later day", async () => {
    const repo = makeRepo();
    await recordDismissal(repo, NAME, CHECK, "2026-11-27");
    await recordDismissal(repo, NAME, CHECK, "2026-11-28");
    expect(read(repo)).toBe(
      `${HEADER}dismissals:\n${entry(CHECK, 2, "2026-11-28")}`,
    );
  });

  it("never moves last back on an earlier day", async () => {
    const repo = makeRepo();
    await recordDismissal(repo, NAME, CHECK, "2026-11-27");
    await recordDismissal(repo, NAME, CHECK, "2026-11-20");
    expect(read(repo)).toBe(
      `${HEADER}dismissals:\n${entry(CHECK, 2, "2026-11-27")}`,
    );
  });

  it("reads back through loadDecisions", async () => {
    const repo = makeRepo();
    await recordDismissal(repo, NAME, CHECK, "2026-11-27");
    await recordDismissal(repo, NAME, CHECK, "2026-12-01");
    const loaded = await loadDecisions(repo);
    expect(loaded.warnings).toEqual([]);
    expect(loaded.writers).toEqual([
      {
        fileName: NAME,
        dismissals: [{ check: CHECK, count: 2, last: "2026-12-01" }],
      },
    ]);
  });
});

const HAND_WRITTEN = `# My dismissals
version: 1
note: keep me
dismissals:
  - check: term.sign-in # the first one
    count: 3
    last: "2026-11-01"

  # between entries
  - check: term.log-in
    count: 5 # five times
    last: "2026-10-01"

# the end
`;

describe("recordDismissal keeps what a person typed", () => {
  it("changes only count and last of the incremented entry", async () => {
    const repo = makeRepo();
    seed(repo, HAND_WRITTEN);
    await recordDismissal(repo, NAME, CHECK, "2026-11-27");
    expect(read(repo)).toBe(
      HAND_WRITTEN.replace("count: 3", "count: 4").replace(
        '"2026-11-01"',
        '"2026-11-27"',
      ),
    );
  });

  it("changes only count when the day is not later", async () => {
    const repo = makeRepo();
    seed(repo, HAND_WRITTEN);
    await recordDismissal(repo, NAME, "term.log-in", "2026-09-01");
    expect(read(repo)).toBe(HAND_WRITTEN.replace("count: 5", "count: 6"));
  });

  it("adds only the new entry's lines for a new check", async () => {
    const repo = makeRepo();
    seed(repo, HAND_WRITTEN);
    await recordDismissal(repo, NAME, "term.e-mail", "2026-11-27");
    expect(read(repo)).toBe(
      HAND_WRITTEN.replace(
        "\n# the end\n",
        `  - check: term.e-mail\n    count: 1\n    last: "2026-11-27"\n\n# the end\n`,
      ),
    );
  });

  it("keeps single quotes on last", async () => {
    const repo = makeRepo();
    seed(
      repo,
      "version: 1\ndismissals:\n  - check: term.sign-in\n    count: 1\n    last: '2026-11-01'\n",
    );
    await recordDismissal(repo, NAME, CHECK, "2026-11-27");
    expect(read(repo)).toBe(
      "version: 1\ndismissals:\n  - check: term.sign-in\n    count: 2\n    last: '2026-11-27'\n",
    );
  });

  it("accepts an unquoted date (core schema reads it as a string) and keeps it unquoted", async () => {
    const repo = makeRepo();
    const text =
      "version: 1\ndismissals:\n  - check: term.sign-in\n    count: 1\n    last: 2026-11-01\n";
    seed(repo, text);
    expect((await loadDecisions(repo)).writers[0]?.dismissals).toHaveLength(1);
    await recordDismissal(repo, NAME, CHECK, "2026-11-27");
    expect(read(repo)).toBe(
      "version: 1\ndismissals:\n  - check: term.sign-in\n    count: 2\n    last: 2026-11-27\n",
    );
  });

  it("keeps an unindented list unindented", async () => {
    const repo = makeRepo();
    seed(
      repo,
      'version: 1\ndismissals:\n- check: term.sign-in\n  count: 1\n  last: "2026-11-01"\n',
    );
    await recordDismissal(repo, NAME, "term.log-in", "2026-11-27");
    expect(read(repo)).toBe(
      'version: 1\ndismissals:\n- check: term.sign-in\n  count: 1\n  last: "2026-11-01"\n- check: term.log-in\n  count: 1\n  last: "2026-11-27"\n',
    );
  });

  it("keeps CRLF line endings", async () => {
    const repo = makeRepo();
    const lf = `version: 1\n# hi\ndismissals:\n${entry(CHECK, 1, "2026-11-01")}`;
    seed(repo, lf.replaceAll("\n", "\r\n"));
    await recordDismissal(repo, NAME, CHECK, "2026-11-27");
    expect(read(repo)).toBe(
      `version: 1\n# hi\ndismissals:\n${entry(CHECK, 2, "2026-11-27")}`.replaceAll(
        "\n",
        "\r\n",
      ),
    );
  });

  it("keeps a byte order mark", async () => {
    const repo = makeRepo();
    seed(
      repo,
      `\uFEFFversion: 1\ndismissals:\n${entry(CHECK, 1, "2026-11-01")}`,
    );
    await recordDismissal(repo, NAME, CHECK, "2026-11-27");
    expect(read(repo)).toBe(
      `\uFEFFversion: 1\ndismissals:\n${entry(CHECK, 2, "2026-11-27")}`,
    );
  });
});

describe("recordDismissal creates a block list when there is none", () => {
  const added = `  - check: term.sign-in\n    count: 1\n    last: "2026-11-27"\n`;

  it("from an empty flow list", async () => {
    const repo = makeRepo();
    seed(repo, "version: 1\ndismissals: []\n");
    await recordDismissal(repo, NAME, CHECK, "2026-11-27");
    expect(read(repo)).toBe(`version: 1\ndismissals:\n${added}`);
  });

  it("from a null value", async () => {
    const repo = makeRepo();
    seed(repo, "version: 1\ndismissals:\n");
    await recordDismissal(repo, NAME, CHECK, "2026-11-27");
    expect(read(repo)).toBe(`version: 1\ndismissals:\n${added}`);
  });

  it("when the key is missing", async () => {
    const repo = makeRepo();
    seed(repo, "version: 1\n");
    await recordDismissal(repo, NAME, CHECK, "2026-11-27");
    expect(read(repo)).toBe(`version: 1\ndismissals:\n${added}`);
  });

  it("in a comments-only file, keeping the comment (yaml adds one blank line) and adding no version", async () => {
    const repo = makeRepo();
    seed(repo, "# just a note\n");
    await recordDismissal(repo, NAME, CHECK, "2026-11-27");
    expect(read(repo)).toBe(`# just a note\n\ndismissals:\n${added}`);
  });
});

describe("recordDismissal limits", () => {
  it("leaves count at 1,000,000 but still moves last", async () => {
    const repo = makeRepo();
    seed(
      repo,
      `version: 1\ndismissals:\n${entry(CHECK, 1_000_000, "2026-11-01")}`,
    );
    await recordDismissal(repo, NAME, CHECK, "2026-11-27");
    expect(read(repo)).toBe(
      `version: 1\ndismissals:\n${entry(CHECK, 1_000_000, "2026-11-27")}`,
    );
  });
});

describe("recordDismissal refuses", () => {
  async function expectRefused(text: string): Promise<void> {
    const repo = makeRepo();
    seed(repo, text);
    const before = readFileSync(filePath(repo));
    const outcome = await recordDismissal(repo, NAME, CHECK, "2026-11-27");
    expect(outcome.status).toBe("refused");
    expect(readFileSync(filePath(repo)).equals(before)).toBe(true);
  }

  it("a file with errors", async () => {
    await expectRefused("version: 1\ndismissals:\n  - check: Bad\n");
  });

  it("invalid YAML", async () => {
    await expectRefused(
      "version: 1\n<<<<<<< HEAD\ndismissals: []\n=======\n>>>>>>> other\n",
    );
  });

  it("a newer version", async () => {
    await expectRefused(
      `version: 2\ndismissals:\n${entry(CHECK, 1, "2026-11-01")}`,
    );
  });

  it("a file that would grow past 64 KB", async () => {
    const repo = makeRepo();
    const start = `version: 1\ndismissals:\n${entry(CHECK, 1, "2026-11-01")}`;
    const room = 65_536 - Buffer.byteLength(start) - 2;
    const text = `${start}#${"x".repeat(room)}\n`;
    expect(Buffer.byteLength(text)).toBe(65_536);
    seed(repo, text);
    const before = readFileSync(filePath(repo));
    const outcome = await recordDismissal(
      repo,
      NAME,
      "term.new-one",
      "2026-11-27",
    );
    expect(outcome).toEqual({
      status: "refused",
      reason:
        "The change would make the file larger than 64 KB, so it was not written.",
    });
    expect(readFileSync(filePath(repo)).equals(before)).toBe(true);
  });
});

describe("recordDismissal bad input", () => {
  it.each(["../x.yaml", "Amy.yaml"])(
    "throws for file name %s",
    async (name) => {
      const repo = makeRepo();
      await expect(
        recordDismissal(repo, name, CHECK, "2026-11-27"),
      ).rejects.toThrow(TypeError);
    },
  );

  it.each(["Term.Sign-In", "sign-in"])("throws for check %s", async (check) => {
    const repo = makeRepo();
    await expect(
      recordDismissal(repo, NAME, check, "2026-11-27"),
    ).rejects.toThrow(TypeError);
  });

  it.each(["2026-02-30", "2026-11-27T10:00"])(
    "throws for day %s",
    async (day) => {
      const repo = makeRepo();
      await expect(recordDismissal(repo, NAME, CHECK, day)).rejects.toThrow(
        TypeError,
      );
      expect(existsSync(join(repo, ".tulis"))).toBe(false);
    },
  );
});
