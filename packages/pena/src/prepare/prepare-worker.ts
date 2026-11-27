import { parentPort, workerData } from "node:worker_threads";
import { createProductNameMatcher } from "../markdown/product-names.js";
import { prepareDoc, type PrepareOptions } from "./prepare-doc.js";
import { isPrepareRequest } from "./worker-messages.js";

function readProductNames(data: unknown): readonly string[] | undefined {
  if (typeof data !== "object" || data === null || !("productNames" in data)) {
    return undefined;
  }
  const names = data.productNames;
  if (!Array.isArray(names)) {
    return undefined;
  }
  return names.filter((name): name is string => typeof name === "string");
}

const port = parentPort;
if (port !== null) {
  const names = readProductNames(workerData);
  const options: PrepareOptions =
    names === undefined
      ? {}
      : { productNames: createProductNameMatcher(names) };
  port.on("message", (message: unknown) => {
    if (!isPrepareRequest(message)) {
      return;
    }
    const result = prepareDoc(message.text, message.syntax, options);
    port.postMessage({ type: "result", id: message.id, result });
  });
  port.postMessage({ type: "ready" });
}
