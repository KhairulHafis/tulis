import type { TulisConfig } from "../config/config-types.js";
import type { FrontmatterData } from "../markdown/frontmatter-data.js";
import { compileGlob } from "../globs/glob.js";
import type { CompiledGlob } from "../globs/glob.js";
import { isDocTypeName } from "./doc-type-name.js";

export type DocType =
  | { readonly from: "frontmatter"; readonly type: string }
  | { readonly from: "rule"; readonly type: string; readonly rule: number }
  | { readonly from: "folder"; readonly type: string }
  | { readonly from: "none" };

export interface DocTypeResolver {
  resolve(path: string, frontmatter: FrontmatterData | undefined): DocType;
}

const NONE: DocType = Object.freeze({ from: "none" });

/**
 * Compiles every pattern once. Throws GlobError if a pattern is unsupported
 * (config checking normally stops that first).
 *
 * A doc's type comes from, in order: its frontmatter field, the first rule
 * with a matching pattern, the first folder under the docs root, or none.
 */
export function createDocTypeResolver(
  config: Pick<TulisConfig, "include" | "docTypes">,
): DocTypeResolver {
  const frontmatterKey = config.docTypes.frontmatterKey;
  const rules = config.docTypes.rules.map((rule) => ({
    type: rule.type,
    globs: rule.include.map((glob) => compileGlob(glob)),
  }));
  const includes: readonly CompiledGlob[] = config.include.map((glob) =>
    compileGlob(glob),
  );

  return {
    resolve(path, frontmatter) {
      if (frontmatterKey !== undefined && frontmatter !== undefined) {
        const value = frontmatter.fields.get(frontmatterKey)?.trim();
        if (value !== undefined && isDocTypeName(value)) {
          return Object.freeze({ from: "frontmatter", type: value });
        }
      }

      for (let index = 0; index < rules.length; index += 1) {
        const rule = rules[index];
        if (rule?.globs.some((glob) => glob.matches(path)) === true) {
          return Object.freeze({
            from: "rule",
            type: rule.type,
            rule: index,
          });
        }
      }

      // The first include pattern that matches gives the docs root.
      const root = includes.find((glob) => glob.matches(path));
      if (root === undefined || !path.startsWith(root.base)) {
        return NONE;
      }
      const rest = path.slice(root.base.length);
      const slash = rest.indexOf("/");
      if (slash <= 0) {
        return NONE;
      }
      return Object.freeze({ from: "folder", type: rest.slice(0, slash) });
    },
  };
}
