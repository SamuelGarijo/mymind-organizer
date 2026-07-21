import type { DesignObject, FacetField, RoleDefinition } from "../types";
import { CURATED_ROLE_FIELDS } from "./curatedRoleFields";
import { isFormWord } from "./formVocabulary";
import { norm } from "./textNorm";

/**
 * What kinds of thing does this archive actually contain?
 *
 * Until now that question had a hand-written answer: `lib/roleSuggestion`
 * holds eight rules (Typography, Branding, Email, Book, Author
 * Photography, Photo, Article, Album) written once against the library as
 * it stood in July. Anything outside those eight got no entity type at
 * all — which is why a photograph of a building sat untyped until Samuel
 * defined "architecture" by hand and asked, reasonably, why he had to
 * (2026-07-21).
 *
 * This module answers it from the archive instead. No AI: the signal is
 * already there in the tags the user (and mymind) have been applying for
 * years — a word that hundreds of objects share IS a kind of thing in this
 * library, whether or not anyone thought to codify it.
 *
 * It PROPOSES. Nothing here writes: the caller shows counts and samples
 * and the user accepts what reads true, which is also the only honest way
 * to handle the cases a frequency count gets wrong.
 */

/** A tag needs at least this many objects before it reads as a kind of
 * thing rather than an idiosyncrasy. Low enough to surface real pockets
 * (a few dozen), high enough that one-off vocabulary stays out. */
const MIN_MEMBERS = 25;

/** Words that are unmistakably about a thing's *substance* rather than its
 * kind — an object isn't a "vintage", it IS vintage. Beyond these, the
 * shared FORM vocabulary (lib/formVocabulary) already knows how-it-looks
 * words, and those are attributes too. Kept short on purpose: the user
 * rejects what doesn't fit, and a long denylist would quietly hide real
 * kinds. */
const NOT_A_KIND = new Set(
  [
    "design",
    "art",
    "inspiration",
    "reference",
    "idea",
    "beautiful",
    "cool",
    "favourite",
    "favorite",
    "old",
    "new",
    "good",
    "interesting",
    "work",
    "project",
    "detail",
    "image",
    "picture",
    "photo of",
    "screenshot",
  ].map(norm)
);

export type EntityTypeProposal = {
  /** Display-cased name for the entity type ("Architecture"). */
  name: string;
  /** The tag it was discovered from — what matching will key on. */
  tag: string;
  /** Objects carrying that tag. */
  count: number;
  /** ...of which this many have no entity type yet: what accepting buys. */
  untypedCount: number;
  sampleIds: string[];
  /** A starting field package: the curated one where the name is already
   * known, otherwise a single "Style" seeded from the look-words that are
   * distinctively common inside this group. Deliberately minimal — the
   * point is to start, not to arrive at a schema. */
  starterFields: FacetField[];
};

/** How much more common a word must be inside the group than across the
 * archive before it counts as characteristic of it. */
const LIFT_THRESHOLD = 2.5;

/**
 * Style values for a discovered type: the look-words (per the shared FORM
 * vocabulary) that are disproportionately common among its members. For
 * architecture that surfaces things like art nouveau / brutalist / bauhaus
 * — real vocabulary out of the archive, not a guess about the domain.
 *
 * Naming the OTHER properties a kind deserves (a record has an artist, a
 * label, a year) is a semantic judgement this deliberately doesn't fake —
 * it's the classifier's job, and the same measured boundary as everywhere
 * else in the enrichment pipeline: physical facts are derivable, meaning
 * is not.
 */
function deriveStyleOptions(
  members: DesignObject[],
  archiveTagCounts: Map<string, number>,
  archiveTotal: number
): string[] {
  const inGroup = new Map<string, { display: string; count: number }>();
  for (const object of members) {
    for (const tag of object.tags) {
      if (!isFormWord(tag)) continue;
      const key = norm(tag);
      const entry = inGroup.get(key);
      if (entry) entry.count++;
      else inGroup.set(key, { display: tag, count: 1 });
    }
  }
  const scored: { value: string; lift: number; count: number }[] = [];
  for (const [key, { display, count }] of inGroup) {
    if (count < 3) continue;
    const groupRate = count / members.length;
    const archiveRate = (archiveTagCounts.get(key) ?? count) / archiveTotal;
    const lift = archiveRate > 0 ? groupRate / archiveRate : 0;
    if (lift >= LIFT_THRESHOLD) scored.push({ value: display, lift, count });
  }
  return scored
    .sort((a, b) => b.count - a.count)
    .slice(0, 8)
    .map((s) => s.value);
}

/** Tag → display-cased entity-type name. "art nouveau" → "Art Nouveau". */
function titleCase(tag: string): string {
  return tag
    .split(/\s+/)
    .map((w) => (w.length <= 2 ? w : w[0].toUpperCase() + w.slice(1)))
    .join(" ");
}

export function discoverEntityTypes(
  objects: DesignObject[],
  existingRoles: Record<string, RoleDefinition>,
  limit = 24
): EntityTypeProposal[] {
  if (objects.length === 0) return [];

  const tagCounts = new Map<string, number>();
  const byTag = new Map<string, DesignObject[]>();
  for (const object of objects) {
    // One object shouldn't count twice for a tag it carries twice.
    for (const key of new Set(object.tags.map(norm))) {
      tagCounts.set(key, (tagCounts.get(key) ?? 0) + 1);
      const bucket = byTag.get(key);
      if (bucket) bucket.push(object);
      else byTag.set(key, [object]);
    }
  }

  const proposals: EntityTypeProposal[] = [];
  for (const [key, count] of tagCounts) {
    if (count < MIN_MEMBERS) continue;
    if (NOT_A_KIND.has(key)) continue;
    // A look-word describes a thing, it isn't a kind of thing.
    if (isFormWord(key)) continue;
    // Already an entity type — nothing to propose.
    if (existingRoles[key]) continue;

    const members = byTag.get(key) ?? [];
    const untypedCount = members.filter((o) => !o.role).length;
    // Nothing to gain if everything here is already typed as something.
    if (untypedCount === 0) continue;

    // Display casing from the most common raw spelling of the tag.
    const spellings = new Map<string, number>();
    for (const object of members) {
      for (const tag of object.tags) {
        if (norm(tag) !== key) continue;
        spellings.set(tag, (spellings.get(tag) ?? 0) + 1);
      }
    }
    const rawTag =
      Array.from(spellings.entries()).sort((a, b) => b[1] - a[1])[0]?.[0] ?? key;

    const curated = CURATED_ROLE_FIELDS[key];
    const styleOptions = curated ? [] : deriveStyleOptions(members, tagCounts, objects.length);
    const starterFields: FacetField[] =
      curated ??
      (styleOptions.length >= 3
        ? [{ name: "Style", type: "select", options: styleOptions }]
        : []);

    proposals.push({
      name: titleCase(rawTag),
      tag: rawTag,
      count,
      untypedCount,
      sampleIds: members.slice(0, 6).map((o) => o.id),
      starterFields,
    });
  }

  // Most to gain first — the pockets of the archive that are biggest and
  // least described.
  return proposals.sort((a, b) => b.untypedCount - a.untypedCount).slice(0, limit);
}

/** The objects an accepted proposal would type: members that carry the tag
 * and have no entity type yet. Never re-types anything already typed —
 * accepting a suggestion must not overwrite a decision already made. */
export function objectsForProposal(
  objects: DesignObject[],
  proposal: EntityTypeProposal
): DesignObject[] {
  const key = norm(proposal.tag);
  return objects.filter((o) => !o.role && o.tags.some((t) => norm(t) === key));
}
