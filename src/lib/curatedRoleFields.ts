import type { FacetField } from "../types";

/**
 * Predefined field packages for a starter catalog of common item types —
 * grounded in the real library (tag frequency/co-occurrence checked
 * against the ~8,137-object backup) and in Samuel's own previously-written
 * collection schemas (issues #1/#9/#10/#11/#12), adapted to select/date
 * only per #99's closed decision (no free text — an author/artist name is
 * a growing select vocabulary, same principle as tags/roles themselves).
 *
 * Applied once, the first time each role name is created — via the
 * suggestion chip, the bulk auto-assign action, or even typing the name by
 * hand in the "new type…" input — never overwriting a role that already
 * exists. Purely a head start; nothing stops editing or ignoring these via
 * RolePackageModal.
 *
 * Era options are deliberately plain decade strings ("1970s", not
 * "1970s-80s") — these match real tags in the library verbatim, which is
 * what lets the tag-to-field auto-fill (store.ts) actually catch them.
 */
export const CURATED_ROLE_FIELDS: Record<string, FacetField[]> = {
  typography: [
    {
      // "Font Style", not "Type" — "Type" already means two other things in
      // this app (entity type, media type); three meanings on one label was
      // Samuel's §4 complaint (2026-07-21). Existing data is migrated by
      // the one-time taxonomy fix in store.ts's onRehydrateStorage.
      name: "Font Style",
      type: "select",
      options: ["Serif", "Sans", "Grotesk", "Slab", "Condensed", "Display", "Mono"],
    },
    {
      name: "Tone",
      type: "select",
      options: ["Technical", "Editorial", "Luxury", "Institutional", "Street", "Cultural"],
    },
    {
      name: "Use case",
      type: "select",
      options: ["Email", "Landing", "Portfolio", "Museum", "Technical brand", "Editorial"],
    },
    {
      name: "Draws me in by",
      type: "select",
      options: ["Shape", "Composition", "Contrast", "Color", "Hierarchy", "Texture"],
    },
  ],
  branding: [
    {
      name: "Sector",
      type: "select",
      options: ["Technical fashion", "Outdoor", "Sailing", "Industrial", "Mobility", "Software", "Electronics"],
    },
    {
      name: "Visual language",
      type: "select",
      options: ["Technical", "Premium", "Documentary", "Minimal", "Editorial", "Utilitarian"],
    },
    {
      name: "Useful element",
      type: "select",
      options: ["Typography", "Layout", "Color", "Photography", "Grid", "CTA", "Storytelling"],
    },
    {
      name: "Use case",
      type: "select",
      options: ["Email hero", "Product block", "Editorial section", "Landing", "Campaign"],
    },
    { name: "Technical intensity", type: "select", options: ["Low", "Medium", "High"] },
  ],
  "email layout pattern": [
    {
      name: "Email type",
      type: "select",
      options: ["Product", "Editorial", "Campaign", "Abandoned cart", "Post-purchase", "Newsletter"],
    },
    {
      name: "Structure",
      type: "select",
      options: ["Large hero", "Grid", "Stacked modules", "Split image-text", "Product cards", "Journal style"],
    },
    { name: "Density", type: "select", options: ["Clean", "Medium", "Dense"] },
    {
      name: "Tone",
      type: "select",
      options: ["Luxury", "Technical", "Editorial", "Commercial", "Lifestyle"],
    },
    {
      name: "Reusable for",
      type: "select",
      options: ["Footwear", "Outerwear", "Accessories", "Journal", "Sale", "Care guide"],
    },
  ],
  "author photography": [
    // Grows purely from use — same organic-vocabulary principle as #96,
    // no seed list guessed up front.
    { name: "Photographer", type: "select", options: [] },
    {
      name: "Genre",
      type: "select",
      options: ["Mood & atmosphere", "Documentary", "Portrait", "Street", "Landscape", "Architecture"],
    },
    {
      name: "Era",
      type: "select",
      options: ["Pre-1950s", "1950s", "1960s", "1970s", "1980s", "1990s", "2000s", "Contemporary"],
    },
    { name: "Region", type: "select", options: ["Hungary", "Germany", "Other Europe", "Other"] },
    { name: "Use case", type: "select", options: ["Print", "Essay", "Portfolio", "Exhibition"] },
  ],
  // Deliberately small — the low-confidence fallback bucket (see
  // lib/roleSuggestion.ts), not meant to carry the same weight as Author
  // Photography.
  photo: [
    {
      name: "Subject",
      type: "select",
      options: ["People", "Street", "Nature", "Interior", "Object", "Food"],
    },
    {
      name: "Era",
      type: "select",
      options: ["Pre-1950s", "1950s", "1960s", "1970s", "1980s", "1990s", "2000s", "Contemporary"],
    },
  ],
  book: [
    { name: "Author", type: "select", options: [] },
    {
      name: "Genre",
      type: "select",
      options: ["Fiction", "Non-fiction", "Poetry", "Children's", "Photography book", "Design", "Reference"],
    },
    {
      name: "Era",
      type: "select",
      options: ["Pre-1950s", "1950s", "1960s", "1970s", "1980s", "1990s", "2000s", "Contemporary"],
    },
    { name: "Read status", type: "select", options: ["To-read", "Reading", "Read", "Reference"] },
  ],
  article: [
    { name: "Topic", type: "select", options: [] },
    { name: "Source type", type: "select", options: ["News", "Essay", "Blog", "Academic"] },
    { name: "Read status", type: "select", options: ["To-read", "Reading", "Read", "Reference"] },
  ],
  album: [
    { name: "Artist", type: "select", options: [] },
    { name: "Genre", type: "select", options: [] },
    {
      name: "Era",
      type: "select",
      options: ["Pre-1950s", "1950s", "1960s", "1970s", "1980s", "1990s", "2000s", "Contemporary"],
    },
  ],
};
