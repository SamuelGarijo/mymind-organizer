import type { DesignObject } from "../types";
import { norm } from "./ruleEngine";
import { asFieldString } from "./mymindSync";
import { resolveTagOrigin } from "./tagOrigin";

export type FacetFieldFilter = { field: string; value: string };

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

/** Curated Piles (user-created tags only, most frequent first) — same shape
 * and sort as computeTopTags, filtered to tags lib/tagOrigin.ts resolves as
 * "user" so mymind/AI-sourced tags never show up as a pile. `localUserTags`
 * is the store's own record of which tags were added by hand here. */
export function computeCuratedPiles(
  objects: DesignObject[],
  localUserTags: Record<string, string[]>
): TagFrequency[] {
  const counts = new Map<string, number>();
  for (const obj of objects) {
    for (const tag of obj.tags) {
      if (resolveTagOrigin(obj, tag, localUserTags[obj.id]) !== "user") continue;
      counts.set(tag, (counts.get(tag) ?? 0) + 1);
    }
  }
  return Array.from(counts.entries())
    .map(([tag, count]) => ({ tag, count }))
    .sort((a, b) => b.count - a.count || a.tag.localeCompare(b.tag));
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

const UNSPECIFIED_ROLE_LABEL = "Unspecified";

/** Distinct item-types/roles (object.role) present, most frequent first —
 * powers the role filter dropdown, independent of mymind's own entity_type. */
export function computeRoleFrequency(objects: DesignObject[]): TypeFrequency[] {
  const counts = new Map<string, number>();
  for (const obj of objects) {
    const role = obj.role || UNSPECIFIED_ROLE_LABEL;
    counts.set(role, (counts.get(role) ?? 0) + 1);
  }
  return Array.from(counts.entries())
    .map(([type, count]) => ({ type, count }))
    .sort((a, b) => a.type.localeCompare(b.type));
}

/** Item-type/role filter only — separate dropdown from the mymind
 * entity_type filter above, since a role can span several entity_types. */
export function applyRoleFilter(objects: DesignObject[], roleFilter: string): DesignObject[] {
  if (roleFilter === "") return objects;
  return objects.filter((obj) => (obj.role || UNSPECIFIED_ROLE_LABEL) === roleFilter);
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

/** Substring tag search, not capped at computeTopTags' top-30 — lets the
 * filter-condition picker find a tag to include/exclude even when it's not
 * frequent enough to appear in the always-visible suggestion strip. */
export function searchTags(objects: DesignObject[], query: string, limit = 20): TagFrequency[] {
  const q = norm(query);
  if (!q) return [];
  const counts = new Map<string, number>();
  for (const obj of objects) {
    for (const tag of obj.tags) {
      if (norm(tag).includes(q)) counts.set(tag, (counts.get(tag) ?? 0) + 1);
    }
  }
  return Array.from(counts.entries())
    .map(([tag, count]) => ({ tag, count }))
    .sort((a, b) => b.count - a.count || a.tag.localeCompare(b.tag))
    .slice(0, limit);
}

/** Drops any object carrying one of the excluded tags — independent of (and
 * combined with, via AND) the include-tag facet filter above. */
export function applyExcludedTags(
  objects: DesignObject[],
  excludedTags: string[]
): DesignObject[] {
  if (excludedTags.length === 0) return objects;
  const excluded = excludedTags.map(norm);
  return objects.filter((obj) => {
    const tags = obj.tags.map(norm);
    return !excluded.some((t) => tags.includes(t));
  });
}

/** Facet/role field value filter — same array-or-single convention as
 * ruleEngine's custom-field matching, so a multi-select field matches if the
 * value is anywhere in it. */
export function applyFacetFieldFilter(
  objects: DesignObject[],
  filter: FacetFieldFilter | null
): DesignObject[] {
  if (!filter) return objects;
  const wanted = norm(filter.value);
  return objects.filter((obj) => {
    const raw = obj.fields[filter.field];
    const fieldValues = (Array.isArray(raw) ? raw : [raw ?? ""]).map(norm);
    return fieldValues.includes(wanted);
  });
}

/** Distinct values for one facet field among the given objects, most
 * frequent first — powers the field-value dropdown once a field is picked. */
export function computeFieldValueFrequency(
  objects: DesignObject[],
  field: string
): TagFrequency[] {
  const counts = new Map<string, number>();
  for (const obj of objects) {
    const raw = obj.fields[field];
    const values = Array.isArray(raw) ? raw : [raw ?? ""];
    for (const value of values) {
      if (!value) continue;
      counts.set(value, (counts.get(value) ?? 0) + 1);
    }
  }
  return Array.from(counts.entries())
    .map(([tag, count]) => ({ tag, count }))
    .sort((a, b) => b.count - a.count || a.tag.localeCompare(b.tag));
}
