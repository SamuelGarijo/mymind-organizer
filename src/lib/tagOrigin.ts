import type { DesignObject, TagOrigin } from "../types";

const AI_FLAG = 2;
const MANUAL_FLAG = 8;

/**
 * Resolves a single tag's origin — never stored on the object, always
 * derived at read time from two existing signals:
 *
 * - `localUserTags` (store.ts) — this app's own durable record of tags added
 *   through addObjectTag (the DetailPanel "Add tag" box, or a Curated Piles
 *   drop). Checked first and wins outright: once a tag is known to be
 *   hand-typed here, it must keep reading "user" even after it's pushed to
 *   mymind and echoed back with mymind's own Manual flag on a later sync —
 *   otherwise every hand-added tag would quietly stop being a pile the
 *   moment it round-trips.
 * - `tagFlags` (mymind's own bitmask, 2=AI / 8=Manual) — for anything not in
 *   `localUserTags`, i.e. every tag that arrived via sync. Manual here means
 *   a human added it inside mymind's own UI, not this app — genuinely a
 *   different provenance from "user", even though both are human-authored.
 *
 * An object with no flags at all for a tag (a sample/local object, or one
 * synced before tagFlags existed) falls back on its own `source`: a sample
 * object's tags are inherently hand-authored (there's no AI for locally
 * imported test data), so "user"; a mymind object with unknown flags for a
 * tag defaults to "mymind" rather than guessing "ai".
 */
export function resolveTagOrigin(
  object: DesignObject,
  tag: string,
  localUserTags: string[] | undefined
): TagOrigin {
  if (localUserTags?.includes(tag)) return "user";
  const flags = object.tagFlags?.[tag.trim().toLowerCase()];
  if (flags !== undefined) {
    if (flags & AI_FLAG) return "ai";
    if (flags & MANUAL_FLAG) return "mymind";
  }
  return object.source === "mymind" ? "mymind" : "user";
}
