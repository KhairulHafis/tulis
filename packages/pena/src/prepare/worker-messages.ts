import type { MarkdownSyntax } from "../markdown/parse-markdown.js";
import type { PrepareResult } from "./prepare-doc.js";

/** Main thread to worker. */
export interface PrepareRequest {
  readonly id: number;
  readonly text: string;
  readonly syntax: MarkdownSyntax;
}

/** Worker to main thread. */
export type WorkerMessage =
  | { readonly type: "ready" }
  | {
      readonly type: "result";
      readonly id: number;
      readonly result: PrepareResult;
    };

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

export function isPrepareRequest(value: unknown): value is PrepareRequest {
  return (
    isRecord(value) &&
    typeof value.id === "number" &&
    typeof value.text === "string" &&
    (value.syntax === "markdown" || value.syntax === "mdx")
  );
}

/** Checks the shape of a message from the worker; the content is not audited. */
export function isWorkerMessage(value: unknown): value is WorkerMessage {
  if (!isRecord(value)) {
    return false;
  }
  if (value.type === "ready") {
    return true;
  }
  if (value.type !== "result" || typeof value.id !== "number") {
    return false;
  }
  const result = value.result;
  return (
    isRecord(result) &&
    (result.kind === "prepared" || result.kind === "skipped")
  );
}
