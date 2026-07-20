/**
 * The shared FORM vocabulary (issue #136): one curated heuristic deciding
 * whether a word/tag/field reads as HOW something looks (form) versus WHAT
 * it is about (content). Used by both the discovery query builder and the
 * split similarity engine — one list, two consumers, no drift.
 */

/** Tags/values that read as FORM (style, medium, palette, composition,
 * typography, era-of-look). Substring match, normalized. */
export const FORM_HINTS = [
  "typography", "typeface", "font", "serif", "sans", "lettering", "letter",
  "monochrome", "black and white", "b&w", "color", "colour", "palette",
  "minimal", "brutalis", "swiss", "grid", "layout", "composition",
  "poster", "cover", "sleeve", "editorial", "collage", "illustrat",
  "photograph", "print", "engrav", "woodcut", "screenprint", "risograph",
  "gradient", "texture", "pattern", "geometric", "organic", "hand-drawn",
  "handdrawn", "sketch", "vintage", "retro", "modernis", "art deco",
  "art nouveau", "bauhaus", "psychedelic", "grunge", "neon", "pastel",
  "bold", "condensed", "italic", "mono", "duotone", "halftone",
  "red", "blue", "green", "yellow", "orange", "purple", "pink", "beige",
  "cream", "muted", "vibrant", "dark", "light",
];

/** Facet field names whose VALUES read as form. */
export const FORM_FIELDS = ["style", "tone", "format", "medium", "technique", "palette", "era"];

export function isFormWord(word: string): boolean {
  const w = word.toLowerCase();
  return FORM_HINTS.some((h) => w.includes(h));
}

export function isFormField(fieldName: string): boolean {
  const f = fieldName.toLowerCase();
  return FORM_FIELDS.some((h) => f.includes(h));
}
