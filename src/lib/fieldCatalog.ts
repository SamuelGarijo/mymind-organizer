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
