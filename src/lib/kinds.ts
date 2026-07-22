import { CURATED_ROLE_FIELDS } from "./curatedRoleFields";
import { norm } from "./textNorm";
import type { Collection, DesignObject, RoleDefinition } from "../types";

/**
 * What counts as a real KIND — rewritten 2026-07-22 after the first
 * definition was found to be built on poisoned evidence.
 *
 * The first version accepted "has fields" or "has pinned facets" as proof a
 * role was a real kind. Samuel's own archive disproved it: fourteen roles —
 * historical, 1970s, hungarian, budapest, facade, sign, hungary… — each had
 * exactly one field and one pin, and 1,464 objects between them. They all
 * carried the same fingerprint: a single pinned `Style` select whose options
 * are scraped tags. That is the literal output of the deleted
 * `discoverEntityTypes` (its `deriveStyleOptions` lift scoring), plus
 * `AddPropertyPopover` writing onto whatever junk role Classify had
 * auto-picked. So "has fields" was evidence manufactured by two bugs, not
 * evidence of intent.
 *
 * The definition is now intent, and only intent. A role is a real kind iff:
 *   - it's in the curated catalog (CURATED_ROLE_FIELDS), or
 *   - it's declared on some collection's entityTypes (picked in the wizard), or
 *   - the user explicitly established it (typed it by hand).
 * Nothing a machine created on its own qualifies.
 */

/** Role keys declared as entityTypes on any collection — a conscious "this
 * is a kind" signal that outlives an empty definition. */
export function declaredKindKeys(collections: Record<string, Collection>): Set<string> {
  const set = new Set<string>();
  for (const c of Object.values(collections)) {
    for (const k of c.entityTypes ?? []) set.add(norm(k));
  }
  return set;
}

export function isRealKind(
  role: RoleDefinition | undefined,
  declared: Set<string>,
  established: Set<string>
): boolean {
  if (!role) return false;
  const key = norm(role.name);
  return key in CURATED_ROLE_FIELDS || declared.has(key) || established.has(key);
}

/** The set of role keys that are real kinds — the one filter every surface
 * (entity nav, wizard palette, active-role resolution) applies, so junk can't
 * leak into one place after being cleaned out of another. */
export function realKindKeys(
  roles: Record<string, RoleDefinition>,
  collections: Record<string, Collection>,
  establishedKinds: readonly string[] = []
): Set<string> {
  const declared = declaredKindKeys(collections);
  const established = new Set(establishedKinds.map((k) => norm(k)));
  const set = new Set<string>();
  for (const [key, role] of Object.entries(roles)) {
    if (isRealKind(role, declared, established)) set.add(key);
  }
  // A kind can be real before it has a definition — freshly picked in the
  // wizard, or established by hand.
  for (const key of declared) set.add(key);
  for (const key of established) set.add(key);
  return set;
}

/**
 * The fingerprint of a role minted by the deleted "discover kinds" feature:
 * its ONLY field is a pinned `Style` select whose options were scraped from
 * tags. Used to explain a purge candidate in the UI — "this came from the
 * old auto-discovery" is a far better reason to show someone than "this
 * isn't in a list".
 */
export function looksAutoDiscovered(role: RoleDefinition): boolean {
  if (role.fields.length !== 1) return false;
  const [field] = role.fields;
  return norm(field.name) === "style" && (role.primaryFacets ?? []).length === 1;
}

export type PurgeCandidate = {
  key: string;
  name: string;
  /** How many objects currently claim to BE this. */
  count: number;
  /** True when it carries the auto-discovery fingerprint. */
  autoDiscovered: boolean;
};

/**
 * Roles that are not real kinds, with how many objects they've typed —
 * everything a cleanup would remove, listed so it can be shown before
 * anything happens.
 */
export function purgeCandidates(
  roles: Record<string, RoleDefinition>,
  collections: Record<string, Collection>,
  establishedKinds: readonly string[],
  objects: Record<string, DesignObject>
): PurgeCandidate[] {
  const real = realKindKeys(roles, collections, establishedKinds);
  const counts = new Map<string, number>();
  for (const o of Object.values(objects)) {
    if (!o.role) continue;
    const key = norm(o.role);
    counts.set(key, (counts.get(key) ?? 0) + 1);
  }
  return Object.entries(roles)
    .filter(([key]) => !real.has(key))
    .map(([key, role]) => ({
      key,
      name: role.name,
      count: counts.get(key) ?? 0,
      autoDiscovered: looksAutoDiscovered(role),
    }))
    .sort((a, b) => b.count - a.count);
}
