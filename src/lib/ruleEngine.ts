import type {
  DesignObject,
  FilterCondition,
  FilterGroup,
  SmartCollection,
  TagGroups,
} from "../types";

export const GROUP_FIELD_PREFIX = "group:";

export function groupField(groupName: string): string {
  return `${GROUP_FIELD_PREFIX}${groupName}`;
}

export function isGroupField(field: string): boolean {
  return field.startsWith(GROUP_FIELD_PREFIX);
}

export function groupNameFromField(field: string): string {
  return field.slice(GROUP_FIELD_PREFIX.length);
}

export function norm(s: string): string {
  return s.trim().toLowerCase();
}

export function searchableText(obj: DesignObject): string {
  const fieldValues = Object.values(obj.fields).flatMap((v) => (Array.isArray(v) ? v : [v]));
  return [obj.title, obj.tags.join(" "), fieldValues.join(" ")].join(" ").toLowerCase();
}

/** Every field a condition could target on this object that actually holds
 * this value: "tag" (any tag, regardless of group), "group:<name>" for each
 * group that tag belongs to, plus any custom field key. Used to help the
 * smart collection builder explain "0 matches" by pointing at where a value
 * actually lives. */
export function fieldsContainingValue(
  obj: DesignObject,
  value: string,
  tagGroups: TagGroups
): string[] {
  const v = norm(value);
  if (v === "") return [];
  const hits: string[] = [];

  const matchingTags = obj.tags.filter((t) => norm(t) === v);
  if (matchingTags.length > 0) {
    hits.push("tag");
    const groupsHit = new Set<string>();
    for (const t of matchingTags) {
      const g = tagGroups[norm(t)];
      if (g) groupsHit.add(g);
    }
    for (const g of groupsHit) hits.push(groupField(g));
  }

  for (const [key, val] of Object.entries(obj.fields)) {
    const values = Array.isArray(val) ? val : [val];
    if (values.some((one) => norm(one) === v)) hits.push(key);
  }
  return hits;
}

export function evaluateCondition(
  condition: FilterCondition,
  obj: DesignObject,
  tagGroups: TagGroups
): boolean {
  const value = norm(condition.value);
  if (value === "") return true;

  if (condition.field === "text") {
    return searchableText(obj).includes(value);
  }

  if (condition.field === "tag" || isGroupField(condition.field)) {
    const relevantTags = isGroupField(condition.field)
      ? obj.tags.filter((t) => tagGroups[norm(t)] === groupNameFromField(condition.field))
      : obj.tags;
    const tags = relevantTags.map(norm);
    switch (condition.operator) {
      case "includes":
        return tags.includes(value);
      case "contains":
        return tags.some((t) => t.includes(value));
      case "notEquals":
        return !tags.includes(value);
      default:
        return tags.includes(value);
    }
  }

  // Custom field (arbitrary key/value metadata, unrelated to tags) — a
  // multi-select field's value is an array (issue #99); treat a single
  // string the same way a select/date field always has, as a one-element
  // list, so every operator below checks "any held value" either way.
  const raw = obj.fields[condition.field];
  const fieldValues = (Array.isArray(raw) ? raw : [raw ?? ""]).map(norm);
  switch (condition.operator) {
    case "equals":
      return fieldValues.includes(value);
    case "notEquals":
      return !fieldValues.includes(value);
    case "contains":
      return fieldValues.some((v) => v.includes(value));
    case "includes":
      return fieldValues.includes(value);
    default:
      return fieldValues.includes(value);
  }
}

export function evaluateGroup(
  group: FilterGroup,
  obj: DesignObject,
  tagGroups: TagGroups
): boolean {
  if (group.children.length === 0) return true;
  const results = group.children.map((child) =>
    child.kind === "group"
      ? evaluateGroup(child, obj, tagGroups)
      : evaluateCondition(child, obj, tagGroups)
  );
  return group.combinator === "AND" ? results.every(Boolean) : results.some(Boolean);
}

export function matchesSmartCollection(
  collection: SmartCollection,
  obj: DesignObject,
  tagGroups: TagGroups
): boolean {
  return evaluateGroup(collection.rule, obj, tagGroups);
}

/** Default operator suggested for a given field, used by the rule builder UI. */
export function defaultOperatorFor(field: string): "includes" | "equals" | "contains" {
  if (field === "tag" || isGroupField(field)) return "includes";
  if (field === "text") return "contains";
  return "equals";
}
