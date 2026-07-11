import type { DesignObject } from "../types";

/**
 * Draft rule table: mymind `entityType` + tags → suggested item type
 * (issue #84's closed decision; consumed later by #104). Suggestion only —
 * the caller surfaces it as a pre-highlighted choice, never auto-assigns.
 *
 * The point (per the decision) is that roles are DERIVED from the
 * combination, not copied from entityType: the same entityType means
 * different things in different tag contexts. The two worked examples from
 * the decision are encoded below — a link about a book is interest in the
 * CONTENT (→ Book), an image of a book carrying design-ish tags is
 * interest in the ARTIFACT (→ Design Artifact).
 *
 * First matching rule wins, so more specific combinations must sit above
 * broader ones. This is the seed table #104 will grow against real
 * objects; keep rules few and legible rather than clever.
 */
type RoleRule = {
  entityTypes: string[];
  /** All listed patterns must match somewhere in the object's tags. */
  tagPatterns?: RegExp[];
  role: string;
};

// "book" in the two languages this library actually contains (Spanish and
// a large Hungarian corpus), word-bounded so "facebook" doesn't match.
const BOOK_TAG = /\bbook\b|\blibro\b|könyv/i;
const DESIGN_TAG = /typograph|cover|layout|editorial|lettering|poster|graphic design|book design/i;

const RULES: RoleRule[] = [
  // entityType + tag combinations (most specific first) — the decision's
  // two worked examples.
  { entityTypes: ["Image", "Screenshot"], tagPatterns: [BOOK_TAG, DESIGN_TAG], role: "Design Artifact" },
  { entityTypes: ["WebPage", "Article"], tagPatterns: [BOOK_TAG], role: "Book" },
  // Unambiguous entityTypes — mymind's own classification is already the
  // answer, no tag signal needed.
  { entityTypes: ["Book"], role: "Book" },
  { entityTypes: ["Article"], role: "Article" },
  { entityTypes: ["MusicAlbum"], role: "Album" },
  { entityTypes: ["Podcast"], role: "Podcast" },
  { entityTypes: ["Movie"], role: "Film" },
];

export function suggestRole(object: DesignObject): string | null {
  const entityType = object.fields.entity_type;
  if (!entityType) return null;
  const tagBlob = object.tags.join(" ");
  for (const rule of RULES) {
    if (!rule.entityTypes.includes(entityType)) continue;
    if (rule.tagPatterns && !rule.tagPatterns.every((p) => p.test(tagBlob))) continue;
    return rule.role;
  }
  return null;
}
