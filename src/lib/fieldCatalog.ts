import type { Collection, DesignObject, FacetField, RoleDefinition } from "../types";
import { normalizeFacetSchema } from "./facetSchema";

/**
 * Every distinct field (name+type, deduped case-insensitively) ever
 * defined across all role field packages — plus legacy pre-#84 collection
 * schemas, kept purely as a suggestion source — derived live from what
 * already exists, not a separately stored/maintained catalog. Powers
 * "reuse this field" suggestions when editing a role's fields, with no
 * risk of drifting from what's actually in use (same principle this app
 * already applies to tag frequency, object types, etc.).
 */
export function getKnownFields(
  collections: Record<string, Collection>,
  roles: Record<string, RoleDefinition> = {}
): FacetField[] {
  const byKey = new Map<string, FacetField>();
  const absorb = (field: FacetField) => {
    const key = `${field.name.toLowerCase()}::${field.type}`;
    const existing = byKey.get(key);
    if (!existing) {
      byKey.set(key, field);
    } else if (field.type === "select" && field.options?.length) {
      // A later definition reusing the same field name should see every
      // option anyone's ever used for it, not just whichever definition
      // happened to introduce it first.
      const options = Array.from(new Set([...(existing.options ?? []), ...field.options]));
      byKey.set(key, { ...existing, options });
    }
  };
  for (const def of Object.values(roles)) for (const field of def.fields) absorb(field);
  for (const c of Object.values(collections)) {
    if (c.type !== "manual") continue;
    for (const field of normalizeFacetSchema(c)) absorb(field);
  }
  return Array.from(byKey.values());
}

/**
 * Every distinct value any object has ever had for a given field name —
 * derived from the objects themselves, same principle as getKnownFields.
 * Case-insensitive match on the field name, since facet field names aren't
 * guaranteed consistent casing across collections.
 */
export function getKnownValuesForField(
  objects: Record<string, DesignObject>,
  fieldName: string
): string[] {
  const target = fieldName.toLowerCase();
  const values = new Set<string>();
  for (const obj of Object.values(objects)) {
    for (const [key, value] of Object.entries(obj.fields)) {
      if (key.toLowerCase() !== target) continue;
      if (Array.isArray(value)) {
        for (const one of value) values.add(one);
      } else if (value) {
        values.add(value);
      }
    }
  }
  return Array.from(values).sort();
}

import { norm } from "./textNorm";

/**
 * The fields a collection SHOWS for a given role — the read side of the
 * per-collection field view (the "what's in your mind" redesign,
 * 2026-07-22).
 *
 * One rule, applied everywhere the collection view and Classify need to
 * know which properties to render, so there is a single definition of
 * "what does this collection show for this kind":
 *
 *   - A `fieldViews[roleKey]` entry → its `shown` list, in that exact
 *     order, resolved back to the role's real FacetField objects (a name
 *     with no matching field drops out). An empty `shown` is honoured:
 *     the collection chose to show none.
 *   - No entry → the role's own default: its pinned primaryFacets first,
 *     then any remaining fields. Uncustomised collections behave exactly
 *     as they did before this feature existed.
 */
export function resolveCollectionFields(
  collection: Collection | undefined,
  role: RoleDefinition | undefined
): FacetField[] {
  if (!role) return [];
  const byName = new Map(role.fields.map((f) => [norm(f.name), f]));
  const view = collection?.fieldViews?.[norm(role.name)];

  if (view) {
    return view.shown
      .map((name) => byName.get(norm(name)))
      .filter((f): f is FacetField => Boolean(f));
  }

  // Default: pinned facets first (in their pin order), then the rest.
  const pinned = (role.primaryFacets ?? [])
    .map((name) => byName.get(norm(name)))
    .filter((f): f is FacetField => Boolean(f));
  const pinnedKeys = new Set(pinned.map((f) => norm(f.name)));
  const rest = role.fields.filter((f) => !pinnedKeys.has(norm(f.name)));
  return [...pinned, ...rest];
}
