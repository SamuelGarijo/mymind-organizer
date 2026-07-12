import type { DesignObject, FacetField } from "../types";

/** Sentinel group-by key for the object's item type (`object.role`, issue
 * #84) — deliberately not a valid field name, so it can never collide with
 * a real facet field called "role" or "Item type". Shared by Table (#85)
 * and Grid (#98) so both group identically. */
export const ITEM_TYPE_GROUP = "__item_type__";

/** Bucket label for objects with no value for the grouped field. */
export const UNGROUPED_LABEL = "—";

export type ObjectGroup = { label: string; objects: DesignObject[] };

/**
 * Partitions objects by their value for `groupByField` (or by item type,
 * for the ITEM_TYPE_GROUP sentinel), preserving each object's existing
 * relative order within its group (the caller's list is already
 * recency-sorted). Groups are ordered by the field's own defined `options`
 * order when known, alphabetical otherwise. Originally Table-only (#85),
 * extracted here so Grid's mosaic grouping (#98) partitions/orders exactly
 * the same way instead of drifting into its own logic over time.
 */
export function groupObjects(
  objects: DesignObject[],
  groupByField: string,
  facetColumns: FacetField[]
): ObjectGroup[] {
  const groups = new Map<string, DesignObject[]>();
  const addToGroup = (label: string, object: DesignObject) => {
    (groups.get(label) ?? groups.set(label, []).get(label)!).push(object);
  };
  for (const object of objects) {
    const raw = groupByField === ITEM_TYPE_GROUP ? object.role : object.fields[groupByField];
    if (Array.isArray(raw)) {
      // Multi-select (issue #99): an object with several values shows up
      // under each of its groups — same multi-membership every other
      // tag-like grouping in this app already has, not confined to one.
      if (raw.length === 0) addToGroup(UNGROUPED_LABEL, object);
      else for (const value of raw) addToGroup(value, object);
    } else {
      addToGroup(raw || UNGROUPED_LABEL, object);
    }
  }

  const definedOrder = facetColumns.find((f) => f.name === groupByField)?.options ?? [];
  const labels = Array.from(groups.keys()).sort((a, b) => {
    const ai = definedOrder.indexOf(a);
    const bi = definedOrder.indexOf(b);
    if (ai !== -1 && bi !== -1) return ai - bi;
    if (ai !== -1) return -1;
    if (bi !== -1) return 1;
    return a.localeCompare(b);
  });

  return labels.map((label) => ({ label, objects: groups.get(label)! }));
}

/** Sentinel sort-field key for the object's own title — same reasoning as
 * ITEM_TYPE_GROUP, so it can't collide with a real field called "title". */
export const SORT_BY_TITLE = "__title__";

export type SortRule = { field: string; direction: "asc" | "desc" };

function sortableValue(object: DesignObject, field: string): string {
  const raw = field === SORT_BY_TITLE ? object.title : object.fields[field];
  return Array.isArray(raw) ? raw.join(", ") : raw ?? "";
}

/**
 * Multi-sort (issue #119's own ask — sort by one field, then a tiebreaker):
 * applies rules in priority order, first rule wins unless it ties, then
 * falls through to the next. A stable sort (Array.prototype.sort is
 * guaranteed stable since ES2019), so ties beyond the last rule keep
 * whatever order the caller already had (recency, by default) rather than
 * shuffling arbitrarily.
 */
export function sortObjects(objects: DesignObject[], rules: SortRule[]): DesignObject[] {
  if (rules.length === 0) return objects;
  return [...objects].sort((a, b) => {
    for (const { field, direction } of rules) {
      const cmp = sortableValue(a, field).localeCompare(sortableValue(b, field));
      if (cmp !== 0) return direction === "asc" ? cmp : -cmp;
    }
    return 0;
  });
}

/**
 * Facet columns worth offering as a "Group by" option, most impactful
 * first — a field nobody has actually set a value for yet produces one
 * giant "—" bucket, which isn't a grouping at all, so it's dropped rather
 * than cluttering the list with no-op choices. "Impact" here is just
 * coverage: how many of the given objects hold a non-empty value for that
 * field, since that's what determines how much the grouping actually splits
 * the pool up.
 */
export function rankableFacetColumns(
  objects: DesignObject[],
  facetColumns: FacetField[]
): FacetField[] {
  return facetColumns
    .map((field) => {
      const coverage = objects.reduce((count, object) => {
        const raw = object.fields[field.name];
        const hasValue = Array.isArray(raw) ? raw.length > 0 : Boolean(raw);
        return hasValue ? count + 1 : count;
      }, 0);
      return { field, coverage };
    })
    .filter(({ coverage }) => coverage > 0)
    .sort((a, b) => b.coverage - a.coverage)
    .map(({ field }) => field);
}
