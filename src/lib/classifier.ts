import type { DesignObject, FacetField } from "../types";
import { norm } from "./textNorm";

/**
 * The classifier tier's client half — the one place the app asks a model
 * anything (Samuel, 2026-07-21).
 *
 * What it asks is deliberately narrow, and the boundary was measured, not
 * guessed. Physical facts about this archive are already free: colour from
 * the stored palette (88.6% of objects), orientation from blob dimensions,
 * format, source. Twice now, statistics have failed at MEANING and been
 * caught doing it — ranking tags by cohesion put "spine" above
 * "architecture" as a kind of thing, and scraping vocabulary by lift
 * offered "Font Style: New Topographics" for photographs. Which words are
 * kinds, which are properties, and which word belongs to which property is
 * a semantic judgement, and that is all this is spent on.
 *
 * So: one call about a group's VOCABULARY, never a call per object. Once
 * the properties and their options exist, the existing deterministic
 * pipeline fills every object for free, because tag→value matching already
 * works when options are declared. Eight thousand calls would be slower,
 * costlier and worse than one.
 *
 * Only tag strings and titles leave the machine, through the local proxy
 * that holds the key. No images, no ids, no credentials.
 */

export type TaxonomySuggestion = {
  properties: { name: string; reason?: string; options: string[] }[];
  /** Words offered as the kind's name that the model reads as attributes —
   * the "Residential is not a species" check, from the side that can
   * actually make it. */
  notAKind?: string[];
};

export class ClassifierUnavailable extends Error {}

/** Distinct tags across a set of objects, most-shared first — the compact
 * summary the call is built from. Counts matter: a word two of eleven
 * things carry is weaker evidence than one nine of them share. */
export function vocabularyOf(objects: DesignObject[], limit = 200) {
  const counts = new Map<string, { tag: string; count: number }>();
  for (const object of objects) {
    for (const tag of new Set(object.tags.map((t) => t))) {
      const key = norm(tag);
      const entry = counts.get(key);
      if (entry) entry.count++;
      else counts.set(key, { tag, count: 1 });
    }
  }
  return Array.from(counts.values())
    .sort((a, b) => b.count - a.count)
    .slice(0, limit);
}

export async function suggestTaxonomy({
  typeName,
  members,
  existingProperties,
}: {
  typeName: string;
  members: DesignObject[];
  existingProperties: string[];
}): Promise<TaxonomySuggestion> {
  const vocabulary = vocabularyOf(members);
  if (vocabulary.length === 0) return { properties: [] };

  const res = await fetch("/api/gemini/taxonomy", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      typeName,
      vocabulary,
      existingProperties,
      sampleTitles: members.slice(0, 12).map((o) => o.title).filter(Boolean),
    }),
  });

  if (res.status === 401) {
    throw new ClassifierUnavailable(
      "No Gemini key yet — add one in Preferences to let it read your vocabulary."
    );
  }
  if (!res.ok) {
    const body = await res.json().catch(() => ({}));
    throw new Error(body.error ?? `The classifier failed (${res.status}).`);
  }
  return (await res.json()) as TaxonomySuggestion;
}

/** A suggestion becomes a real field package only after the options are
 * checked back against vocabulary that actually exists on these objects —
 * a model asked not to invent words can still do it, and a property whose
 * options nothing carries is worse than no property. */
export function toFacetFields(
  suggestion: TaxonomySuggestion,
  members: DesignObject[]
): FacetField[] {
  const present = new Set<string>();
  for (const object of members) for (const tag of object.tags) present.add(norm(tag));

  const fields: FacetField[] = [];
  for (const property of suggestion.properties) {
    const name = property.name?.trim();
    if (!name) continue;
    const options = Array.from(
      new Set(property.options.map((o) => o.trim()).filter((o) => o && present.has(norm(o))))
    );
    if (options.length < 2) continue;
    fields.push({ name, type: "multi-select", options });
  }
  return fields;
}
