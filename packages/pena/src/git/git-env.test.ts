import { describe, expect, it } from "vitest";
import { buildGitEnv } from "./git-env.js";

describe("buildGitEnv", () => {
  it("drops GIT_ variables in any case", () => {
    const result = buildGitEnv({
      GIT_DIR: "/x",
      git_dir: "/y",
      Git_Work_Tree: "/z",
      GIT_CONFIG_PARAMETERS: "'a=b'",
    });
    expect(result["GIT_DIR"]).toBeUndefined();
    expect(result["git_dir"]).toBeUndefined();
    expect(result["Git_Work_Tree"]).toBeUndefined();
    expect(result["GIT_CONFIG_PARAMETERS"]).toBeUndefined();
  });

  it("keeps other variables as spelled", () => {
    const result = buildGitEnv({ PATH: "/bin", HOME: "/h", Path: "C:\\x" });
    expect(result["PATH"]).toBe("/bin");
    expect(result["HOME"]).toBe("/h");
    expect(result["Path"]).toBe("C:\\x");
  });

  it("skips undefined values", () => {
    const result = buildGitEnv({ FOO: undefined });
    expect("FOO" in result).toBe(false);
  });

  it("sets the hardening variables", () => {
    const result = buildGitEnv({});
    expect(result["GIT_TERMINAL_PROMPT"]).toBe("0");
    expect(result["GIT_ALLOW_PROTOCOL"]).toBe("");
    expect(result["GIT_NO_LAZY_FETCH"]).toBe("1");
    expect(result["GIT_OPTIONAL_LOCKS"]).toBe("0");
  });

  it("replaces inherited values", () => {
    const result = buildGitEnv({
      GIT_ALLOW_PROTOCOL: "https",
      GIT_TERMINAL_PROMPT: "1",
    });
    expect(result["GIT_ALLOW_PROTOCOL"]).toBe("");
    expect(result["GIT_TERMINAL_PROMPT"]).toBe("0");
  });

  it("does not mutate the input", () => {
    const input = { GIT_DIR: "/x", PATH: "/bin" };
    const result = buildGitEnv(input);
    expect(input).toEqual({ GIT_DIR: "/x", PATH: "/bin" });
    expect(result).not.toBe(input);
  });
});
