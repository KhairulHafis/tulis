import { existsSync, rmSync } from "node:fs";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import {
  checkConfig,
  checkRefName,
  makeTempRoot,
  openTestRepo,
  type TestRepo,
} from "./git-repo.js";
import { runGit } from "./run-git.js";

export interface CloneTestRepoOptions {
  /** Shallow clone with this many commits (git clone --depth). Integer, 1 or more. */
  readonly depth?: number;
  /** Partial clone that skips file contents until needed (--filter=blob:none). */
  readonly partial?: boolean;
  /** Branch to check out (--branch). Default: the source's HEAD branch. */
  readonly branch?: string;
  /** Repo-local git settings for the clone, applied before checkout (git clone -c key=value), for example { "core.autocrlf": "true" }. */
  readonly config?: Readonly<Record<string, string>>;
}

/** Clones `source` into a new temp folder of its own (with its own home folder, like createTestRepo). The result's cleanup() deletes only the clone. */
export async function cloneTestRepo(
  source: TestRepo,
  options: CloneTestRepoOptions = {},
): Promise<TestRepo> {
  const { depth, partial, branch } = options;
  const config = options.config ?? {};
  if (depth !== undefined && (!Number.isInteger(depth) || depth < 1)) {
    throw new Error(`Invalid clone depth "${String(depth)}"`);
  }
  if (branch !== undefined) {
    checkRefName(branch);
  }
  checkConfig(config);

  // The source must allow filters or git sends every blob.
  if (partial === true) {
    await source.git(["config", "uploadpack.allowFilter", "true"]);
  }

  const args = ["clone", "-q"];
  if (depth !== undefined) {
    args.push("--depth", String(depth));
  }
  if (partial === true) {
    args.push("--filter=blob:none");
  }
  if (branch !== undefined) {
    args.push("--branch", branch);
  }
  for (const [key, value] of Object.entries(config)) {
    args.push("-c", `${key}=${value}`);
  }

  const { root, sandbox } = makeTempRoot();
  const dir = join(root, "repo");
  try {
    const url = pathToFileURL(source.dir).href;
    await runGit([...args, "--", url, dir], root, sandbox);
    return openTestRepo(root, dir, sandbox);
  } catch (error) {
    if (existsSync(root)) {
      rmSync(root, { recursive: true, force: true });
    }
    throw error;
  }
}
