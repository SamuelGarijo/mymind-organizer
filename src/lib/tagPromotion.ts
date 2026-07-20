import type { DesignObject } from "../types";
import { norm } from "./textNorm";

/**
 * Tag promotion — a tag becoming structure without being duplicated or
 * destroyed (Samuel's decision, 2026-07-20).
 *
 * When `rojo` becomes the value of a Colour property, three wrong things
 * could happen: leave it in both places (duplication — the same fact stated
 * twice, and the tag bar stays noisy), copy it and delete the tag
 * (destruction — provenance and reversibility gone, and at enrichment scale
 * that is thousands of tags deleted by a rule that might be wrong), or do
 * nothing. The right thing is a fourth: **promote it**. The tag stops
 * appearing as a loose generic tag and becomes a structured value, keeping
 * its identity, its provenance, and a one-gesture way back.
 *
 * How that is implemented matters: this is an OVERLAY, never an edit to the
 * object's `tags` array. The same read-time-derivation pattern the app
 * already uses for `localTagRemovals` and `resolveTagOrigin`.
 *
 * - The tag STAYS in `object.tags`. Nothing is deleted, so search,
 *   similarity, tag-frequency and mymind's own copy all keep seeing it — and
 *   a resync cannot churn it (mymind resends the tag; the promotion record is
 *   ours and persists beside it, exactly like `manualCollectionIds`).
 * - Only the *generic tag presentation* hides it — card chips, the tag bar,
 *   Curated Piles. `visibleTags` below is the single definition of "generic
 *   tag", so that decision lives in one place instead of five components.
 * - Identity: tags here have no stable id, they are plain strings keyed by
 *   `norm()`. So `norm(tag)` IS the identifier, and a promotion records the
 *   link explicitly rather than hoping two strings still match later.
 * - Reversal drops the record: the tag reappears and the field value clears.
 *   A true inverse, with nothing to recover because nothing was lost.
 */

export type TagPromotion = {
  /** The tag as it appears on the object (display casing preserved). */
  tag: string;
  /** The field it was promoted into. */
  field: string;
  /** The option value it became — not always identical to the tag (a
   * `sans-serif typeface` tag can promote to a `Sans` option). */
  value: string;
};

export type TagPromotions = Record<string, TagPromotion[]>;

/**
 * The object's tags minus anything promoted into a field — what every
 * generic tag surface should render. Returns the original array untouched
 * when nothing is promoted, so the common case allocates nothing and
 * reference-equality memos keep hitting.
 */
export function visibleTags(object: DesignObject, promotions: TagPromotions): string[] {
  const promoted = promotions[object.id];
  if (!promoted || promoted.length === 0) return object.tags;
  const hidden = new Set(promoted.map((p) => norm(p.tag)));
  return object.tags.filter((tag) => !hidden.has(norm(tag)));
}

/** Is this specific tag currently promoted, and into what? Powers the "this
 * came from a tag" affordance on a field value, and its way back. */
export function promotionFor(
  objectId: string,
  tag: string,
  promotions: TagPromotions
): TagPromotion | undefined {
  return promotions[objectId]?.find((p) => norm(p.tag) === norm(tag));
}

/** Every promotion into a given field for one object — a multi-select field
 * can have absorbed several tags. */
export function promotionsIntoField(
  objectId: string,
  fieldName: string,
  promotions: TagPromotions
): TagPromotion[] {
  return (promotions[objectId] ?? []).filter((p) => norm(p.field) === norm(fieldName));
}

/** Adds a promotion, replacing any existing record for the same tag (a tag
 * belongs to at most one field at a time). Pure — returns the next map. */
export function addPromotion(
  promotions: TagPromotions,
  objectId: string,
  promotion: TagPromotion
): TagPromotions {
  const existing = promotions[objectId] ?? [];
  const next = existing.filter((p) => norm(p.tag) !== norm(promotion.tag));
  next.push(promotion);
  return { ...promotions, [objectId]: next };
}

/** Removes every promotion into `fieldName` for these objects — the inverse
 * gesture, and what must run when a field's value is cleared or the field
 * itself is deleted, so a promoted tag never stays hidden with nothing to
 * show for it. Pure. */
export function revertPromotionsIntoField(
  promotions: TagPromotions,
  objectIds: string[],
  fieldName: string
): TagPromotions {
  let changed = false;
  const next = { ...promotions };
  for (const id of objectIds) {
    const existing = next[id];
    if (!existing?.length) continue;
    const kept = existing.filter((p) => norm(p.field) !== norm(fieldName));
    if (kept.length === existing.length) continue;
    changed = true;
    if (kept.length === 0) delete next[id];
    else next[id] = kept;
  }
  return changed ? next : promotions;
}
