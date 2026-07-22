import { CURATED_ROLE_FIELDS } from "./curatedRoleFields";
import { norm } from "./textNorm";
import type { Collection, RoleDefinition } from "../types";

/**
 * What counts as a real KIND, not a tag-derived species (Samuel,
 * 2026-07-22). The deleted "discover kinds" feature minted empty roles from
 * frequent tags — sign, facade, hungary, 1970s — and those must never
 * surface as entity tabs, "Here you can find" rows, or the auto-picked
 * thing Classify groups by. Choosing the dominant `.role` for "All objects"
 * is exactly how a Typography collection ended up "Classifying SIGN by
 * Style".
 *
 * A role is a real kind if it was consciously established, by any of:
 *   - it's in the curated catalog (CURATED_ROLE_FIELDS), or
 *   - it carries a property package (fields), or
 *   - it has pinned facets, or
 *   - it's declared on some collection's entityTypes.
 * An empty role that only ever came from a tag is none of these.
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

export function isRealKind(role: RoleDefinition | undefined, declared: Set<string>): boolean {
  if (!role) return false;
  const key = norm(role.name);
  return (
    key in CURATED_ROLE_FIELDS ||
    role.fields.length > 0 ||
    (role.primaryFacets?.length ?? 0) > 0 ||
    declared.has(key)
  );
}

/** The set of role keys that are real kinds — the one filter every surface
 * (entity nav, "Here you can find", active-role resolution) applies so junk
 * roles stay out of all of them. */
export function realKindKeys(
  roles: Record<string, RoleDefinition>,
  collections: Record<string, Collection>
): Set<string> {
  const declared = declaredKindKeys(collections);
  const set = new Set<string>();
  for (const [key, role] of Object.entries(roles)) {
    if (isRealKind(role, declared)) set.add(key);
  }
  // A declared kind may not have a role definition yet (freshly picked in
  // the wizard) — still legitimately a kind.
  for (const key of declared) set.add(key);
  return set;
}
