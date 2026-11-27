import { Worker } from "node:worker_threads";
import { afterEach, describe, expect, it } from "vitest";
import {
  createDocPreparer,
  createDocPreparerWith,
  type DocPreparer,
} from "./doc-preparer.js";
import { prepareDoc } from "./prepare-doc.js";

const open: DocPreparer[] = [];

function track(preparer: DocPreparer): DocPreparer {
  open.push(preparer);
  return preparer;
}

afterEach(async () => {
  await Promise.all(open.splice(0).map((preparer) => preparer.close()));
});

const NORMAL = "# Title\n\nA normal sentence. Another one.\n";

// The 64 KB doc takes about 3.8 s to prepare directly.
const SLOW_LINKS = "](".repeat(32 * 1024);
// The 8 KB doc takes about 3.8 s and ends as too-deep when left alone.
const SLOW_QUOTES = "> :::a\n".repeat(1170);

const TIME_LIMIT = {
  kind: "skipped",
  reason: "time-limit",
  message: undefined,
  line: undefined,
  column: undefined,
};

async function expectNormalDoc(preparer: DocPreparer): Promise<void> {
  expect(await preparer.prepare(NORMAL, "markdown")).toEqual(
    prepareDoc(NORMAL, "markdown"),
  );
}

describe("slow docs", () => {
  it("skips a slow doc quickly, then prepares the next on a fresh worker", async () => {
    const preparer = track(createDocPreparer({ timeLimitMs: 150 }));
    // Start the worker so start-up is not part of the timing.
    await expectNormalDoc(preparer);
    const started = performance.now();
    const result = await preparer.prepare(SLOW_LINKS, "markdown");
    const elapsed = performance.now() - started;
    expect(result).toEqual({ ...TIME_LIMIT, syntax: "markdown" });
    expect(elapsed).toBeLessThan(2000);
    await expectNormalDoc(preparer);
  });

  it("skips the deeply nested slow doc", async () => {
    const preparer = track(createDocPreparer({ timeLimitMs: 150 }));
    const result = await preparer.prepare(SLOW_QUOTES, "markdown");
    expect(result).toEqual({ ...TIME_LIMIT, syntax: "markdown" });
  });

  it("skips two slow docs in a row, then prepares a normal one", async () => {
    const preparer = track(createDocPreparer({ timeLimitMs: 150 }));
    const first = await preparer.prepare(SLOW_LINKS, "mdx");
    const second = await preparer.prepare(SLOW_QUOTES, "markdown");
    expect(first).toEqual({ ...TIME_LIMIT, syntax: "mdx" });
    expect(second).toEqual({ ...TIME_LIMIT, syntax: "markdown" });
    await expectNormalDoc(preparer);
  });
});

const READY = `
const { parentPort } = require("node:worker_threads");
`;

/** Starts a small CommonJS worker; `body` can use `parentPort`. */
function fakeWorker(body: string): () => Worker {
  return () => new Worker(READY + body, { eval: true });
}

function preparerWith(
  startWorker: () => Worker,
  startUpLimitMs = 5000,
): DocPreparer {
  return track(
    createDocPreparerWith({ timeLimitMs: 2000, startUpLimitMs, startWorker }),
  );
}

/** Waits for a rejection and returns its message. */
async function failureMessage(call: Promise<unknown>): Promise<string> {
  try {
    await call;
  } catch (error) {
    if (error instanceof Error) {
      return error.message;
    }
    throw new Error("Rejected with something that is not an Error.", {
      cause: error,
    });
  }
  throw new Error("Expected the call to reject.");
}

describe("worker failures", () => {
  it("turns a crash mid-doc into preparation-error, then recovers", async () => {
    let starts = 0;
    const crashing = fakeWorker(`
      parentPort.postMessage({ type: "ready" });
      parentPort.on("message", () => { process.exit(1); });
    `);
    const preparer = preparerWith(() => {
      starts += 1;
      // The first worker crashes; later ones answer.
      return starts === 1
        ? crashing()
        : fakeWorker(`
            parentPort.postMessage({ type: "ready" });
            parentPort.on("message", (m) => {
              parentPort.postMessage({ type: "result", id: m.id,
                result: { kind: "skipped", syntax: m.syntax,
                  reason: "non-english", message: undefined,
                  line: undefined, column: undefined } });
            });
          `)();
    });
    const first = await preparer.prepare("Secret text.\n", "markdown");
    expect(first).toEqual({
      kind: "skipped",
      syntax: "markdown",
      reason: "preparation-error",
      message: undefined,
      line: undefined,
      column: undefined,
    });
    const second = await preparer.prepare("Other.\n", "mdx");
    expect(second).toMatchObject({ reason: "non-english", syntax: "mdx" });
    expect(starts).toBe(2);
  });

  it("rejects with a clear error when the worker never becomes ready", async () => {
    const preparer = preparerWith(
      fakeWorker(`setInterval(() => {}, 1000);`),
      150,
    );
    const message = await failureMessage(
      preparer.prepare("Secret text.\n", "markdown"),
    );
    expect(message).toBe("The preparation worker could not start.");
    expect(message).not.toContain("Secret");
  });

  it("rejects when the worker exits before it is ready", async () => {
    const preparer = preparerWith(fakeWorker(`process.exit(3);`));
    const first = preparer.prepare("Secret text.\n", "markdown");
    const second = preparer.prepare("More secret.\n", "markdown");
    for (const call of [first, second]) {
      await expect(call).rejects.toThrow(
        "The preparation worker could not start.",
      );
    }
  });

  it("rejects when the worker throws while loading", async () => {
    const preparer = preparerWith(
      fakeWorker(`throw new Error("boom Secret");`),
    );
    const message = await failureMessage(
      preparer.prepare("Secret text.\n", "markdown"),
    );
    expect(message).toBe("The preparation worker could not start.");
  });

  it("rejects when the worker cannot be created", async () => {
    const preparer = preparerWith(() => {
      throw new Error("no worker");
    });
    await expect(preparer.prepare("Secret.\n", "markdown")).rejects.toThrow(
      "The preparation worker could not start.",
    );
  });
});

describe("untrusted messages", () => {
  it("ignores messages with a wrong id or a wrong shape", async () => {
    const preparer = preparerWith(
      fakeWorker(`
        parentPort.postMessage({ type: "ready" });
        parentPort.on("message", (m) => {
          const bogus = { kind: "prepared" };
          parentPort.postMessage({ type: "result", id: m.id + 1000, result: bogus });
          parentPort.postMessage({ type: "result", id: m.id, result: "nope" });
          parentPort.postMessage({ type: "result", result: bogus });
          parentPort.postMessage({ type: "other", id: m.id });
          parentPort.postMessage("text");
          parentPort.postMessage(null);
          parentPort.postMessage({ type: "ready" });
          parentPort.postMessage({ type: "result", id: m.id,
            result: { kind: "skipped", syntax: m.syntax, reason: "non-english",
              message: undefined, line: undefined, column: undefined } });
        });
      `),
    );
    const result = await preparer.prepare("Text.\n", "markdown");
    expect(result).toEqual({
      kind: "skipped",
      syntax: "markdown",
      reason: "non-english",
      message: undefined,
      line: undefined,
      column: undefined,
    });
  });
});
