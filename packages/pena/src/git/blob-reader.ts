import {
  GitCommandError,
  type GitExit,
  type GitProcess,
  type GitRunner,
} from "./git-runner.js";
import { isObjectId } from "./ref-name.js";
import { toSafeText } from "./safe-text.js";

export const DEFAULT_MAX_BLOB_BYTES = 1024 * 1024;
export const DEFAULT_READ_TIMEOUT_MS = 30_000;

const MAX_HEADER_BYTES = 1024;
const LF = 0x0a;

export interface BlobReaderOptions {
  /** Content larger than this is skipped ("too-large"). Integer, 0 or more. Default DEFAULT_MAX_BLOB_BYTES. */
  readonly maxBlobBytes?: number;
  /** Longest time to wait with no output from git while reads are pending. Integer, 1 or more. Default DEFAULT_READ_TIMEOUT_MS. */
  readonly timeoutMs?: number;
}

export type BlobResult =
  | {
      readonly kind: "content";
      readonly blobId: string;
      readonly size: number;
      readonly content: Buffer;
    }
  | {
      readonly kind: "too-large";
      readonly blobId: string;
      readonly size: number;
    }
  | { readonly kind: "missing"; readonly blobId: string };

export interface BlobReader {
  /** Reads one blob. Rejects with Error for an ID that isn't a full object ID (nothing is sent to git), an object that isn't a blob, or after close(); with GitCommandError on timeout ("timeout") or if git exits early ("exit", or "spawn" if it never started). */
  read(blobId: string): Promise<BlobResult>;
  /** Ends git's input, lets git answer reads already sent, then waits for it to exit (stopping it if it takes longer than timeoutMs). Safe to call more than once. */
  close(): Promise<void>;
}

interface Request {
  readonly id: string;
  readonly resolve: (result: BlobResult) => void;
  readonly reject: (error: Error) => void;
}

type Phase =
  | { readonly name: "header"; readonly bytes: Buffer }
  | {
      readonly name: "body";
      remaining: number;
      /** undefined means the content is thrown away as it streams. */
      readonly chunks: Buffer[] | undefined;
      readonly finish: () => void;
    }
  | { readonly name: "terminator"; readonly finish: () => void };

const OBJECT_HEADER =
  /^([0-9a-f]{40}|[0-9a-f]{64}) (blob|tree|commit|tag) (\d+)$/;
const MISSING_HEADER = /^([0-9a-f]{40}|[0-9a-f]{64}) missing$/;

function checkOptions(maxBlobBytes: number, timeoutMs: number): void {
  if (!Number.isSafeInteger(maxBlobBytes) || maxBlobBytes < 0) {
    throw new Error("maxBlobBytes must be an integer of 0 or more");
  }
  if (!Number.isSafeInteger(timeoutMs) || timeoutMs < 1) {
    throw new Error("timeoutMs must be an integer of 1 or more");
  }
}

function exitError(exit: GitExit): Error {
  if (exit.startError !== undefined) {
    return exit.startError;
  }
  const code = exit.exitCode === null ? "none" : String(exit.exitCode);
  return new GitCommandError(
    "cat-file",
    "exit",
    `git cat-file stopped (exit code ${code}) before all reads were answered.`,
    {
      ...(exit.exitCode === null ? {} : { exitCode: exit.exitCode }),
      stderr: exit.stderr,
    },
  );
}

/** Starts git cat-file --batch through runner.start(). Throws Error on bad options. */
export function openBlobReader(
  runner: GitRunner,
  options?: BlobReaderOptions,
): BlobReader {
  const maxBlobBytes = options?.maxBlobBytes ?? DEFAULT_MAX_BLOB_BYTES;
  const timeoutMs = options?.timeoutMs ?? DEFAULT_READ_TIMEOUT_MS;
  checkOptions(maxBlobBytes, timeoutMs);

  const proc: GitProcess = runner.start("cat-file", ["--batch"]);
  const pending: Request[] = [];
  let phase: Phase = { name: "header", bytes: Buffer.alloc(0) };
  let broken: Error | undefined;
  let closed = false;
  let closePromise: Promise<void> | undefined;
  let timer: NodeJS.Timeout | undefined;

  function isBroken(): boolean {
    return broken !== undefined;
  }

  function clearTimer(): void {
    if (timer !== undefined) {
      clearTimeout(timer);
      timer = undefined;
    }
  }

  /** Marks the reader broken, stops git and rejects every pending read. */
  function fail(error: Error): void {
    if (broken !== undefined) {
      return;
    }
    broken = error;
    clearTimer();
    proc.stop();
    for (const request of pending.splice(0)) {
      request.reject(error);
    }
  }

  function armTimer(): void {
    clearTimer();
    if (pending.length === 0 || broken !== undefined) {
      return;
    }
    timer = setTimeout(() => {
      fail(
        new GitCommandError(
          "cat-file",
          "timeout",
          `git cat-file gave no output for ${String(timeoutMs)} ms and was stopped.`,
        ),
      );
    }, timeoutMs);
  }

  function takeRequest(): Request {
    const request = pending.shift();
    if (request === undefined) {
      throw new Error("No pending read");
    }
    return request;
  }

  function startHeader(): void {
    phase = { name: "header", bytes: Buffer.alloc(0) };
  }

  function handleHeader(line: string): void {
    const request = pending[0];
    if (request === undefined) {
      fail(new Error("git cat-file sent output that no read asked for"));
      return;
    }
    const missing = MISSING_HEADER.exec(line);
    if (missing !== null) {
      if (missing[1] !== request.id) {
        fail(new Error("git cat-file answered for a different object"));
        return;
      }
      takeRequest().resolve({ kind: "missing", blobId: request.id });
      startHeader();
      return;
    }
    const match = OBJECT_HEADER.exec(line);
    if (match === null) {
      fail(new Error("git cat-file sent a header in an unknown format"));
      return;
    }
    const [, id = "", type = "", sizeText = ""] = match;
    const size = Number(sizeText);
    if (id !== request.id) {
      fail(new Error("git cat-file answered for a different object"));
      return;
    }
    if (!Number.isSafeInteger(size)) {
      fail(new Error("git cat-file sent an invalid object size"));
      return;
    }
    let chunks: Buffer[] | undefined;
    let finish: () => void;
    if (type !== "blob") {
      finish = () => {
        takeRequest().reject(
          new Error(`Object ${id} is a ${type}, not a blob`),
        );
      };
    } else if (size > maxBlobBytes) {
      finish = () => {
        takeRequest().resolve({ kind: "too-large", blobId: id, size });
      };
    } else {
      const collected: Buffer[] = [];
      chunks = collected;
      finish = () => {
        takeRequest().resolve({
          kind: "content",
          blobId: id,
          size,
          content: Buffer.concat(collected),
        });
      };
    }
    phase = { name: "body", remaining: size, chunks, finish };
    if (size === 0) {
      phase = { name: "terminator", finish };
    }
  }

  function onData(chunk: Buffer): void {
    if (isBroken()) {
      return;
    }
    armTimer();
    let offset = 0;
    while (offset < chunk.length) {
      if (pending.length === 0) {
        fail(new Error("git cat-file sent output that no read asked for"));
        return;
      }
      const current = phase;
      if (current.name === "header") {
        const lf = chunk.indexOf(LF, offset);
        const end = lf === -1 ? chunk.length : lf;
        const part = chunk.subarray(offset, end);
        if (current.bytes.length + part.length > MAX_HEADER_BYTES) {
          fail(new Error("git cat-file sent a header that is too long"));
          return;
        }
        const bytes = Buffer.concat([current.bytes, part]);
        if (lf === -1) {
          phase = { name: "header", bytes };
          return;
        }
        offset = lf + 1;
        handleHeader(bytes.toString("latin1"));
      } else if (current.name === "body") {
        const take = Math.min(current.remaining, chunk.length - offset);
        current.chunks?.push(chunk.subarray(offset, offset + take));
        current.remaining -= take;
        offset += take;
        if (current.remaining === 0) {
          phase = { name: "terminator", finish: current.finish };
        }
      } else {
        if (chunk[offset] !== LF) {
          fail(new Error("git cat-file did not end an object with a newline"));
          return;
        }
        offset += 1;
        current.finish();
        startHeader();
      }
      if (broken !== undefined) {
        return;
      }
    }
    if (pending.length === 0) {
      clearTimer();
    }
  }

  proc.stdout.on("data", (chunk: Buffer | string) => {
    onData(typeof chunk === "string" ? Buffer.from(chunk, "latin1") : chunk);
  });
  proc.stdout.on("error", () => {
    fail(new Error("Could not read from git cat-file"));
  });
  const exitedPromise = proc.exited.then((exit) => {
    if (broken === undefined && !(closed && pending.length === 0)) {
      fail(exitError(exit));
    }
  });

  async function doClose(): Promise<void> {
    closed = true;
    proc.stdin.end();
    let closeTimer: NodeJS.Timeout | undefined;
    const timedOut = await Promise.race([
      exitedPromise.then(() => false),
      new Promise<boolean>((resolve) => {
        closeTimer = setTimeout(() => {
          resolve(true);
        }, timeoutMs);
      }),
    ]);
    clearTimeout(closeTimer);
    if (timedOut) {
      fail(
        new GitCommandError(
          "cat-file",
          "timeout",
          `git cat-file did not exit within ${String(timeoutMs)} ms and was stopped.`,
        ),
      );
    }
  }

  return {
    async read(blobId) {
      if (closed) {
        throw new Error("The blob reader is closed");
      }
      if (broken !== undefined) {
        throw broken;
      }
      if (!isObjectId(blobId)) {
        throw new Error(`Not a full object ID: "${toSafeText(blobId)}"`);
      }
      return await new Promise<BlobResult>((resolve, reject) => {
        pending.push({ id: blobId, resolve, reject });
        if (timer === undefined) {
          armTimer();
        }
        proc.stdin.write(`${blobId}\n`);
      });
    },
    close() {
      closePromise ??= doClose();
      return closePromise;
    },
  };
}
