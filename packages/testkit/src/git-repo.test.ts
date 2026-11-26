import { existsSync, readdirSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { createTestRepo, type TestRepo } from "./git-repo.js";

const repos: TestRepo[] = [];

async function newRepo(branch?: string): Promise<TestRepo> {
  const repo = await createTestRepo(branch === undefined ? {} : { branch });
  repos.push(repo);
  return repo;
}

afterEach(() => {
  for (const repo of repos.splice(0)) {
    repo.cleanup();
  }
});

const T = 30_000;

describe("createTestRepo", () => {
  it(
    "uses the real path and points HEAD at the branch",
    async () => {
      const repo = await newRepo();
      // Git prints forward slashes on Windows; resolve() turns them back.
      const topLevel = await repo.git(["rev-parse", "--show-toplevel"]);
      expect(resolve(topLevel.trim())).toBe(repo.dir);
      expect((await repo.git(["symbolic-ref", "HEAD"])).trim()).toBe(
        "refs/heads/main",
      );
      const other = await newRepo("master");
      expect((await other.git(["symbolic-ref", "HEAD"])).trim()).toBe(
        "refs/heads/master",
      );
    },
    T,
  );
});

describe("config option", () => {
  it(
    "writes repo-local settings",
    async () => {
      const repo = await createTestRepo({
        config: { "core.autocrlf": "true" },
      });
      repos.push(repo);
      expect(
        (await repo.git(["config", "--get", "core.autocrlf"])).trim(),
      ).toBe("true");
    },
    T,
  );

  it("rejects bad keys and values", async () => {
    await expect(createTestRepo({ config: { "-c": "x" } })).rejects.toThrow(
      /Invalid git config key/,
    );
    await expect(createTestRepo({ config: { nodot: "x" } })).rejects.toThrow(
      /nodot/,
    );
    await expect(createTestRepo({ config: { "a.b": "x\ny" } })).rejects.toThrow(
      /Invalid git config value/,
    );
  });
});

describe("commit", () => {
  it(
    "commits, removes files and allows empty commits",
    async () => {
      const repo = await newRepo();
      const sha = await repo.commit({
        message: "one",
        files: { "a.md": "A", "dir/b.md": new Uint8Array([1, 2, 3]) },
      });
      expect(sha).toHaveLength(40);
      const list = async (): Promise<string[]> =>
        (await repo.git(["ls-tree", "-r", "--name-only", "HEAD"]))
          .split("\n")
          .filter((l) => l !== "");
      expect(await list()).toEqual(["a.md", "dir/b.md"]);
      expect([...repo.readFile("dir/b.md")]).toEqual([1, 2, 3]);
      await repo.commit({ message: "two", remove: ["a.md"] });
      expect(await list()).toEqual(["dir/b.md"]);
      const empty = await repo.commit({ message: "empty" });
      expect(empty).toHaveLength(40);
      expect(empty).not.toBe(sha);
    },
    T,
  );

  it(
    "gives reproducible SHAs, author and dates",
    async () => {
      const script = async (repo: TestRepo): Promise<string[]> => [
        await repo.commit({ message: "a", files: { "a.md": "A" } }),
        await repo.commit({ message: "b", files: { "b.md": "B" } }),
      ];
      const first = await script(await newRepo());
      const second = await script(await newRepo());
      expect(first).toEqual(second);

      const repo = await newRepo();
      await script(repo);
      const log = await repo.git([
        "log",
        "--reverse",
        "--format=%an <%ae> %at",
      ]);
      expect(log.trim().split("\n")).toEqual([
        `Tulis Test <test@tulis.invalid> ${String(Date.UTC(2026, 0, 1) / 1000)}`,
        `Tulis Test <test@tulis.invalid> ${String(Date.UTC(2026, 0, 2) / 1000)}`,
      ]);

      const explicit = new Date("2025-05-05T05:05:05Z");
      await repo.commit({ message: "c", date: explicit });
      const at = (await repo.git(["log", "-1", "--format=%at"])).trim();
      expect(at).toBe(String(explicit.getTime() / 1000));
      // The next scripted date is one day after the explicit one.
      await repo.commit({ message: "d" });
      const next = (await repo.git(["log", "-1", "--format=%at"])).trim();
      expect(next).toBe(String(explicit.getTime() / 1000 + 86400));

      // A branch made from the first commit gets 2026-01-02.
      const fresh = await newRepo();
      const base = await fresh.commit({ message: "a" });
      await fresh.createBranch("side", base);
      await fresh.checkout("side");
      await fresh.commit({ message: "s" });
      const onBranch = (await fresh.git(["log", "-1", "--format=%at"])).trim();
      expect(onBranch).toBe(String(Date.UTC(2026, 0, 2) / 1000));
    },
    T,
  );

  it(
    "ignores GIT_* variables in the environment",
    async () => {
      const repo = await newRepo();
      const oldDir = process.env["GIT_DIR"];
      const oldName = process.env["GIT_AUTHOR_NAME"];
      process.env["GIT_DIR"] = join(repo.dir, "bogus-git-dir");
      process.env["GIT_AUTHOR_NAME"] = "Someone Else";
      try {
        await repo.commit({ message: "x", files: { "a.md": "A" } });
        const name = (await repo.git(["log", "-1", "--format=%an"])).trim();
        expect(name).toBe("Tulis Test");
        expect(existsSync(join(repo.dir, ".git"))).toBe(true);
        expect(
          (await repo.git(["ls-tree", "-r", "--name-only", "HEAD"])).trim(),
        ).toBe("a.md");
      } finally {
        if (oldDir === undefined) {
          delete process.env["GIT_DIR"];
        } else {
          process.env["GIT_DIR"] = oldDir;
        }
        if (oldName === undefined) {
          delete process.env["GIT_AUTHOR_NAME"];
        } else {
          process.env["GIT_AUTHOR_NAME"] = oldName;
        }
      }
    },
    T,
  );
});

describe("branches", () => {
  it(
    "creates and checks out a branch",
    async () => {
      const repo = await newRepo();
      await repo.commit({ message: "base", files: { "a.md": "A" } });
      await repo.createBranch("feature");
      expect((await repo.git(["symbolic-ref", "HEAD"])).trim()).toBe(
        "refs/heads/main",
      );
      await repo.checkout("feature");
      await repo.commit({ message: "f", files: { "f.md": "F" } });
      await repo.checkout("main");
      const onMain = await repo.git(["ls-tree", "-r", "--name-only", "HEAD"]);
      expect(onMain.trim()).toBe("a.md");
    },
    T,
  );

  it(
    "rejects names that start with a dash",
    async () => {
      const repo = await newRepo();
      await expect(repo.createBranch("-x")).rejects.toThrow(/-x/);
      await expect(repo.createBranch("ok", "-y")).rejects.toThrow(/-y/);
      await expect(repo.checkout("-z")).rejects.toThrow(/-z/);
    },
    T,
  );
});

describe("path safety", () => {
  it(
    "commits files named like flags",
    async () => {
      const repo = await newRepo();
      await repo.commit({
        message: "flags",
        files: { "--output=x.md": "1", "-rf.md": "2" },
      });
      const list = await repo.git(["ls-tree", "-r", "--name-only", "HEAD"]);
      expect(list.split("\n").filter((l) => l !== "")).toEqual([
        "--output=x.md",
        "-rf.md",
      ]);
    },
    T,
  );

  it(
    "rejects unsafe paths and writes nothing outside dir",
    async () => {
      const repo = await newRepo();
      const bad = [
        "../escape.md",
        "a/../../b.md",
        "/abs.md",
        "C:\\win.md",
        "C:/win.md",
        "a\\b.md",
        "a//b.md",
        "./a.md",
        "a\0b.md",
        "",
      ];
      for (const path of bad) {
        expect(() => {
          repo.writeFile(path, "x");
        }, path).toThrow(/Invalid path/);
        expect(() => repo.readFile(path), path).toThrow(/Invalid path/);
        await expect(
          repo.commit({ message: "m", remove: [path] }),
          path,
        ).rejects.toThrow(/Invalid path/);
      }
      const parent = dirname(repo.dir);
      expect(readdirSync(parent).sort()).toEqual(["home", "repo"]);
      expect(readdirSync(repo.dir)).toEqual([".git"]);
    },
    T,
  );
});

describe("cleanup", () => {
  it(
    "removes the temp folder and is safe to call twice",
    async () => {
      const repo = await newRepo();
      const root = dirname(repo.dir);
      expect(existsSync(root)).toBe(true);
      repo.cleanup();
      expect(existsSync(root)).toBe(false);
      expect(() => {
        repo.cleanup();
      }).not.toThrow();
    },
    T,
  );
});
