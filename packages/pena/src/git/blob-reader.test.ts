import { PassThrough } from "node:stream";
import { cloneTestRepo, createTestRepo, type TestRepo } from "@tulis/testkit";
import { afterEach, beforeAll, describe, expect, it } from "vitest";
import {
  DEFAULT_MAX_BLOB_BYTES,
  openBlobReader,
  type BlobReader,
  type BlobReaderOptions,
} from "./blob-reader.js";
import { findGit, type GitExecutable } from "./find-git.js";
import {
  GitCommandError,
  createGitRunner,
  type GitExit,
  type GitRunner,
} from "./git-runner.js";

const T = 30_000;
const ID1 = "a".repeat(40);
const ID2 = "b".repeat(40);
const ID3 = "c".repeat(40);
const ID64 = "d".repeat(64);

interface Fake {
  readonly runner: GitRunner;
  readonly stdout: PassThrough;
  readonly written: () => string;
  readonly stopCalls: () => number;
  readonly exit: (exit: Partial<GitExit>) => void;
  readonly stdinEnded: () => boolean;
}

function makeFake(git: GitExecutable): Fake {
  const stdin = new PassThrough();
  const stdout = new PassThrough();
  let written = "";
  let stops = 0;
  stdin.on("data", (chunk: Buffer) => {
    written += chunk.toString("latin1");
  });
  let resolveExit: (exit: GitExit) => void = () => undefined;
  const exited = new Promise<GitExit>((resolve) => {
    resolveExit = resolve;
  });
  const real = createGitRunner(git, process.cwd());
  const runner: GitRunner = {
    ...real,
    start: () => ({
      stdin,
      stdout,
      exited,
      stop() {
        stops += 1;
      },
    }),
  };
  return {
    runner,
    stdout,
    written: () => written,
    stopCalls: () => stops,
    stdinEnded: () => stdin.writableEnded,
    exit: (exit) => {
      resolveExit({ exitCode: 0, signal: null, stderr: "", ...exit });
    },
  };
}

function blobAnswer(id: string, content: Buffer | string): Buffer {
  const body = Buffer.from(content);
  return Buffer.concat([
    Buffer.from(`${id} blob ${String(body.length)}\n`),
    body,
    Buffer.from("\n"),
  ]);
}

async function failureOf(promise: Promise<unknown>): Promise<Error> {
  try {
    await promise;
  } catch (error) {
    if (error instanceof Error) {
      return error;
    }
    throw error;
  }
  throw new Error("Expected a rejection");
}

async function gitFailureOf(
  promise: Promise<unknown>,
): Promise<GitCommandError> {
  const error = await failureOf(promise);
  if (!(error instanceof GitCommandError)) {
    throw new Error("Expected a GitCommandError");
  }
  return error;
}

describe("blob reader protocol (fake git)", () => {
  let git: GitExecutable;
  let readers: BlobReader[] = [];
  let fakes: Fake[] = [];

  beforeAll(async () => {
    git = await findGit();
  });

  afterEach(async () => {
    // The fake git exits once its input is closed, like the real one.
    for (const fake of fakes) {
      fake.exit({});
    }
    for (const reader of readers) {
      await reader.close();
    }
    readers = [];
    fakes = [];
  });

  function open(options?: BlobReaderOptions): {
    fake: Fake;
    reader: BlobReader;
  } {
    const fake = makeFake(git);
    const reader = openBlobReader(fake.runner, options);
    readers.push(reader);
    fakes.push(fake);
    return { fake, reader };
  }

  it("reads one blob", async () => {
    const { fake, reader } = open();
    const result = reader.read(ID1);
    expect(fake.written()).toBe(`${ID1}\n`);
    fake.stdout.write(blobAnswer(ID1, "hello\n"));
    expect(await result).toEqual({
      kind: "content",
      blobId: ID1,
      size: 6,
      content: Buffer.from("hello\n"),
    });
  });

  it("matches pipelined reads to answers in order", async () => {
    const { fake, reader } = open();
    const a = reader.read(ID1);
    const b = reader.read(ID2);
    const c = reader.read(ID3);
    expect(fake.written()).toBe(`${ID1}\n${ID2}\n${ID3}\n`);
    fake.stdout.write(blobAnswer(ID1, "one"));
    fake.stdout.write(blobAnswer(ID2, "two"));
    fake.stdout.write(blobAnswer(ID3, "three"));
    const results = await Promise.all([a, b, c]);
    expect(
      results.map((r) => (r.kind === "content" ? r.content.toString() : "")),
    ).toEqual(["one", "two", "three"]);
  });

  it("handles an answer split byte by byte", async () => {
    const { fake, reader } = open();
    const result = reader.read(ID1);
    for (const byte of blobAnswer(ID1, "split me")) {
      fake.stdout.write(Buffer.from([byte]));
    }
    const answer = await result;
    expect(answer.kind === "content" && answer.content.toString()).toBe(
      "split me",
    );
  });

  it("handles two answers in one chunk", async () => {
    const { fake, reader } = open();
    const a = reader.read(ID1);
    const b = reader.read(ID2);
    fake.stdout.write(
      Buffer.concat([blobAnswer(ID1, "x"), blobAnswer(ID2, "yy")]),
    );
    expect((await a).kind).toBe("content");
    const second = await b;
    expect(second.kind === "content" && second.size).toBe(2);
  });

  it("keeps NUL, CR and a missing final newline", async () => {
    const { fake, reader } = open();
    const bytes = Buffer.from([0x61, 0x00, 0x0d, 0x0a, 0x0d, 0x62]);
    const result = reader.read(ID1);
    fake.stdout.write(blobAnswer(ID1, bytes));
    const answer = await result;
    expect(answer.kind === "content" && answer.content.equals(bytes)).toBe(
      true,
    );
  });

  it("reads an empty blob", async () => {
    const { fake, reader } = open();
    const a = reader.read(ID1);
    const b = reader.read(ID2);
    fake.stdout.write(
      Buffer.concat([blobAnswer(ID1, ""), blobAnswer(ID2, "z")]),
    );
    expect(await a).toEqual({
      kind: "content",
      blobId: ID1,
      size: 0,
      content: Buffer.alloc(0),
    });
    expect((await b).kind).toBe("content");
  });

  it("reports a missing blob", async () => {
    const { fake, reader } = open();
    const a = reader.read(ID1);
    const b = reader.read(ID2);
    fake.stdout.write(Buffer.from(`${ID1} missing\n`));
    fake.stdout.write(blobAnswer(ID2, "ok"));
    expect(await a).toEqual({ kind: "missing", blobId: ID1 });
    expect((await b).kind).toBe("content");
  });

  it("skips a too-large blob and stays in sync", async () => {
    const { fake, reader } = open({ maxBlobBytes: 10 });
    const a = reader.read(ID1);
    const b = reader.read(ID2);
    const c = reader.read(ID3);
    const big = Buffer.alloc(11, 0x0a);
    // Header and the first part of the content, then the rest.
    const answer = blobAnswer(ID1, big);
    fake.stdout.write(answer.subarray(0, 60));
    fake.stdout.write(answer.subarray(60));
    fake.stdout.write(blobAnswer(ID2, "0123456789"));
    fake.stdout.write(blobAnswer(ID3, ""));
    expect(await a).toEqual({ kind: "too-large", blobId: ID1, size: 11 });
    const exact = await b;
    expect(exact.kind === "content" && exact.size).toBe(10);
    expect((await c).kind).toBe("content");
  });

  it("allows only empty blobs when maxBlobBytes is 0", async () => {
    const { fake, reader } = open({ maxBlobBytes: 0 });
    const a = reader.read(ID1);
    const b = reader.read(ID2);
    fake.stdout.write(
      Buffer.concat([blobAnswer(ID1, ""), blobAnswer(ID2, "x")]),
    );
    expect((await a).kind).toBe("content");
    expect(await b).toEqual({ kind: "too-large", blobId: ID2, size: 1 });
  });

  it("rejects a tree answer and keeps working", async () => {
    const { fake, reader } = open();
    const a = reader.read(ID1);
    const b = reader.read(ID2);
    fake.stdout.write(Buffer.from(`${ID1} tree 4\nabcd\n`));
    fake.stdout.write(blobAnswer(ID2, "ok"));
    const error = await failureOf(a);
    expect(error.message).toBe(`Object ${ID1} is a tree, not a blob`);
    expect(error).not.toBeInstanceOf(GitCommandError);
    expect((await b).kind).toBe("content");
    expect(fake.stopCalls()).toBe(0);
  });

  it("supports SHA-256 IDs", async () => {
    const { fake, reader } = open();
    const result = reader.read(ID64);
    fake.stdout.write(blobAnswer(ID64, "sha256"));
    const answer = await result;
    expect(answer.kind === "content" && answer.content.toString()).toBe(
      "sha256",
    );
  });

  describe("protocol errors", () => {
    const cases: [string, (id: string) => Buffer][] = [
      ["garbage header", () => Buffer.from("what is this\n")],
      ["an answer for a different ID", () => blobAnswer(ID2, "x")],
      [
        "a non-LF byte after the content",
        (id) => Buffer.from(`${id} blob 1\nxZ`),
      ],
      ["a header with no LF that is too long", () => Buffer.alloc(2000, 0x61)],
      [
        "an unsafe size",
        (id) => Buffer.from(`${id} blob 99999999999999999999\n`),
      ],
    ];
    for (const [name, answer] of cases) {
      it(`fails on ${name}`, async () => {
        const { fake, reader } = open();
        const a = reader.read(ID1);
        const b = reader.read(ID3);
        fake.stdout.write(answer(ID1));
        const first = await failureOf(a);
        expect(first).not.toBeInstanceOf(GitCommandError);
        expect(first.message).not.toContain("what is this");
        expect(await failureOf(b)).toBe(first);
        expect(fake.stopCalls()).toBeGreaterThanOrEqual(1);
        const later = await failureOf(reader.read(ID2));
        expect(later).toBe(first);
      });
    }
  });

  it("fails on output nobody asked for", async () => {
    const { fake, reader } = open();
    const a = reader.read(ID1);
    fake.stdout.write(
      Buffer.concat([blobAnswer(ID1, "x"), Buffer.from("extra\n")]),
    );
    expect((await a).kind).toBe("content");
    const error = await failureOf(reader.read(ID2));
    expect(error.message).toMatch(/no read asked/);
    expect(fake.stopCalls()).toBe(1);
  });

  describe("timeout", () => {
    it("rejects and stops git when git gives no answer", async () => {
      const { fake, reader } = open({ timeoutMs: 50 });
      const error = await gitFailureOf(reader.read(ID1));
      expect(error.failure).toBe("timeout");
      expect(fake.stopCalls()).toBe(1);
      expect(await failureOf(reader.read(ID2))).toBe(error);
    });

    it("succeeds when a slow answer keeps sending chunks", async () => {
      const { fake, reader } = open({ timeoutMs: 200 });
      const result = reader.read(ID1);
      const answer = blobAnswer(ID1, "slow answer here");
      for (let i = 0; i < answer.length; i += 8) {
        await new Promise((resolve) => setTimeout(resolve, 60));
        fake.stdout.write(answer.subarray(i, i + 8));
      }
      expect((await result).kind).toBe("content");
      expect(fake.stopCalls()).toBe(0);
    });

    it("does not time out while no reads are pending", async () => {
      const { fake, reader } = open({ timeoutMs: 30 });
      await new Promise((resolve) => setTimeout(resolve, 100));
      const result = reader.read(ID1);
      fake.stdout.write(blobAnswer(ID1, "late"));
      expect((await result).kind).toBe("content");
      expect(fake.stopCalls()).toBe(0);
    });
  });

  describe("git exits or fails to start", () => {
    it("rejects pending reads when git exits early", async () => {
      const { fake, reader } = open();
      const result = reader.read(ID1);
      fake.exit({ exitCode: 128, stderr: "fatal: broken" });
      const error = await gitFailureOf(result);
      const git = error;
      expect(git.failure).toBe("exit");
      expect(git.exitCode).toBe(128);
      expect(git.stderr).toBe("fatal: broken");
      expect(fake.stopCalls()).toBe(1);
      expect(await failureOf(reader.read(ID2))).toBe(error);
    });

    it("rejects reads with spawn when git never started", async () => {
      const { fake, reader } = open();
      const result = reader.read(ID1);
      const startError = new GitCommandError(
        "cat-file",
        "spawn",
        "Could not start git cat-file.",
      );
      fake.exit({ exitCode: null, startError });
      expect(await failureOf(result)).toBe(startError);
      expect(await failureOf(reader.read(ID2))).toBe(startError);
    });

    it("breaks the reader when git exits before close", async () => {
      const { fake, reader } = open();
      fake.exit({ exitCode: 1 });
      await new Promise((resolve) => setTimeout(resolve, 10));
      const error = await gitFailureOf(reader.read(ID1));
      expect(error.failure).toBe("exit");
    });
  });

  it("rejects bad IDs without writing to git", async () => {
    const { fake, reader } = open();
    const bad = [
      "HEAD",
      "HEAD:a.md",
      `${ID1}\n`,
      `${ID1}\n${ID2}`,
      "a".repeat(7),
      "A".repeat(40),
      "",
    ];
    for (const id of bad) {
      await expect(reader.read(id), JSON.stringify(id)).rejects.toThrow(
        /Not a full object ID/,
      );
    }
    expect(fake.written()).toBe("");
    expect(fake.stopCalls()).toBe(0);
  });

  it("throws on bad options", () => {
    const fake = makeFake({ path: "git" } as unknown as GitExecutable);
    for (const options of [
      { maxBlobBytes: -1 },
      { maxBlobBytes: 1.5 },
      { maxBlobBytes: Number.NaN },
      { timeoutMs: 0 },
      { timeoutMs: 2.5 },
    ]) {
      expect(() => openBlobReader(fake.runner, options)).toThrow();
    }
    expect(DEFAULT_MAX_BLOB_BYTES).toBe(1_048_576);
  });

  describe("close", () => {
    it("rejects reads after close and can be called twice", async () => {
      const { fake, reader } = open();
      const closing = reader.close();
      fake.exit({ exitCode: 0 });
      await closing;
      await reader.close();
      expect(fake.stdinEnded()).toBe(true);
      await expect(reader.read(ID1)).rejects.toThrow(/closed/);
      expect(fake.written()).toBe("");
      expect(fake.stopCalls()).toBe(0);
    });

    it("lets a read in flight finish", async () => {
      const { fake, reader } = open();
      const result = reader.read(ID1);
      const closing = reader.close();
      fake.stdout.write(blobAnswer(ID1, "done"));
      expect((await result).kind).toBe("content");
      fake.exit({ exitCode: 0 });
      await closing;
      expect(fake.stopCalls()).toBe(0);
    });

    it("stops git when it does not exit within timeoutMs", async () => {
      const { fake, reader } = open({ timeoutMs: 50 });
      await reader.close();
      expect(fake.stopCalls()).toBe(1);
    });
  });
});

describe("blob reader with real git", () => {
  let git: GitExecutable;
  let repos: TestRepo[] = [];
  let readers: BlobReader[] = [];

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
    readers = [];
    repos = [];
  });

  function track(repo: TestRepo): TestRepo {
    repos.push(repo);
    return repo;
  }

  function openFor(repo: TestRepo, options?: BlobReaderOptions): BlobReader {
    const reader = openBlobReader(createGitRunner(git, repo.dir), options);
    readers.push(reader);
    return reader;
  }

  async function blobId(repo: TestRepo, path: string): Promise<string> {
    return (await repo.git(["rev-parse", `HEAD:${path}`])).trim();
  }

  async function countMissing(repo: TestRepo): Promise<number> {
    const out = await repo.git([
      "rev-list",
      "--objects",
      "--all",
      "--missing=print",
    ]);
    return out.split("\n").filter((line) => line.startsWith("?")).length;
  }

  it(
    "reads several files with exact bytes, including CRLF",
    async () => {
      const repo = track(
        await createTestRepo({ config: { "core.autocrlf": "false" } }),
      );
      const crlf = Buffer.from("line one\r\nline two\r\n");
      const binary = Buffer.from([0, 1, 2, 0x0d, 0xff, 0x00]);
      await repo.commit({
        message: "files",
        files: { "a.md": "# A\n", "crlf.md": crlf, "bin.dat": binary },
      });
      const reader = openFor(repo);
      const [a, c, b] = await Promise.all([
        reader.read(await blobId(repo, "a.md")),
        reader.read(await blobId(repo, "crlf.md")),
        reader.read(await blobId(repo, "bin.dat")),
      ]);
      expect(a.kind === "content" && a.content.toString()).toBe("# A\n");
      expect(c.kind === "content" && c.content.equals(crlf)).toBe(true);
      expect(b.kind === "content" && b.content.equals(binary)).toBe(true);
      await reader.close();
    },
    T,
  );

  it(
    "skips a 2 MiB file and keeps reading",
    async () => {
      const repo = track(await createTestRepo());
      const size = 2 * 1024 * 1024;
      await repo.commit({
        message: "big",
        files: { "big.bin": Buffer.alloc(size, 0x0a), "small.md": "small\n" },
      });
      const reader = openFor(repo);
      const big = await reader.read(await blobId(repo, "big.bin"));
      expect(big).toEqual({
        kind: "too-large",
        blobId: await blobId(repo, "big.bin"),
        size,
      });
      const small = await reader.read(await blobId(repo, "small.md"));
      expect(small.kind === "content" && small.content.toString()).toBe(
        "small\n",
      );
    },
    T,
  );

  it(
    "reads an empty file",
    async () => {
      const repo = track(await createTestRepo());
      await repo.commit({ message: "empty", files: { "empty.md": "" } });
      const reader = openFor(repo);
      const result = await reader.read(await blobId(repo, "empty.md"));
      expect(result.kind === "content" && result.size).toBe(0);
    },
    T,
  );

  it(
    "rejects a tree ID and keeps working",
    async () => {
      const repo = track(await createTestRepo());
      await repo.commit({ message: "x", files: { "a.md": "a\n" } });
      const tree = (await repo.git(["rev-parse", "HEAD^{tree}"])).trim();
      const reader = openFor(repo);
      await expect(reader.read(tree)).rejects.toThrow(/is a tree, not a blob/);
      const result = await reader.read(await blobId(repo, "a.md"));
      expect(result.kind).toBe("content");
    },
    T,
  );

  it(
    "reports a missing blob in a partial clone without downloading it",
    async () => {
      const source = track(await createTestRepo());
      await source.commit({ message: "one", files: { "a.md": "one\n" } });
      const oldBlob = await blobId(source, "a.md");
      await source.commit({ message: "two", files: { "a.md": "two\n" } });
      const clone = track(await cloneTestRepo(source, { partial: true }));
      const before = await countMissing(clone);
      expect(before).toBeGreaterThanOrEqual(1);

      const reader = openFor(clone);
      expect(await reader.read(oldBlob)).toEqual({
        kind: "missing",
        blobId: oldBlob,
      });
      const present = await reader.read(await blobId(clone, "a.md"));
      expect(present.kind === "content" && present.content.toString()).toBe(
        "two\n",
      );
      await reader.close();
      expect(await countMissing(clone)).toBe(before);
    },
    T,
  );
});
