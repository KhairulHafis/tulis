import { randomUUID } from "node:crypto";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { Readable } from "node:stream";
import { createTestRepo, type TestRepo } from "@tulis/testkit";
import { afterEach, beforeAll, describe, expect, it } from "vitest";
import { findGit, type GitExecutable } from "./find-git.js";
import {
  createGitRunner,
  type GitProcess,
  type GitRunner,
} from "./git-runner.js";

/** Reads from stdout until at least `length` bytes have arrived. */
async function readBytes(stream: Readable, length: number): Promise<string> {
  const chunks: Buffer[] = [];
  let total = 0;
  for await (const chunk of stream) {
    if (!Buffer.isBuffer(chunk)) {
      throw new Error("Expected raw bytes from stdout");
    }
    chunks.push(chunk);
    total += chunk.length;
    if (total >= length) {
      break;
    }
  }
  return Buffer.concat(chunks).toString("utf8");
}

function buildStart(runner: GitRunner): GitRunner["start"] {
  return (command, args, options) => runner.start(command, args, options);
}

describe("GitRunner.start", () => {
  let git: GitExecutable;
  let repo: TestRepo | undefined;
  let running: GitProcess[] = [];

  beforeAll(async () => {
    git = await findGit();
  });

  afterEach(() => {
    for (const proc of running) {
      proc.stop();
    }
    running = [];
    repo?.cleanup();
    repo = undefined;
  });

  async function setup(): Promise<{
    runner: ReturnType<typeof createGitRunner>;
    blob: string;
  }> {
    repo = await createTestRepo();
    await repo.commit({ message: "first", files: { "a.md": "hello\n" } });
    const blob = (await repo.git(["rev-parse", "HEAD:a.md"])).trim();
    return { runner: createGitRunner(git, repo.dir), blob };
  }

  function track(proc: GitProcess): GitProcess {
    running.push(proc);
    return proc;
  }

  it("answers cat-file --batch and exits 0 when stdin ends", async () => {
    const { runner, blob } = await setup();
    const proc = track(runner.start("cat-file", ["--batch"]));
    proc.stdin.write(`${blob}\n`);
    const expected = `${blob} blob 6\nhello\n\n`;
    const output = await readBytes(proc.stdout, expected.length);
    expect(output).toBe(expected);
    proc.stdin.end();
    const exit = await proc.exited;
    expect(exit.exitCode).toBe(0);
    expect(exit.startError).toBeUndefined();
  }, 30_000);

  it("stop() ends a running process and is safe to repeat", async () => {
    const { runner } = await setup();
    const proc = track(runner.start("cat-file", ["--batch"]));
    expect(() => {
      proc.stop();
      proc.stop();
    }).not.toThrow();
    const exit = await proc.exited;
    // SIGKILL leaves no exit code; taskkill on Windows leaves exit code 1.
    expect(exit.exitCode).not.toBe(0);
    expect(exit.startError).toBeUndefined();
    expect(() => {
      proc.stop();
    }).not.toThrow();
  }, 30_000);

  it("stop() after a normal exit does nothing", async () => {
    const { runner } = await setup();
    const proc = track(runner.start("cat-file", ["--batch"]));
    proc.stdin.end();
    expect((await proc.exited).exitCode).toBe(0);
    expect(() => {
      proc.stop();
    }).not.toThrow();
  }, 30_000);

  it("survives a write to stdin after git has exited", async () => {
    const { runner, blob } = await setup();
    const proc = track(runner.start("cat-file", ["--batch"]));
    proc.stdin.end();
    await proc.exited;
    expect(() => {
      proc.stdin.write(`${blob}\n`);
    }).not.toThrow();
    // Let any asynchronous write error surface.
    await new Promise((resolve) => setTimeout(resolve, 50));
    expect((await proc.exited).exitCode).toBe(0);
  }, 30_000);

  it("reports a git program that cannot start", async () => {
    const { runner } = await setup();
    const missing = createGitRunner(
      {
        path: join(tmpdir(), `no-such-git-${randomUUID()}`),
        version: { major: 2, minor: 50, patch: 0 },
      },
      runner.repoDir,
    );
    const proc = missing.start("rev-parse", ["HEAD"]);
    const exit = await proc.exited;
    expect(exit.startError?.failure).toBe("spawn");
    expect(exit.exitCode).toBeNull();
  }, 30_000);

  it("throws at once for bad input", async () => {
    const { runner } = await setup();
    expect(() => runner.start("log", ["--"])).toThrow(
      'Pass file paths in "paths", not after "--" in args',
    );
    expect(() => runner.start("log", ["a\0b"])).toThrow(
      "Git arguments must not contain NUL characters",
    );
    expect(() => {
      Reflect.apply(buildStart(runner), undefined, ["push", []]);
    }).toThrow('Unknown git command "push"');
  }, 30_000);
});
