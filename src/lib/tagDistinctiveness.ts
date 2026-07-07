import type { DesignObject } from "../types";
import { norm } from "./ruleEngine";

/** How many objects in the whole library carry each tag — computed once
 * over the full library (not the current view) and reused across every
 * card, since "distinctive" means rare library-wide, not rare on screen. */
export function computeTagFrequency(objects: DesignObject[]): Map<string, number> {
  const freq = new Map<string, number>();
  for (const obj of objects) {
    for (const tag of obj.tags) {
      const key = norm(tag);
      freq.set(key, (freq.get(key) ?? 0) + 1);
    }
  }
  return freq;
}

/**
 * Picks up to `limit` tags for a compact summary (card/table row),
 * preferring rarer ones: a tag on hundreds of objects ("design", "poster")
 * says little about this particular object, while one on a handful is far
 * more specific to it. Plain inverse-frequency ranking — no need for
 * anything more sophisticated at this scale. Ties keep the tag's original
 * order rather than re-sorting alphabetically.
 */
export function pickDistinctiveTags(
  tags: string[],
  frequency: Map<string, number>,
  limit = 4
): string[] {
  return tags
    .map((tag, index) => ({ tag, index, count: frequency.get(norm(tag)) ?? 1 }))
    .sort((a, b) => a.count - b.count || a.index - b.index)
    .slice(0, limit)
    .map((t) => t.tag);
}
