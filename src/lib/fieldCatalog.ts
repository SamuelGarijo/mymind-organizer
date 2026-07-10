import type { Collection, DesignObject, FacetField } from "../types";
import { normalizeFacetSchema } from "./facetSchema";

/**
 * Every distinct field (name+type, deduped case-insensitively) ever
 * defined across all manual collections' facet schemas — derived live from
 * the collections that already exist, not a separately stored/maintained
 * catalog. Powers "reuse this field" suggestions when editing a schema,
 * with no risk of drifting from what's actually in use (same principle
 * this app already applies to tag frequency, object types, etc.).
 */
export function getKnownFields(collections: Record<string, Collection>): FacetField[] {
  const byKey = new Map<string, FacetField>();
  for (const c of Object.values(collections)) {
    if (c.type !== "manual") continue;
    for (const field of normalizeFacetSchema(c)) {
      const key = `${field.name.toLowerCase()}::${field.type}`;
      const existing = byKey.get(key);
      if (!existing) {
        byKey.set(key, field);
      } else if (field.type === "select" && field.options?.length) {
        // A later collection reusing the same field name should see every
        // option anyone's ever used for it, not just whichever collection
        // happened to define it first.
        const options = Array.from(new Set([...(existing.options ?? []), ...field.options]));
        byKey.set(key, { ...existing, options });
      }
    }
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
      if (key.toLowerCase() === target && value) values.add(value);
    }
  }
  return Array.from(values).sort();
}
