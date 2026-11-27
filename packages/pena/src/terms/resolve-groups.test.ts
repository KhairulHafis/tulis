import { describe, expect, it } from "vitest";
import type { TeamVariants, VariantGroup } from "../config/variants-types.js";
import { resolveVariantGroups } from "./resolve-groups.js";

function syn(
  id: string,
  variants: string[],
  source: "seed" | "team" = "seed",
): VariantGroup {
  return { id, kind: "synonym", variants, source };
}

function team(groups: VariantGroup[], disabled: string[] = []): TeamVariants {
  return { groups, disabled, rejected: [] };
}

const seeds: VariantGroup[] = [
  syn("a", ["a1", "a2"]),
  syn("b", ["b1", "b2"]),
  syn("c", ["c1", "c2"]),
];

describe("resolveVariantGroups", () => {
  it("gives the seeds when the team has nothing", () => {
    const result = resolveVariantGroups(seeds, team([]));
    expect(result.groups).toEqual(seeds);
    expect(result.unmatchedDisabled).toEqual([]);
  });

  it("replaces a seed in place with the team group", () => {
    const mine: VariantGroup = {
      id: "b",
      kind: "verb-noun",
      noun: "login",
      verb: "log in",
      source: "team",
    };
    const result = resolveVariantGroups(seeds, team([mine]));
    expect(result.groups).toEqual([seeds[0], mine, seeds[2]]);
  });

  it("drops a disabled seed", () => {
    const result = resolveVariantGroups(seeds, team([], ["b"]));
    expect(result.groups.map((g) => g.id)).toEqual(["a", "c"]);
    expect(result.unmatchedDisabled).toEqual([]);
  });

  it("puts new team groups after the seeds in file order", () => {
    const x = syn("x", ["x1", "x2"], "team");
    const y = syn("y", ["y1", "y2"], "team");
    const result = resolveVariantGroups(seeds, team([x, y]));
    expect(result.groups.map((g) => g.id)).toEqual(["a", "b", "c", "x", "y"]);
  });

  it("lists disabled ids that match no seed once", () => {
    const result = resolveVariantGroups(
      seeds,
      team([], ["zz", "b", "yy", "zz"]),
    );
    expect(result.unmatchedDisabled).toEqual(["zz", "yy"]);
  });

  it("freezes results and leaves inputs unchanged", () => {
    const seedCopy = [...seeds];
    const t = team([syn("x", ["x1", "x2"], "team")], ["a"]);
    const result = resolveVariantGroups(seeds, t);
    expect(Object.isFrozen(result.groups)).toBe(true);
    expect(Object.isFrozen(result.unmatchedDisabled)).toBe(true);
    expect(seeds).toEqual(seedCopy);
    expect(t.groups).toHaveLength(1);
    expect(t.disabled).toEqual(["a"]);
  });
});
