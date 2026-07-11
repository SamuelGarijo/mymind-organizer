import type { DesignObject } from "../types";
import { asFieldString } from "./mymindSync";

/**
 * "Most recently added to the library" — prefers mymind's own `bumped`
 * timestamp (an intentional resurface/re-save) over `modified` (which also
 * fires on incidental changes like background AI tagging) over `created`.
 * Falls back to our own local timestamps for sample/non-mymind objects.
 */
export function recencyTimestamp(obj: DesignObject): number {
  const iso =
    asFieldString(obj.fields.bumped) ||
    asFieldString(obj.fields.modified) ||
    asFieldString(obj.fields.created) ||
    obj.updatedAt ||
    obj.createdAt;
  const ms = iso ? Date.parse(iso) : 0;
  return Number.isNaN(ms) ? 0 : ms;
}

/** Newest first. Returns a new array — never mutates the input. */
export function sortByRecency(objects: DesignObject[]): DesignObject[] {
  return [...objects].sort((a, b) => recencyTimestamp(b) - recencyTimestamp(a));
}
