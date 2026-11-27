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
import { addConfirmedGroup, addRejectedGroup } from "./edit-variants.js";
import { loadVariants } from "./load-variants.js";

const isWindows = process.platform === "win32";
const folders: string[] = [];

function makeFolder(): string {
  const dir = realpathSync.native(mkdtempSync(join(tmpdir(), "tulis-edit-s-")));
  folders.push(dir);
  return dir;
}

afterEach(() => {
  for (const dir of folders.splice(0)) {
    rmSync(dir, { recursive: true, force: true });
  }
});

const GROUP = {
  id: "click-select",
  kind: "synonym",
  variants: ["click", "select"],
} as const;

describe("links that point outside the repo", () => {
  it("refuses when .tulis is a link to a folder outside", async () => {
    const repo = makeFolder();
    const outside = makeFolder();
    symlinkSync(outside, join(repo, ".tulis"), "junction");

    const outcome = await addConfirmedGroup(repo, GROUP);
    expect(outcome.status).toBe("refused");
    expect((await addRejectedGroup(repo, ["a", "b"])).status).toBe("refused");
    expect(readdirSync(outside)).toEqual([]);
  });

  it("refuses when .tulis is a link and the outside folder has a file", async () => {
    const repo = makeFolder();
    const outside = makeFolder();
    const original = "version: 1\ngroups: []\n";
    writeFileSync(join(outside, "variants.yaml"), original);
    symlinkSync(outside, join(repo, ".tulis"), "junction");

    expect((await addConfirmedGroup(repo, GROUP)).status).toBe("refused");
    expect(readFileSync(join(outside, "variants.yaml"), "utf8")).toBe(original);
    expect(readdirSync(outside)).toEqual(["variants.yaml"]);
  });

  it.skipIf(isWindows)(
    "refuses when variants.yaml is a link to a file outside",
    async () => {
      const repo = makeFolder();
      const outside = makeFolder();
      const target = join(outside, "other.yaml");
      const original = "version: 1\ngroups: []\n";
      writeFileSync(target, original);
      mkdirSync(join(repo, ".tulis"));
      symlinkSync(target, join(repo, ".tulis", "variants.yaml"));

      const outcome = await addConfirmedGroup(repo, GROUP);
      expect(outcome.status).toBe("refused");
      expect(readFileSync(target, "utf8")).toBe(original);
      expect(readdirSync(outside)).toEqual(["other.yaml"]);
    },
  );
});

const YAML_LOOKING_WORDS = [
  "a: b",
  "- x",
  "# not a comment",
  "]",
  "&anchor",
  "*alias",
  "!!binary",
];

describe("words that look like YAML", () => {
  for (const word of YAML_LOOKING_WORDS) {
    it(`round-trips ${JSON.stringify(word)} as a plain string`, async () => {
      const repo = makeFolder();
      expect(
        await addConfirmedGroup(repo, {
          id: "tricky",
          kind: "synonym",
          variants: [word, "plain"],
        }),
      ).toEqual({ status: "written" });
      expect(await addRejectedGroup(repo, [word, "plain"])).toEqual({
        status: "written",
      });

      const loaded = await loadVariants(repo);
      expect(loaded.warnings).toEqual([]);
      expect(loaded.variants.groups).toEqual([
        {
          id: "tricky",
          kind: "synonym",
          variants: [word, "plain"],
          source: "discovered",
        },
      ]);
      expect(loaded.variants.rejected).toEqual([{ variants: [word, "plain"] }]);
    });

    it(`control: ${JSON.stringify(word)} written unquoted by hand does not read back`, async () => {
      const repo = makeFolder();
      mkdirSync(join(repo, ".tulis"));
      writeFileSync(
        join(repo, ".tulis", "variants.yaml"),
        `version: 1\ngroups:\n  - id: tricky\n    kind: synonym\n    variants: [${word}, plain]\n`,
      );
      let words: readonly string[] | undefined;
      try {
        const loaded = await loadVariants(repo);
        const group = loaded.variants.groups[0];
        words =
          group !== undefined && group.kind === "synonym"
            ? group.variants
            : undefined;
      } catch {
        words = undefined;
      }
      expect(words).not.toEqual([word, "plain"]);
    });
  }
});
