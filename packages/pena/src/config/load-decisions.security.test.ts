import {
  mkdirSync,
  mkdtempSync,
  realpathSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { MAX_DECISIONS_FILES, loadDecisions } from "./load-decisions.js";

const folders: string[] = [];

function makeFolder(): string {
  const dir = realpathSync.native(mkdtempSync(join(tmpdir(), "tulis-dsec-")));
  folders.push(dir);
  return dir;
}

function decisionsDir(repo: string): string {
  return join(repo, ".tulis", "decisions");
}

function writeDecision(repo: string, name: string, content: string): void {
  mkdirSync(decisionsDir(repo), { recursive: true });
  writeFileSync(join(decisionsDir(repo), name), content);
}

const GOOD =
  'version: 1\ndismissals:\n  - { check: a.good, count: 1, last: "2026-01-01" }\n';

afterEach(() => {
  for (const dir of folders.splice(0)) {
    rmSync(dir, { recursive: true, force: true });
  }
});

describe("loadDecisions security", () => {
  it("does not read through a decisions folder that points outside the repo", async () => {
    const repo = makeFolder();
    const outside = makeFolder();
    writeFileSync(join(outside, "evil.yaml"), GOOD);
    mkdirSync(join(repo, ".tulis"));
    symlinkSync(outside, decisionsDir(repo), "junction");

    const loaded = await loadDecisions(repo);
    expect(loaded.writers).toEqual([]);
    expect(loaded.warnings).toEqual([
      ".tulis/decisions/: The folder points outside the repository, so it was not read.",
    ]);
  });

  it("skips a file with an alias bomb and still loads the others", async () => {
    const repo = makeFolder();
    const bomb = [
      "a: &a [x, x, x, x, x, x, x, x, x]",
      "b: &b [*a, *a, *a, *a, *a, *a, *a, *a, *a]",
      "c: &c [*b, *b, *b, *b, *b, *b, *b, *b, *b]",
      "d: &d [*c, *c, *c, *c, *c, *c, *c, *c, *c]",
      "e: [*d, *d, *d, *d, *d, *d, *d, *d, *d]",
      "",
    ].join("\n");
    writeDecision(repo, "bomb.yaml", bomb);
    writeDecision(repo, "good.yaml", GOOD);

    const loaded = await loadDecisions(repo);
    expect(loaded.writers.map((w) => w.fileName)).toEqual(["good.yaml"]);
    expect(loaded.warnings).toHaveLength(1);
    expect(loaded.warnings[0]).toContain(".tulis/decisions/bomb.yaml");
  });

  it("skips a file over 64 KB", async () => {
    const repo = makeFolder();
    writeDecision(repo, "big.yaml", `${GOOD}${"# padding\n".repeat(7000)}`);
    writeDecision(repo, "good.yaml", GOOD);

    const loaded = await loadDecisions(repo);
    expect(loaded.writers.map((w) => w.fileName)).toEqual(["good.yaml"]);
    expect(loaded.warnings).toEqual([
      ".tulis/decisions/big.yaml: The file is larger than 64 KB. The file was skipped.",
    ]);
  });

  it("gives the folder warning for more than 500 files", async () => {
    const repo = makeFolder();
    for (let i = 0; i <= MAX_DECISIONS_FILES; i += 1) {
      writeDecision(repo, `w${String(i)}.yaml`, "");
    }
    const loaded = await loadDecisions(repo);
    expect(loaded.writers).toEqual([]);
    expect(loaded.warnings).toEqual([
      ".tulis/decisions/: The folder has more than 500 files.",
    ]);
  });

  it("never puts file content from a bad value in a warning", async () => {
    const repo = makeFolder();
    writeDecision(
      repo,
      "amy.yaml",
      `version: 1
dismissals:
  - check: "TOPSECRET-check"
    count: "TOPSECRET-count"
    last: "TOPSECRET-last"
    TOPSECRET-key: 1
`,
    );
    writeDecision(repo, "bad.yaml", "TOPSECRET: [unclosed\n");
    const loaded = await loadDecisions(repo);
    expect(loaded.warnings.length).toBeGreaterThan(0);
    const everything = loaded.warnings.join("\n");
    expect(everything).not.toContain("TOPSECRET-check");
    expect(everything).not.toContain("TOPSECRET-count");
    expect(everything).not.toContain("TOPSECRET-last");
  });

  it("shows a file name with a bidi control character safely", async () => {
    const repo = makeFolder();
    const name = "evil\u202egnp.yaml";
    writeDecision(repo, name, GOOD);
    const loaded = await loadDecisions(repo);
    expect(loaded.writers).toEqual([]);
    expect(loaded.warnings).toHaveLength(1);
    expect(loaded.warnings[0]).not.toContain("\u202e");
  });
});
