import { asFieldString, MYMIND_OWNED_FIELD_KEYS } from "./mymindSync";
import { isFormField, isFormWord } from "./formVocabulary";
import type { DesignObject } from "../types";

/**
 * Builds the editable discovery query (bottom membrane) from what the
 * collection actually contains — two modes, two vocabularies:
 *
 * - "content": WHAT the things are about — subject-ish tags, proper-noun
 *   titles, roles, entity types.
 * - "form":    HOW the things look — style/composition/color/typography/
 *   material/era tags and facet values.
 *
 * There's no semantic classifier here — the split is a curated word-list
 * heuristic over the user's own tags, which is honest about what it is:
 * a STARTING PHRASE the user edits before searching, never an answer.
 */


function topTags(objects: DesignObject[], limit: number, form: boolean): string[] {
  const counts = new Map<string, number>();
  for (const o of objects) {
    for (const t of o.tags) {
      if (isFormWord(t) !== form) continue;
      counts.set(t, (counts.get(t) ?? 0) + 1);
    }
  }
  return [...counts.entries()]
    .sort((a, b) => b[1] - a[1])
    .slice(0, limit)
    .map(([t]) => t);
}

function topFacetValues(objects: DesignObject[], form: boolean, limit: number): string[] {
  const counts = new Map<string, number>();
  for (const o of objects) {
    for (const [field, value] of Object.entries(o.fields)) {
      if (isFormField(field) !== form) continue;
      // Never mymind-owned metadata (created/modified/summary/…), never
      // dates, never long prose — only real facet VOCABULARY.
      if ((MYMIND_OWNED_FIELD_KEYS as readonly string[]).includes(field)) continue;
      if (field.startsWith("mymind") || field === "description") continue;
      const v = asFieldString(value);
      if (!v || v.length > 30) continue;
      if (/^\d{4}-\d{2}/.test(v)) continue;
      counts.set(v, (counts.get(v) ?? 0) + 1);
    }
  }
  return [...counts.entries()]
    .sort((a, b) => b[1] - a[1])
    .slice(0, limit)
    .map(([v]) => v);
}

export function buildDiscoveryQuery(
  collectionName: string,
  objects: DesignObject[],
  mode: "content" | "form"
): string {
  const form = mode === "form";
  const parts = new Set<string>();
  // The collection's own name is usually the strongest subject signal —
  // include it for content; for form only when it IS a form word.
  const nameWords = collectionName
    .split(/[\s/·—-]+/)
    .filter((w) => w.length > 2 && !/^\d+$/.test(w));
  for (const w of nameWords) {
    if (isFormWord(w) === form) parts.add(w.toLowerCase());
  }
  for (const t of topTags(objects, 4, form)) parts.add(t.toLowerCase());
  for (const v of topFacetValues(objects, form, 2)) parts.add(v.toLowerCase());
  // Content mode: the dominant role/entity grounds the object type.
  if (!form) {
    const roleCounts = new Map<string, number>();
    for (const o of objects) {
      const r = o.role || asFieldString(o.fields.entity_type);
      if (r) roleCounts.set(r, (roleCounts.get(r) ?? 0) + 1);
    }
    const top = [...roleCounts.entries()].sort((a, b) => b[1] - a[1])[0];
    if (top && top[0] !== "Image") parts.add(top[0].toLowerCase());
  }
  return [...parts].slice(0, 7).join(" ");
}

/** Delegated external searches — Organizer builds the query, the provider
 * runs it in a new tab; collection, filters and scroll stay untouched. */
export const WEB_PROVIDERS = [
  {
    key: "pinterest" as const,
    label: "Pinterest",
    url: (q: string) => `https://www.pinterest.com/search/pins/?q=${encodeURIComponent(q)}`,
  },
  {
    key: "google" as const,
    label: "Google Images",
    url: (q: string) => `https://www.google.com/search?tbm=isch&q=${encodeURIComponent(q)}`,
  },
  {
    key: "yandex" as const,
    label: "Yandex",
    url: (q: string) => `https://yandex.com/images/search?text=${encodeURIComponent(q)}`,
  },
];
