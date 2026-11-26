import { execFile } from "node:child_process";
import { join } from "node:path";

/** Settings every helper git call uses. */
export interface GitSandbox {
  /** Empty folder used as HOME, so no user git config is read. */
  readonly homeDir: string;
  /** Folder git must never search above (GIT_CEILING_DIRECTORIES). */
  readonly ceilingDir: string;
}

/** Fixed identity for every commit made by the helper. */
export const TEST_AUTHOR_NAME = "Tulis Test";
export const TEST_AUTHOR_EMAIL = "test@tulis.invalid";

/** Copy of `env` with every GIT_* variable (any case) removed, plus the sandbox variables. */
export function buildSandboxEnv(
  env: NodeJS.ProcessEnv,
  sandbox: GitSandbox,
  date?: Date,
): NodeJS.ProcessEnv {
  const result: NodeJS.ProcessEnv = {};
  for (const [key, value] of Object.entries(env)) {
    if (!key.toUpperCase().startsWith("GIT_")) {
      result[key] = value;
    }
  }
  result["HOME"] = sandbox.homeDir;
  result["USERPROFILE"] = sandbox.homeDir;
  result["XDG_CONFIG_HOME"] = sandbox.homeDir;
  result["GIT_CONFIG_NOSYSTEM"] = "1";
  result["GIT_CONFIG_GLOBAL"] = join(sandbox.homeDir, ".gitconfig");
  result["GIT_CEILING_DIRECTORIES"] = sandbox.ceilingDir;
  result["GIT_TERMINAL_PROMPT"] = "0";
  result["GIT_AUTHOR_NAME"] = TEST_AUTHOR_NAME;
  result["GIT_COMMITTER_NAME"] = TEST_AUTHOR_NAME;
  result["GIT_AUTHOR_EMAIL"] = TEST_AUTHOR_EMAIL;
  result["GIT_COMMITTER_EMAIL"] = TEST_AUTHOR_EMAIL;
  if (date !== undefined) {
    const stamp = `${String(Math.floor(date.getTime() / 1000))} +0000`;
    result["GIT_AUTHOR_DATE"] = stamp;
    result["GIT_COMMITTER_DATE"] = stamp;
  }
  return result;
}

/** Flags placed before the caller's args on every call. Extend the list here. */
export function buildSandboxArgs(args: readonly string[]): string[] {
  return [
    "--no-pager",
    "-c",
    "core.fsmonitor=false",
    "-c",
    "commit.gpgsign=false",
    "-c",
    "protocol.allow=never",
    "-c",
    "protocol.file.allow=always",
    ...args,
  ];
}

/** Runs git in `cwd`, resolves with stdout. */
export function runGit(
  args: readonly string[],
  cwd: string,
  sandbox: GitSandbox,
  date?: Date,
): Promise<string> {
  return new Promise((resolve, reject) => {
    execFile(
      "git",
      buildSandboxArgs(args),
      {
        cwd,
        env: buildSandboxEnv(process.env, sandbox, date),
        timeout: 30_000,
        maxBuffer: 64 * 1024 * 1024,
        windowsHide: true,
      },
      (error, stdout, stderr) => {
        if (error) {
          const command = args.join(" ");
          reject(
            new Error(`git ${command} failed in ${cwd}: ${stderr.trim()}`, {
              cause: error,
            }),
          );
          return;
        }
        resolve(stdout);
      },
    );
  });
}
