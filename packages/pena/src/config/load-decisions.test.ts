import {
  mkdirSync,
  mkdtempSync,
  realpathSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import {
  DECISIONS_FILE_PREFIX,
  MAX_DECISIONS_WARNINGS,
  loadDecisions,
  readDecisionsFile,
} from "./load-decisions.js";

const folders: string[] = [];

function makeRepo(): string {
  const dir = realpathSync.native(mkdtempSync(join(tmpdir(), "tulis-dec-")));
  folders.push(dir);
  return dir;
}

function writeDecision(repo: string, name: string, content: string): void {
  mkdirSync(join(repo, ".tulis", "decisions"), { recursive: true });
  writeFileSync(join(repo, ".tulis", "decisions", name), content);
}

function file(check: string, count = 1, version = "version: 1\n"): string {
  return `${version}dismissals:\n  - check: ${check}\n    count: ${String(count)}\n    last: "2026-11-27"\n`;
}

afterEach(() => {
  for (const dir of folders.splice(0)) {
    rmSync(dir, { recursive: true, force: true });
  }
});

describe("loadDecisions", () => {
  it("gives nothing when there is no .tulis folder", async () => {
    const repo = makeRepo();
    expect(await loadDecisions(repo)).toEqual({ writers: [], warnings: [] });
  });

  it("gives nothing when there is no decisions folder", async () => {
    const repo = makeRepo();
    mkdirSync(join(repo, ".tulis"));
    expect(await loadDecisions(repo)).toEqual({ writers: [], warnings: [] });
  });

  it("loads two good files sorted by file name", async () => {
    const repo = makeRepo();
    writeDecision(repo, "zed.yaml", file("a.zed"));
    writeDecision(repo, "amy.yaml", file("a.amy", 4));
    const loaded = await loadDecisions(repo);
    expect(loaded.warnings).toEqual([]);
    expect(loaded.writers.map((w) => w.fileName)).toEqual([
      "amy.yaml",
      "zed.yaml",
    ]);
    expect(loaded.writers[0]?.dismissals).toEqual([
      { check: "a.amy", count: 4, last: "2026-11-27" },
    ]);
  });

  it("ignores files that do not end in .yaml", async () => {
    const repo = makeRepo();
    writeDecision(repo, "amy.yaml", file("a.amy"));
    writeDecision(repo, "notes.txt", "hello");
    const loaded = await loadDecisions(repo);
    expect(loaded.writers).toHaveLength(1);
    expect(loaded.warnings).toEqual([]);
  });

  it("loads the good file and warns about the bad one with file and line", async () => {
    const repo = makeRepo();
    writeDecision(repo, "good.yaml", file("a.good"));
    writeDecision(
      repo,
      "bad.yaml",
      'version: 1\ndismissals:\n  - check: a.b\n    count: 0\n    last: "2026-11-27"\n',
    );
    const loaded = await loadDecisions(repo);
    expect(loaded.writers.map((w) => w.fileName)).toEqual([
      "bad.yaml",
      "good.yaml",
    ]);
    expect(loaded.writers[0]?.dismissals).toEqual([]);
    expect(loaded.warnings).toHaveLength(1);
    expect(loaded.warnings[0]).toMatch(
      /^\.tulis\/decisions\/bad\.yaml line 4: count must be/,
    );
  });

  it("skips a file that is not YAML with one warning", async () => {
    const repo = makeRepo();
    writeDecision(repo, "good.yaml", file("a.good"));
    writeDecision(
      repo,
      "conflict.yaml",
      "<<<<<<< HEAD\nversion: 1\n=======\nversion: 2\n>>>>>>> branch\n",
    );
    const loaded = await loadDecisions(repo);
    expect(loaded.writers.map((w) => w.fileName)).toEqual(["good.yaml"]);
    expect(loaded.warnings).toHaveLength(1);
    expect(loaded.warnings[0]).toContain(".tulis/decisions/conflict.yaml");
    expect(loaded.warnings[0]).toContain("not valid YAML, so it was skipped: ");
  });

  it("keeps the good entries of a file with bad entries", async () => {
    const repo = makeRepo();
    writeDecision(
      repo,
      "amy.yaml",
      `version: 1
dismissals:
  - { check: a.one, count: 1, last: "2026-01-01" }
  - { check: Bad, count: 1, last: "2026-01-01" }
  - { check: a.two, count: 2, last: "2026-01-02" }
`,
    );
    const loaded = await loadDecisions(repo);
    expect(loaded.writers[0]?.dismissals.map((d) => d.check)).toEqual([
      "a.one",
      "a.two",
    ]);
    expect(loaded.warnings).toHaveLength(1);
    expect(loaded.warnings[0]).toContain("amy.yaml line 4");
  });

  it("warns about unknown keys and a missing version", async () => {
    const repo = makeRepo();
    writeDecision(
      repo,
      "amy.yaml",
      'dismissals:\n  - { check: a.b, cout: 1, count: 1, last: "2026-01-01" }\n',
    );
    const loaded = await loadDecisions(repo);
    expect(loaded.writers[0]?.dismissals).toHaveLength(1);
    expect(loaded.warnings).toHaveLength(2);
    expect(loaded.warnings.join("\n")).toContain('Did you mean "count"?');
  });

  it("skips a badly named file with a warning", async () => {
    const repo = makeRepo();
    writeDecision(repo, "Notes.yaml", file("a.b"));
    writeDecision(repo, "amy.yaml", file("a.amy"));
    const loaded = await loadDecisions(repo);
    expect(loaded.writers.map((w) => w.fileName)).toEqual(["amy.yaml"]);
    expect(loaded.warnings).toEqual([
      ".tulis/decisions/Notes.yaml: This file name was not made by Tulis, so it was skipped.",
    ]);
  });

  it("reads a newer file as far as possible with one warning", async () => {
    const repo = makeRepo();
    writeDecision(
      repo,
      "amy.yaml",
      `version: 2
extra: 1
dismissals:
  - { check: a.one, count: 1, last: "2026-01-01" }
  - { check: Bad, count: 1, last: "2026-01-01" }
`,
    );
    const loaded = await loadDecisions(repo);
    expect(loaded.writers[0]?.dismissals).toHaveLength(1);
    expect(loaded.warnings).toHaveLength(1);
    expect(loaded.warnings[0]).toBe(
      ".tulis/decisions/amy.yaml line 1: This file was made by a newer version of Tulis (file version 2). Please upgrade Tulis. Entries this version can't use are skipped.",
    );
  });

  it("caps warnings at 50 lines plus a count line", async () => {
    const repo = makeRepo();
    for (let i = 0; i < 60; i += 1) {
      writeDecision(
        repo,
        `w${String(i).padStart(2, "0")}.yaml`,
        "dismissals: []\n",
      );
    }
    const loaded = await loadDecisions(repo);
    expect(loaded.writers).toHaveLength(60);
    expect(loaded.warnings).toHaveLength(MAX_DECISIONS_WARNINGS + 1);
    expect(loaded.warnings[MAX_DECISIONS_WARNINGS]).toBe(
      "10 more warnings not shown.",
    );
  });

  it("treats an empty file as an empty writer", async () => {
    const repo = makeRepo();
    writeDecision(repo, "amy.yaml", "");
    const loaded = await loadDecisions(repo);
    expect(loaded).toEqual({
      writers: [{ fileName: "amy.yaml", dismissals: [] }],
      warnings: [],
    });
  });

  it("uses the shared prefix", () => {
    expect(DECISIONS_FILE_PREFIX).toBe(".tulis/decisions/");
  });
});

describe("readDecisionsFile", () => {
  it("throws for a name Tulis would not make", async () => {
    const repo = makeRepo();
    await expect(readDecisionsFile(repo, "../x.yaml")).rejects.toThrow();
    await expect(readDecisionsFile(repo, "Amy.yaml")).rejects.toThrow();
  });

  it("reports a missing file as writable", async () => {
    const repo = makeRepo();
    const result = await readDecisionsFile(repo, "amy.yaml");
    expect(result.fileName).toBe("amy.yaml");
    expect(result.text).toBeNull();
    expect(result.parsed).toBeUndefined();
    expect(result.check.dismissals).toEqual([]);
    expect(result.check.errors).toEqual([]);
    expect(result.writeBlocked).toBeUndefined();
  });

  it("reads a clean file", async () => {
    const repo = makeRepo();
    const text = file("a.b");
    writeDecision(repo, "amy.yaml", text);
    const result = await readDecisionsFile(repo, "amy.yaml");
    expect(result.text).toBe(text);
    expect(result.parsed).toBeDefined();
    expect(result.check.dismissals).toHaveLength(1);
    expect(result.writeBlocked).toBeUndefined();
  });

  it("blocks writing a file with errors", async () => {
    const repo = makeRepo();
    writeDecision(repo, "amy.yaml", file("Bad"));
    const result = await readDecisionsFile(repo, "amy.yaml");
    expect(result.check.errors).toHaveLength(1);
    expect(result.writeBlocked).toBe(
      "The file has errors, so Tulis won't change it. Fix them first.",
    );
  });

  it("blocks writing a newer file", async () => {
    const repo = makeRepo();
    writeDecision(repo, "amy.yaml", file("a.b", 1, "version: 2\n"));
    const result = await readDecisionsFile(repo, "amy.yaml");
    expect(result.writeBlocked).toBe(
      "The file was made by a newer version of Tulis, so this version won't change it. Please upgrade Tulis.",
    );
  });

  it("blocks writing a file that is not YAML", async () => {
    const repo = makeRepo();
    writeDecision(repo, "amy.yaml", "<<<<<<< HEAD\na: 1\n=======\n");
    const result = await readDecisionsFile(repo, "amy.yaml");
    expect(result.text).toContain("<<<<<<<");
    expect(result.parsed).toBeUndefined();
    expect(result.check.errors).toHaveLength(1);
    expect(result.writeBlocked).toBe(
      "The file is not valid YAML, so Tulis won't change it.",
    );
  });

  it("turns a read failure into writeBlocked", async () => {
    const repo = makeRepo();
    writeDecision(repo, "amy.yaml", "\u0000￿".padEnd(70 * 1024, "x"));
    const result = await readDecisionsFile(repo, "amy.yaml");
    expect(result.text).toBeNull();
    expect(result.writeBlocked).toBe("The file is larger than 64 KB.");
  });
});
