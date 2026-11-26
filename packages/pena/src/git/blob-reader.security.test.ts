import { existsSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createTestRepo, type TestRepo } from "@tulis/testkit";
import { afterEach, beforeAll, describe, expect, it } from "vitest";
import { openBlobReader, type BlobReader } from "./blob-reader.js";
import { findGit, type GitExecutable } from "./find-git.js";
import { createGitRunner } from "./git-runner.js";

// Security guards: each attack runs through the blob reader (must be blocked)
// and then through plain git (the control, must work). These are guards, not
// proofs: the reader sends bare object IDs, which carry no path, so git can't
// pick a filter or textconv driver even if someone adds --filters or
// --textconv (git then refuses the batch and exits). They catch a future
// change to "rev:path" input.
describe("blob reader security", () => {
  let git: GitExecutable;
  let repos: TestRepo[] = [];
  let readers: BlobReader[] = [];
  let tempDirs: string[] = [];

  beforeAll(async () => {
    git = await findGit();
  });

  afterEach(async () => {
    for (const reader of readers) {
      await reader.close();
    }
    for (const repo of repos) {
      repo.cleanup();
    }
    for (const dir of tempDirs) {
      rmSync(dir, { recursive: true, force: true });
    }
    readers = [];
    repos = [];
    tempDirs = [];
  });

  function forwardSlashes(path: string): string {
    return path.replaceAll("\\", "/");
  }

  /** A command git can run that appends a line to a marker file. */
  function makeMarker(): { command: string; markerPath: string } {
    const dir = mkdtempSync(join(tmpdir(), "tulis-security-"));
    tempDirs.push(dir);
    const markerPath = join(dir, "marker.txt");
    const scriptPath = join(dir, "marker.mjs");
    writeFileSync(
      scriptPath,
      `import { appendFileSync } from "node:fs";\n` +
        `appendFileSync(${JSON.stringify(markerPath)}, "ran\\n");\n` +
        `process.stdout.write("converted");\n`,
    );
    const command = `"${forwardSlashes(process.execPath)}" "${forwardSlashes(scriptPath)}"`;
    return { command, markerPath };
  }

  async function attackRepo(
    attributes: string,
    configKey: string,
    command: string,
  ): Promise<{ repo: TestRepo; blobId: string }> {
    const repo = await createTestRepo();
    repos.push(repo);
    await repo.commit({ message: "doc", files: { "a.md": "raw content\n" } });
    // Set up after the commit so a clean filter never runs.
    await repo.commit({
      message: "attributes",
      files: { ".gitattributes": attributes },
    });
    await repo.git(["config", configKey, command]);
    const blobId = (await repo.git(["rev-parse", "HEAD:a.md"])).trim();
    return { repo, blobId };
  }

  async function readRaw(repo: TestRepo, blobId: string): Promise<string> {
    const reader = openBlobReader(createGitRunner(git, repo.dir));
    readers.push(reader);
    const result = await reader.read(blobId);
    await reader.close();
    if (result.kind !== "content") {
      throw new Error(`Expected content, got ${result.kind}`);
    }
    return result.content.toString("utf8");
  }

  it("does not run a smudge filter from repo config", async () => {
    const { command, markerPath } = makeMarker();
    const { repo, blobId } = await attackRepo(
      "*.md filter=evil\n",
      "filter.evil.smudge",
      command,
    );

    expect(await readRaw(repo, blobId)).toBe("raw content\n");
    expect(existsSync(markerPath)).toBe(false);

    // Control: plain git with --filters runs the program.
    await repo.git(["cat-file", "--filters", "HEAD:a.md"]);
    expect(existsSync(markerPath)).toBe(true);
  }, 30_000);

  it("does not run a textconv program from repo config", async () => {
    const { command, markerPath } = makeMarker();
    const { repo, blobId } = await attackRepo(
      "*.md diff=evil\n",
      "diff.evil.textconv",
      command,
    );

    expect(await readRaw(repo, blobId)).toBe("raw content\n");
    expect(existsSync(markerPath)).toBe(false);

    // Control: plain git with --textconv runs the program.
    await repo.git(["cat-file", "--textconv", "HEAD:a.md"]);
    expect(existsSync(markerPath)).toBe(true);
  }, 30_000);
});
