import type { DesignObject } from "../types";

/**
 * Rule table: mymind `entityType` + tags → suggested item type (issue
 * #104). Suggestion only — the caller surfaces it as a pre-highlighted
 * choice (or, for the bulk "Auto-assign roles" action, a previewed count
 * the user confirms), never writes anything silently.
 *
 * Each rule is a plain predicate rather than a declarative AND/OR/exclude
 * config — Author Photography's "photography tag AND (an authorship tag
 * OR an Instagram source)" doesn't fit a single flat shape cleanly, and a
 * few readable functions beat a mini rule-language for ~8 entries.
 *
 * First matching rule wins, so ordering matters: specific/intentional
 * signals (Typography, Branding, Email, Book) sit above the broader
 * photography split, which itself sits above the generic entityType
 * fallbacks (Article, Album) — a book about typography reads as
 * Typography, a photography book reads as Book, an Article that happens
 * to be about email design reads as Email Layout Pattern. All arbitrary
 * calls; correct with one click via the item-type picker if wrong.
 */
type RoleRule = {
  role: string;
  match: (object: DesignObject, tagBlob: string) => boolean;
};

// Word-boundary so e.g. "book" doesn't match "facebook", "art" doesn't
// match "artwork". Confirmed against the real backup (2026-07-09 export,
// 8,137 objects) before writing these — see counts in each rule's comment.
const TYPOGRAPHY_TAG = /\btypography\b|\btypeface\b|\bfont pairing\b|\bspecimen\b/i;
const BRANDING_TAG = /\bbranding\b|\blogo\b|\bvisual identity\b|\bcorporate identity\b|\bbrand identity\b/i;
const EMAIL_TAG = /\bemail\b|\bnewsletter\b|\bemail design\b/i;
// "book" in the two languages this library actually contains (Spanish and
// a large Hungarian corpus).
const BOOK_TAG = /\bbook\b|\blibro\b|könyv/i;
const PHOTOGRAPHY_TAG =
  /\bphotography\b|\bphotograph\b|\bportrait\b|\bstreet photography\b|\blandscape\b/i;
// Deliberately conservative (issue #104 discussion, 2026-07-11): Author
// Photography is exclusive by design — better to leave an object
// unassigned to it than misclassify a casual photo as authored work.
const AUTHORSHIP_TAG =
  /\bphotographer\b|\bartist\b|\bexhibition\b|\bgallery\b|\bmuseum\b|\bcontemporary art\b/i;

const RULES: RoleRule[] = [
  // Direct, high-confidence tag matches — 1,194 objects carry `typography`
  // alone in the real library.
  { role: "Typography", match: (_o, tags) => TYPOGRAPHY_TAG.test(tags) },
  // 253 objects carry `branding`.
  { role: "Branding", match: (_o, tags) => BRANDING_TAG.test(tags) },
  // Small (~60 objects) but a real, clean signal.
  { role: "Email Layout Pattern", match: (_o, tags) => EMAIL_TAG.test(tags) },
  // entityType alone catches only 43 of the 819 "book"-tagged objects —
  // 811 of them are entityType Image. Tag match has to lead here, per the
  // #84 decision's own worked example.
  {
    role: "Book",
    match: (o, tags) => o.fields.entity_type === "Book" || BOOK_TAG.test(tags),
  },
  // Exclusive by design: photography signal AND an authorship signal
  // (or an Instagram source alongside the photography signal — checked
  // against the real backup: 194 Image objects have an instagram.com
  // source_url, sampled ones read as artist/gallery content).
  {
    role: "Author Photography",
    match: (o, tags) =>
      PHOTOGRAPHY_TAG.test(tags) &&
      (AUTHORSHIP_TAG.test(tags) || (o.fields.source_url ?? "").includes("instagram.com")),
  },
  // Fallback for anything with a photography signal that didn't clear the
  // authorship bar above — sits below it on purpose (ordering IS the
  // exclusivity mechanism, no explicit exclude needed).
  { role: "Photo", match: (_o, tags) => PHOTOGRAPHY_TAG.test(tags) },
  // Unambiguous entityTypes — mymind's own classification is the answer,
  // no tag signal needed. Sit last: broad catch-alls, only reached once
  // nothing more specific above matched.
  {
    role: "Article",
    match: (o) => ["Article", "WebPage"].includes(o.fields.entity_type ?? ""),
  },
  { role: "Album", match: (o) => o.fields.entity_type === "MusicAlbum" },
];

export function suggestRole(object: DesignObject): string | null {
  const tagBlob = object.tags.join(" ");
  for (const rule of RULES) {
    if (rule.match(object, tagBlob)) return rule.role;
  }
  return null;
}
