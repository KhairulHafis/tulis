import { Worker } from "node:worker_threads";
import type { MarkdownSyntax } from "../markdown/parse-markdown.js";
import type { PrepareResult, SkippedDoc } from "./prepare-doc.js";
import { isWorkerMessage, type PrepareRequest } from "./worker-messages.js";

/** Milliseconds one doc may take before it is skipped. */
export const PREPARE_TIME_LIMIT_MS = 10_000;

/** Milliseconds a new worker may take to load before it counts as broken. */
const START_UP_LIMIT_MS = 30_000;

export interface DocPreparerOptions {
  /** Milliseconds one doc may take. Defaults to PREPARE_TIME_LIMIT_MS. */
  readonly timeLimitMs?: number;
  /** Product names for masking; the worker builds the matcher once. */
  readonly productNames?: readonly string[];
}

export interface DocPreparer {
  /** Never rejects for a doc problem; rejects only if the worker can't start or the preparer is closed. */
  prepare(text: string, syntax: MarkdownSyntax): Promise<PrepareResult>;
  /** Stops the worker. Safe to call more than once. */
  close(): Promise<void>;
}

/** Internal seam for tests: supplies the worker and a shorter start-up limit. */
export interface DocPreparerInternals {
  readonly timeLimitMs: number;
  readonly startUpLimitMs: number;
  readonly startWorker: () => Worker;
}

interface Job {
  readonly text: string;
  readonly syntax: MarkdownSyntax;
  readonly resolve: (result: PrepareResult) => void;
  readonly reject: (error: Error) => void;
}

interface InFlight {
  readonly id: number;
  readonly job: Job;
  readonly timer: NodeJS.Timeout;
}

function skippedDoc(
  syntax: MarkdownSyntax,
  reason: "time-limit" | "preparation-error",
): SkippedDoc {
  return {
    kind: "skipped",
    syntax,
    reason,
    message: undefined,
    line: undefined,
    column: undefined,
  };
}

/** Same as createDocPreparer, with the worker start and limits supplied. */
export function createDocPreparerWith(
  internals: DocPreparerInternals,
): DocPreparer {
  const queue: Job[] = [];
  let worker: Worker | undefined;
  let ready = false;
  let startUpTimer: NodeJS.Timeout | undefined;
  let current: InFlight | undefined;
  let nextId = 1;
  let closed = false;

  function closedError(): Error {
    return new Error("The doc preparer is closed.");
  }

  /** Forgets the worker (and stops it, if it is still running). */
  function dropWorker(): void {
    const old = worker;
    worker = undefined;
    ready = false;
    clearTimeout(startUpTimer);
    startUpTimer = undefined;
    if (old !== undefined) {
      old.terminate().catch(() => undefined);
    }
  }

  function failStartUp(): void {
    dropWorker();
    const waiting = queue.splice(0);
    for (const job of waiting) {
      job.reject(new Error("The preparation worker could not start."));
    }
  }

  function finish(result: PrepareResult): void {
    if (current === undefined) {
      return;
    }
    const done = current;
    current = undefined;
    clearTimeout(done.timer);
    done.job.resolve(result);
    pump();
  }

  function onMessage(from: Worker, message: unknown): void {
    if (from !== worker || !isWorkerMessage(message)) {
      return;
    }
    if (message.type === "ready") {
      if (!ready) {
        ready = true;
        clearTimeout(startUpTimer);
        startUpTimer = undefined;
        pump();
      }
      return;
    }
    if (current?.id === message.id) {
      finish(message.result);
    }
  }

  function onStopped(from: Worker): void {
    if (from !== worker || closed) {
      return;
    }
    if (!ready) {
      failStartUp();
    } else {
      dropWorker();
      if (current !== undefined) {
        finish(skippedDoc(current.job.syntax, "preparation-error"));
      }
    }
  }

  function onTimeUp(id: number): void {
    if (current?.id !== id) {
      return;
    }
    const syntax = current.job.syntax;
    dropWorker();
    finish(skippedDoc(syntax, "time-limit"));
  }

  function start(): void {
    let started: Worker;
    try {
      started = internals.startWorker();
    } catch {
      failStartUp();
      return;
    }
    worker = started;
    started.unref();
    started.on("message", (message: unknown) => {
      onMessage(started, message);
    });
    started.on("error", () => {
      onStopped(started);
    });
    started.on("exit", () => {
      onStopped(started);
    });
    startUpTimer = setTimeout(() => {
      if (worker === started && !ready) {
        failStartUp();
      }
    }, internals.startUpLimitMs);
  }

  function pump(): void {
    if (closed || current !== undefined || queue.length === 0) {
      return;
    }
    if (worker === undefined) {
      start();
      return;
    }
    if (!ready) {
      return;
    }
    const job = queue.shift();
    if (job === undefined) {
      return;
    }
    const id = nextId++;
    current = {
      id,
      job,
      timer: setTimeout(() => {
        onTimeUp(id);
      }, internals.timeLimitMs),
    };
    const request: PrepareRequest = { id, text: job.text, syntax: job.syntax };
    worker.postMessage(request);
  }

  function prepare(
    text: string,
    syntax: MarkdownSyntax,
  ): Promise<PrepareResult> {
    if (closed) {
      return Promise.reject(closedError());
    }
    return new Promise<PrepareResult>((resolve, reject) => {
      queue.push({ text, syntax, resolve, reject });
      pump();
    });
  }

  async function close(): Promise<void> {
    if (closed) {
      return;
    }
    closed = true;
    const stopping = worker;
    const inFlight = current;
    current = undefined;
    if (inFlight !== undefined) {
      clearTimeout(inFlight.timer);
      inFlight.job.reject(closedError());
    }
    for (const job of queue.splice(0)) {
      job.reject(closedError());
    }
    worker = undefined;
    ready = false;
    clearTimeout(startUpTimer);
    startUpTimer = undefined;
    if (stopping !== undefined) {
      await stopping.terminate();
    }
  }

  return { prepare, close };
}

export function createDocPreparer(
  options: DocPreparerOptions = {},
): DocPreparer {
  const productNames = options.productNames;
  return createDocPreparerWith({
    timeLimitMs: options.timeLimitMs ?? PREPARE_TIME_LIMIT_MS,
    startUpLimitMs: START_UP_LIMIT_MS,
    startWorker: () =>
      new Worker(new URL("./prepare-worker.js", import.meta.url), {
        workerData: { productNames },
      }),
  });
}
