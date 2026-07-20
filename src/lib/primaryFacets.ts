import type { DesignObject, FacetField, RoleDefinition } from "../types";
import { norm } from "./textNorm";
import { resolveTagOrigin } from "./tagOrigin";
import { groupObjects, UNGROUPED_LABEL, type ObjectGroup } from "./grouping";

/**
 * Pure resolution boundary for the collection-workspace feature — every
 * decision about "what's active, what's emphasized" for PrimaryFacetsBar and
 * ClassificationPanel goes through here, never inlined in either component.
 * That's deliberate groundwork for a future global "working mode" concept
 * (Design/Photography/Development/Research…, not built yet): a mode would
 * plug into this one seam (e.g. a mode-aware tiebreak in resolveActiveRole)
 * without either UI component needing to change at all.
 */

/** Roles actually present among `objects` — role-less objects are excluded,
 * since they can never carry a role's pinned primaryFacets. */
export function distinctRoleKeys(objects: DesignObject[]): Set<string> {
  const keys = new Set<string>();
  for (const object of objects) {
    if (object.role) keys.add(norm(object.role));
  }
  return keys;
}

/**
 * Resolves which role is "active" for the workspace UI: the sole role for a
 * homogeneous collection, the explicit `roleFilter` for a heterogeneous one,
 * or — nothing picked yet — the role with the most objects (ties broken
 * alphabetically by display name for determinism).
 */
export function resolveActiveRole(
  objects: DesignObject[],
  roles: Record<string, RoleDefinition>,
  roleFilter: string
): RoleDefinition | undefined {
  if (roleFilter) return roles[norm(roleFilter)];

  const counts = new Map<string, number>();
  for (const object of objects) {
    if (!object.role) continue;
    const key = norm(object.role);
    counts.set(key, (counts.get(key) ?? 0) + 1);
  }

  const ranked = Array.from(counts.entries())
    .map(([key, count]) => ({ key, count, def: roles[key] }))
    .filter((entry): entry is { key: string; count: number; def: RoleDefinition } =>
      Boolean(entry.def)
    )
    .sort((a, b) => b.count - a.count || a.def.name.localeCompare(b.def.name));

  return ranked[0]?.def;
}

export type FacetStrength = { coveragePct: number; userConfirmedPct: number };

/**
 * coveragePct = share of `objects` with a non-empty value for `field`.
 * userConfirmedPct = share of those value-holders whose value resolves
 * "user" via lib/tagOrigin.ts — i.e. actually hand-confirmed here, not just
 * synced or AI-guessed.
 */
export function computeFacetStrength(
  objects: DesignObject[],
  field: FacetField,
  localUserTags: Record<string, string[]>
): FacetStrength {
  let holders = 0;
  let userConfirmed = 0;
  for (const object of objects) {
    const raw = object.fields[field.name];
    const values = Array.isArray(raw) ? raw : raw ? [raw] : [];
    if (values.length === 0) continue;
    holders++;
    const isUser = values.some(
      (v) => resolveTagOrigin(object, v, localUserTags[object.id]) === "user"
    );
    if (isUser) userConfirmed++;
  }
  return {
    coveragePct: objects.length === 0 ? 0 : holders / objects.length,
    userConfirmedPct: holders === 0 ? 0 : userConfirmed / holders,
  };
}

export type FacetEmphasis = "normal" | "muted" | "hidden";

const HIDE_COVERAGE = 0.15;
const MUTE_COVERAGE = 0.4;
const WEAK_USER_CONFIRMED = 0.2;

/** Coverage-based de-emphasis (workspace top bar): a facet almost nobody has
 * a value for isn't worth prime real estate, and one that's mostly unverified
 * AI/mymind guesses shouldn't look as authoritative as a hand-confirmed one.
 * Plain constants, easy to retune — not derived from any other threshold in
 * the app.
 *
 * `justCreated` (2026-07-20) exempts ONE facet from HIDING, never from
 * muting: the property created through "+ property" this session. Without
 * it the feature was circular — a brand-new property had 0% coverage, so it
 * was hidden, so there was nowhere to fill it from, so it stayed at 0%
 * forever. The exemption is deliberately THIS narrow: a first cut exempted
 * every pinned facet, which resurrected four near-empty columns at once and
 * read as an invasive wall of chrome (Samuel's feedback, same day). Intent
 * beats statistics only for the thing just asked for; everything else earns
 * its place through coverage.
 */
export function classifyFacetEmphasis(
  strength: FacetStrength,
  justCreated = false
): FacetEmphasis {
  if (strength.coveragePct < HIDE_COVERAGE) return justCreated ? "muted" : "hidden";
  if (strength.coveragePct < MUTE_COVERAGE) return "muted";
  if (strength.userConfirmedPct < WEAK_USER_CONFIRMED) return "muted";
  return "normal";
}

/** Same per-value split as computeFacetStrength, but for one specific value —
 * powers a single chip's user/AI styling rather than the whole field's. */
export function computeValueUserShare(
  objects: DesignObject[],
  field: FacetField,
  value: string,
  localUserTags: Record<string, string[]>
): number {
  let holders = 0;
  let userConfirmed = 0;
  for (const object of objects) {
    const raw = object.fields[field.name];
    const values = Array.isArray(raw) ? raw : raw ? [raw] : [];
    if (!values.includes(value)) continue;
    holders++;
    if (resolveTagOrigin(object, value, localUserTags[object.id]) === "user") userConfirmed++;
  }
  return holders === 0 ? 0 : userConfirmed / holders;
}

/**
 * groupObjects, but with the empty-value bucket always trailing — the
 * classification panel's "classified before Unclassified" requirement.
 * Deliberately local to this feature: lib/grouping.ts's own UNGROUPED_LABEL
 * ordering (used by Table/Grid group headers) is untouched.
 */
export function orderedFacetBuckets(objects: DesignObject[], field: FacetField): ObjectGroup[] {
  const groups = groupObjects(objects, field.name, [field]);
  const idx = groups.findIndex((g) => g.label === UNGROUPED_LABEL);
  if (idx === -1) return groups;
  const [unclassified] = groups.splice(idx, 1);
  return [...groups, unclassified];
}
