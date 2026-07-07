import Fuse from "fuse.js";
import type { DesignObject } from "../types";

/**
 * Weighted fuzzy search across title, tags, and mymind's summary. Title
 * outranks the rest so an exact title hit beats a loose tag/summary match —
 * weights are relative, not percentages.
 */
const FUSE_OPTIONS: ConstructorParameters<typeof Fuse<DesignObject>>[1] = {
  keys: [
    { name: "title", weight: 0.5 },
    { name: "tags", weight: 0.3 },
    { name: "fields.summary", weight: 0.2 },
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
