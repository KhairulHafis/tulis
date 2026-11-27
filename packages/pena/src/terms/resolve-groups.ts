import type { TeamVariants, VariantGroup } from "../config/variants-types.js";

export interface ResolvedGroups {
  /** Frozen. Seeds in seed order (replaced in place by a team group with the same id, dropped when disabled), then new team groups in file order. */
  readonly groups: readonly VariantGroup[];
  /** Disabled ids that match no seed group, in file order, no repeats. For a later typo warning. */
  readonly unmatchedDisabled: readonly string[];
}

export function resolveVariantGroups(
  seeds: readonly VariantGroup[],
  team: TeamVariants,
): ResolvedGroups {
  const seedIds = new Set(seeds.map((group) => group.id));
  const teamById = new Map(team.groups.map((group) => [group.id, group]));
  const disabled = new Set(team.disabled);

  const groups: VariantGroup[] = [];
  for (const seed of seeds) {
    if (disabled.has(seed.id)) {
      continue;
    }
    groups.push(teamById.get(seed.id) ?? seed);
  }
  for (const group of team.groups) {
    if (!seedIds.has(group.id)) {
      groups.push(group);
    }
  }

  const unmatchedDisabled = [
    ...new Set(team.disabled.filter((id) => !seedIds.has(id))),
  ];
  return {
    groups: Object.freeze(groups),
    unmatchedDisabled: Object.freeze(unmatchedDisabled),
  };
}
