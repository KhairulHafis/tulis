import { isCheckId } from "../check-id.js";
import type { Extractor } from "./extractor.js";

export class ExtractorRegistryError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ExtractorRegistryError";
  }
}

export interface ExtractorRegistry {
  readonly extractors: readonly Extractor[];
  get(id: string): Extractor | undefined;
}

function checkBlockKinds(extractor: Extractor): void {
  if (extractor.scope === "document" || extractor.blockKinds === undefined) {
    return;
  }
  if (extractor.blockKinds.length === 0) {
    throw new ExtractorRegistryError(
      "Extractor " + extractor.id + " has an empty blockKinds list.",
    );
  }
  if (new Set(extractor.blockKinds).size !== extractor.blockKinds.length) {
    throw new ExtractorRegistryError(
      "Extractor " + extractor.id + " repeats a block kind.",
    );
  }
}

/**
 * Throws ExtractorRegistryError when an id is not a check ID, an id repeats,
 * or blockKinds is empty or repeats a kind. Keeps the given order.
 */
export function createExtractorRegistry(
  extractors: readonly Extractor[],
): ExtractorRegistry {
  const byId = new Map<string, Extractor>();
  for (const extractor of extractors) {
    if (!isCheckId(extractor.id)) {
      throw new ExtractorRegistryError("An extractor id is not a check ID.");
    }
    if (byId.has(extractor.id)) {
      throw new ExtractorRegistryError(
        "Extractor id " + extractor.id + " is used twice.",
      );
    }
    checkBlockKinds(extractor);
    byId.set(extractor.id, extractor);
  }
  const list = [...extractors];
  return {
    extractors: list,
    get: (id) => byId.get(id),
  };
}
