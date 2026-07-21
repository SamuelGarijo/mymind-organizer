import Fuse from "fuse.js";
import type { DesignObject } from "../types";
import {
  BLOB_ASPECT_KEY,
  BLOB_PALETTE_KEY,
  BLOB_TYPE_KEY,
  NOTE_CONTENT_KEY,
  NOTE_ID_KEY,
} from "./mymindSync";

/**
 * Keys whose values are machinery, not language: ids, timestamps, a
 * serialized colour histogram, a URL. Indexing them would let a query for
 * "2026" match every object synced this year, and a stray hex fragment
 * match a palette. Everything NOT listed here is treated as searchable
 * meaning — which is the right default, because the interesting keys are
 * the ones the user invents (Tone, Font Style, Foundry…) and a denylist
 * covers them automatically as they appear.
 */
const UNSEARCHABLE_FIELD_KEYS = new Set([
  "mymind_id",
  "created",
  "modified",
  "bumped",
  "source_url",
  BLOB_TYPE_KEY,
  BLOB_ASPECT_KEY,
  BLOB_PALETTE_KEY,
  NOTE_ID_KEY,
  // Indexed explicitly below with their own weights.
  "summary",
  NOTE_CONTENT_KEY,
]);

/**
 * Everything an object has been CLASSIFIED as, as one searchable string:
 * its entity type plus every field value that carries meaning.
 *
 * This is what makes assigned properties findable (Samuel, 2026-07-21:
 * having set Tone = Hippie on a poster, searching "hippie" returned
 * nothing). Classification was write-only as far as search was concerned —
 * you could file a thing under a word and then not be able to reach it by
 * that word, which defeats the point of filing it.
 */
function classificationText(object: DesignObject): string {
  const parts: string[] = [];
  if (object.role) parts.push(object.role);
  for (const [key, raw] of Object.entries(object.fields)) {
    if (UNSEARCHABLE_FIELD_KEYS.has(key)) continue;
    const values = Array.isArray(raw) ? raw : [raw];
    for (const value of values) {
      if (typeof value === "string" && value.trim()) parts.push(value);
    }
  }
  return parts.join(" ");
}

/**
 * Weighted fuzzy search across title, tags, real note content, mymind's
 * summary, and everything the object has been classified as. Title
 * outranks the rest so an exact title hit beats a loose tag/field match —
 * weights are relative, not percentages.
 */
const FUSE_OPTIONS: ConstructorParameters<typeof Fuse<DesignObject>>[1] = {
  keys: [
    { name: "title", weight: 0.5 },
    { name: "tags", weight: 0.3 },
    { name: `fields.${NOTE_CONTENT_KEY}`, weight: 0.3 },
    // A hand-assigned property value is a deliberate statement about the
    // thing — worth more than mymind's auto-written summary, less than a
    // title or a tag.
    { name: "classification", weight: 0.25, getFn: classificationText },
    { name: "fields.summary", weight: 0.15 },
  ],
  threshold: 0.35,
  ignoreLocation: true,
  minMatchCharLength: 2,
};

/** Rebuild only when the candidate pool actually changes (e.g. a new view or
 * a fresh sync) — indexing ~8000 objects on every keystroke would defeat the
 * point of a search box. */
export function buildSearchIndex(objects: DesignObject[]): Fuse<DesignObject> {
  return new Fuse(objects, FUSE_OPTIONS);
}

/** Empty query short-circuits to the full pool (in its existing order)
 * rather than asking Fuse to "match everything". */
export function searchObjects(
  index: Fuse<DesignObject>,
  query: string,
  pool: DesignObject[]
): DesignObject[] {
  const q = query.trim();
  if (q === "") return pool;
  return index.search(q).map((r) => r.item);
}
