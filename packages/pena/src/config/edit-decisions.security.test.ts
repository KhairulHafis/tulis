import {
  mkdirSync,
  mkdtempSync,
  readFileSync,
  readdirSync,
  realpathSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { recordDismissal } from "./edit-decisions.js";

const isWindows = process.platform === "win32";
const folders: string[] = [];
const CHECK = "term.sign-in";

function makeFolder(): string {
  const dir = realpathSync.native(mkdtempSync(join(tmpdir(), "tulis-edd-s-")));
  folders.push(dir);
  return dir;
}

afterEach(() => {
  for (const dir of folders.splice(0)) {
    rmSync(dir, { recursive: true, force: true });
  }
});

describe("recordDismissal and links or odd entries", () => {
  it("refuses when .tulis/decisions is a link to a folder outside", async () => {
    const repo = makeFolder();
    const outside = makeFolder();
    mkdirSync(join(repo, ".tulis"));
    symlinkSync(outside, join(repo, ".tulis", "decisions"), "junction");
    const outcome = await recordDismissal(
      repo,
      "amy.yaml",
      CHECK,
      "2026-11-27",
    );
    expect(outcome.status).toBe("refused");
    expect(readdirSync(outside)).toEqual([]);
  });

  it.skipIf(isWindows)(
    "refuses when the file is a link to a file outside",
    async () => {
      const repo = makeFolder();
      const outside = makeFolder();
      const target = join(outside, "target.yaml");
      const original = "version: 1\n";
      writeFileSync(target, original);
      mkdirSync(join(repo, ".tulis", "decisions"), { recursive: true });
      symlinkSync(target, join(repo, ".tulis", "decisions", "amy.yaml"));
      const outcome = await recordDismissal(
        repo,
        "amy.yaml",
        CHECK,
        "2026-11-27",
      );
      expect(outcome.status).toBe("refused");
      expect(readFileSync(target, "utf8")).toBe(original);
      expect(readdirSync(outside)).toEqual(["target.yaml"]);
    },
  );

  it("refuses when the decisions file is a folder", async () => {
    const repo = makeFolder();
    mkdirSync(join(repo, ".tulis", "decisions", "amy.yaml"), {
      recursive: true,
    });
    const outcome = await recordDismissal(
      repo,
      "amy.yaml",
      CHECK,
      "2026-11-27",
    );
    expect(outcome.status).toBe("refused");
    expect(readdirSync(join(repo, ".tulis", "decisions", "amy.yaml"))).toEqual(
      [],
    );
  });
});
