import type { DesignObject } from "../types";
import { norm } from "./ruleEngine";
import { asFieldString } from "./mymindSync";

export type FacetMode = "AND" | "OR";

export type TagFrequency = { tag: string; count: number };
export type TypeFrequency = { type: string; count: number };

const UNKNOWN_TYPE_LABEL = "Unspecified";

/** Most common tags among the given objects, most frequent first. Powers the
 * facet chip bar so it always reflects whatever collection/view is active. */
export function computeTopTags(objects: DesignObject[], limit = 30): TagFrequency[] {
  const counts = new Map<string, number>();
  for (const obj of objects) {
    for (const tag of obj.tags) {
      counts.set(tag, (counts.get(tag) ?? 0) + 1);
    }
  }
  return Array.from(counts.entries())
    .map(([tag, count]) => ({ tag, count }))
    .sort((a, b) => b.count - a.count || a.tag.localeCompare(b.tag))
    .slice(0, limit);
}

/** Distinct mymind entity types (fields.entity_type) present, most frequent
 * first — powers the object-type dropdown. Objects without one (samples, or
 * mymind objects synced before this field existed) bucket under a single
 * "Unspecified" entry rather than disappearing from the count. */
export function computeObjectTypes(objects: DesignObject[]): TypeFrequency[] {
  const counts = new Map<string, number>();
  for (const obj of objects) {
    const type = asFieldString(obj.fields.entity_type) || UNKNOWN_TYPE_LABEL;
    counts.set(type, (counts.get(type) ?? 0) + 1);
  }
  return Array.from(counts.entries())
    .map(([type, count]) => ({ type, count }))
    .sort((a, b) => a.type.localeCompare(b.type));
}

/** Object-type filter only — a dropdown, not part of the free-text query. */
export function applyTypeFilter(objects: DesignObject[], typeFilter: string): DesignObject[] {
  if (typeFilter === "") return objects;
  return objects.filter(
    (obj) => (asFieldString(obj.fields.entity_type) || UNKNOWN_TYPE_LABEL) === typeFilter
  );
}

/** Selected-tag filter only, combined per facetMode. */
export function applyFacetTags(
  objects: DesignObject[],
  facetTags: string[],
  facetMode: FacetMode
): DesignObject[] {
  if (facetTags.length === 0) return objects;
  const wanted = facetTags.map(norm);
  return objects.filter((obj) => {
    const tags = obj.tags.map(norm);
    return facetMode === "AND"
      ? wanted.every((t) => tags.includes(t))
      : wanted.some((t) => tags.includes(t));
  });
}
