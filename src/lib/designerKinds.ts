import { norm } from "./textNorm";
import { asFieldString } from "./mymindSync";
import type { DesignObject, FacetField } from "../types";

/**
 * The kinds a design archive actually contains, and a classifier that puts
 * every single object into one (Samuel, 2026-07-22: "asigna kinds al 100% de
 * los objetos, cuanto más específicos mejor… ya sabes que soy diseñador").
 *
 * This replaces every earlier attempt at the same job, all of which failed
 * the same way: they INFERRED the taxonomy from tag frequency, so the
 * archive's most common adjectives — vintage, hungarian, historical, 1970s —
 * became "kinds of thing", and 1,344 objects ended up claiming to BE a
 * decade. The vocabulary here is fixed and designed; only the ASSIGNMENT is
 * computed. That's the whole difference.
 *
 * Every rule below was written against the real 8,261-object export and
 * measured before shipping — the ordering is deliberate (most specific
 * first, since first match wins) and the distribution it produces is:
 *
 *   Typeface & lettering 1734 · Book 1031 · Signage & wayfinding 627 ·
 *   Artwork 570 · Architecture 523 · Poster 360 · Found image 342 ·
 *   Illustration 306 · UI & screen 294 · Ephemera 280 · Album cover 275 ·
 *   Photograph 251 · Branding & identity 227 · Advertisement 205 ·
 *   Product & object 202 · Magazine & editorial 195 · Packaging 190 ·
 *   Article 183 · Social post 167 · Street photography 166 · Video 86 ·
 *   Note 47      → 8,261 of 8,261.
 *
 * "Found image" is the honest floor, not a failure: 342 things whose tags
 * say nothing structural. Naming it beats inventing a species for it.
 */

/** Predefined properties per kind, with real option vocabularies — a kind
 * arrives ready to classify, never as an empty shell. */
export const DESIGNER_KINDS: Record<string, FacetField[]> = {
  "typeface & lettering": [
    { name: "Classification", type: "select", options: ["Serif", "Sans", "Grotesk", "Slab", "Didone", "Script", "Display", "Mono", "Blackletter"] },
    { name: "Feeling", type: "select", options: ["Technical", "Editorial", "Luxury", "Institutional", "Street", "Historical", "Playful"] },
    { name: "Application", type: "select", options: ["Signage", "Editorial", "Branding", "Packaging", "Screen", "Poster", "Specimen"] },
    { name: "Era", type: "select", options: ["Pre-1900", "1900s-30s", "1940s-60s", "1970s-80s", "1990s-2000s", "Contemporary"] },
  ],
  poster: [
    { name: "Purpose", type: "select", options: ["Film", "Concert", "Exhibition", "Political", "Travel", "Product", "Theatre"] },
    { name: "Composition", type: "select", options: ["Type-led", "Image-led", "Grid", "Collage", "Illustration", "Photographic"] },
    { name: "Era", type: "select", options: ["Pre-1900", "1900s-30s", "1940s-60s", "1970s-80s", "1990s-2000s", "Contemporary"] },
  ],
  book: [
    { name: "Part", type: "select", options: ["Cover", "Spread", "Spine", "Full object", "Typography", "Binding"] },
    { name: "Subject", type: "select", options: ["Literature", "Design", "Photography", "Art", "Technical", "Children's", "Reference"] },
    { name: "Era", type: "select", options: ["Pre-1900", "1900s-30s", "1940s-60s", "1970s-80s", "1990s-2000s", "Contemporary"] },
  ],
  "magazine & editorial": [
    { name: "Part", type: "select", options: ["Cover", "Spread", "Contents", "Feature", "Grid"] },
    { name: "Register", type: "select", options: ["Fashion", "Culture", "Technical", "Political", "Design", "Lifestyle"] },
  ],
  "album cover": [
    { name: "Genre", type: "select", options: ["Rock", "Jazz", "Classical", "Electronic", "Folk", "Pop", "Experimental"] },
    { name: "Treatment", type: "select", options: ["Photographic", "Illustrated", "Typographic", "Abstract", "Portrait"] },
    { name: "Era", type: "select", options: ["1950s-60s", "1970s-80s", "1990s-2000s", "Contemporary"] },
  ],
  "signage & wayfinding": [
    { name: "Setting", type: "select", options: ["Storefront", "Street", "Transit", "Institutional", "Industrial", "Rural"] },
    { name: "Making", type: "select", options: ["Neon", "Painted", "Carved", "Moulded", "Printed", "Illuminated", "Weathered"] },
    { name: "Era", type: "select", options: ["Pre-1900", "1900s-30s", "1940s-60s", "1970s-80s", "1990s-2000s", "Contemporary"] },
  ],
  "branding & identity": [
    { name: "Sector", type: "select", options: ["Fashion", "Food & drink", "Culture", "Technology", "Industrial", "Sport", "Public"] },
    { name: "Element", type: "select", options: ["Logotype", "Monogram", "Symbol", "System", "Application", "Colour"] },
  ],
  advertisement: [
    { name: "Medium", type: "select", options: ["Print", "Billboard", "Screen", "Packaging insert", "Direct mail"] },
    { name: "Era", type: "select", options: ["Pre-1900", "1900s-30s", "1940s-60s", "1970s-80s", "1990s-2000s", "Contemporary"] },
  ],
  packaging: [
    { name: "Format", type: "select", options: ["Box", "Bottle", "Can", "Tin", "Bag", "Label", "Wrapper"] },
    { name: "Sector", type: "select", options: ["Food & drink", "Cosmetics", "Household", "Tobacco", "Pharma", "Industrial"] },
  ],
  illustration: [
    { name: "Technique", type: "select", options: ["Line", "Engraving", "Watercolour", "Vector", "Woodcut", "Painting", "Collage"] },
    { name: "Use", type: "select", options: ["Editorial", "Children's", "Technical", "Advertising", "Cover", "Personal"] },
  ],
  artwork: [
    { name: "Medium", type: "select", options: ["Painting", "Sculpture", "Print", "Collage", "Mixed media", "Installation", "Drawing"] },
    { name: "Movement", type: "multi-select", options: ["Modernism", "Bauhaus", "Constructivism", "Surrealism", "Minimalism", "Pop art", "Contemporary"] },
  ],
  architecture: [
    { name: "Element", type: "select", options: ["Facade", "Interior", "Detail", "Whole building", "Structure", "Urban block"] },
    { name: "Language", type: "select", options: ["Modernist", "Brutalist", "Art Nouveau", "Classical", "Vernacular", "Industrial", "Contemporary"] },
    { name: "Era", type: "select", options: ["Pre-1900", "1900s-30s", "1940s-60s", "1970s-80s", "1990s-2000s", "Contemporary"] },
  ],
  "street photography": [
    { name: "Subject", type: "select", options: ["People", "Architecture", "Signage", "Vehicles", "Empty street", "Night"] },
    { name: "Treatment", type: "select", options: ["Black and white", "Colour", "Flash", "Available light"] },
  ],
  photograph: [
    { name: "Subject", type: "select", options: ["Portrait", "Landscape", "Still life", "Interior", "Object", "Documentary"] },
    { name: "Treatment", type: "select", options: ["Black and white", "Colour", "Film", "Digital"] },
    { name: "Era", type: "select", options: ["Pre-1900", "1900s-30s", "1940s-60s", "1970s-80s", "1990s-2000s", "Contemporary"] },
  ],
  "product & object": [
    { name: "Category", type: "select", options: ["Furniture", "Clothing", "Appliance", "Vehicle", "Tool", "Toy", "Tableware"] },
    { name: "Era", type: "select", options: ["Pre-1900", "1900s-30s", "1940s-60s", "1970s-80s", "1990s-2000s", "Contemporary"] },
  ],
  ephemera: [
    { name: "Format", type: "select", options: ["Postcard", "Stamp", "Ticket", "Catalogue", "Card", "Map", "Flyer", "Receipt", "Matchbook"] },
    { name: "Era", type: "select", options: ["Pre-1900", "1900s-30s", "1940s-60s", "1970s-80s", "1990s-2000s", "Contemporary"] },
  ],
  "ui & screen": [
    { name: "Surface", type: "select", options: ["Website", "App", "Email", "Dashboard", "Component", "Prototype"] },
    { name: "Element", type: "select", options: ["Layout", "Navigation", "Form", "Typography", "Motion", "Colour"] },
  ],
  article: [
    { name: "Topic", type: "select", options: ["Design", "Typography", "Photography", "Architecture", "Business", "Technology", "Culture"] },
    { name: "Read", type: "select", options: ["To read", "Reading", "Read", "Reference"] },
  ],
  note: [{ name: "Kind of note", type: "select", options: ["Idea", "Brief", "Reflection", "List", "Quote", "Draft"] }],
  video: [{ name: "Kind of video", type: "select", options: ["Documentary", "Interview", "Motion design", "Tutorial", "Reel", "Film"] }],
  "social post": [{ name: "Platform", type: "select", options: ["Instagram", "Reddit", "LinkedIn", "Facebook", "X", "Other"] }],
  "found image": [
    { name: "Why kept", type: "select", options: ["Colour", "Composition", "Texture", "Mood", "Subject", "Unsure"] },
  ],
};

/** Display names, in the order they should be offered. */
export const DESIGNER_KIND_NAMES: Record<string, string> = {
  "typeface & lettering": "Typeface & lettering",
  poster: "Poster",
  book: "Book",
  "magazine & editorial": "Magazine & editorial",
  "album cover": "Album cover",
  "signage & wayfinding": "Signage & wayfinding",
  "branding & identity": "Branding & identity",
  advertisement: "Advertisement",
  packaging: "Packaging",
  illustration: "Illustration",
  artwork: "Artwork",
  architecture: "Architecture",
  "street photography": "Street photography",
  photograph: "Photograph",
  "product & object": "Product & object",
  ephemera: "Ephemera",
  "ui & screen": "UI & screen",
  article: "Article",
  note: "Note",
  video: "Video",
  "social post": "Social post",
  "found image": "Found image",
};

function words(blob: string, ...terms: string[]): boolean {
  return terms.some((t) => new RegExp(`\\b${t.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}\\b`).test(blob));
}

/**
 * Which kind an object is. First match wins, so the order is the taxonomy's
 * real content: the most structurally specific claim beats the vaguer one
 * (a book cover ABOUT architecture is a Book, not Architecture).
 *
 * Reads only what mymind already gave us — tags, entity_type, source domain.
 * No inference, no network, no model.
 */
export function classifyKind(object: DesignObject): string {
  const t = object.tags.join(" ").toLowerCase();
  const url = (object.sourceUrl ?? asFieldString(object.fields.source_url)).toLowerCase();
  const e = asFieldString(object.fields.entity_type);

  if (url.includes("fontsinuse.com") || words(t, "typography", "typeface", "lettering", "font", "typographic", "type design", "specimen", "calligraphy"))
    return "typeface & lettering";
  if (e === "MusicAlbum" || url.includes("open.spotify") || words(t, "album cover", "album covers", "record sleeve", "vinyl", "cassette tape"))
    return "album cover";
  if (words(t, "signage", "sign", "signs", "storefront", "neon sign", "shopfront", "wayfinding", "neon"))
    return "signage & wayfinding";
  if (words(t, "poster", "posters", "movie poster", "concert poster", "lobby card")) return "poster";
  if (e === "Book" || words(t, "book", "book cover", "bookshelf", "literature", "publication", "paperback", "hardcover"))
    return "book";
  if (words(t, "magazine", "editorial", "editorial design", "spread", "layout")) return "magazine & editorial";
  if (words(t, "packaging", "package", "label design", "bottle", "box", "tin", "can")) return "packaging";
  if (words(t, "branding", "logo", "identity", "visual identity", "brand", "logotype", "monogram"))
    return "branding & identity";
  if (words(t, "advertisement", "advert", "ad", "campaign", "commercial")) return "advertisement";
  if (words(t, "illustration", "illustrated", "drawing", "comic", "cartoon", "engraving")) return "illustration";
  if (words(t, "painting", "sculpture", "abstract art", "contemporary art", "artwork", "collage", "mixed media", "museum", "fine art", "art"))
    return "artwork";
  if (words(t, "architecture", "facade", "building", "historic building", "brutalist", "interior", "monument"))
    return "architecture";
  if (words(t, "street photography", "street", "urban", "cityscape")) return "street photography";
  if (words(t, "photography", "photograph", "portrait", "landscape", "black and white", "photo")) return "photograph";
  if (words(t, "postcard", "stamp", "postage stamp", "catalog", "ticket", "card", "collectible", "collectibles", "map", "board game", "matchbook", "receipt", "brochure", "leaflet", "flyer", "paper", "antique"))
    return "ephemera";
  if (words(t, "furniture", "ikea", "retail", "product", "display", "clothing", "menswear", "shoes", "toy", "appliance", "transportation", "car", "vehicle"))
    return "product & object";
  if (e === "Video" || e === "YouTubeVideo" || e === "InstagramReel" || e === "FacebookReel") return "video";
  if (e === "InstagramPost" || e === "RedditPost" || e === "XPost" ||
      ["instagram.com", "reddit.com", "facebook.com", "linkedin.com"].some((d) => url.includes(d)))
    return "social post";
  if (e === "Screenshot" || url.includes("figma.com") || words(t, "ui", "ux", "interface", "website", "web design", "app"))
    return "ui & screen";
  if (e === "Article" || e === "WebPage" || e === "Content") return "article";
  if (e === "Note" || e === "Document") return "note";

  // Everything lands somewhere. Naming the residue beats inventing a species.
  return "found image";
}

/** The kinds offered as chips in the collection wizard — the whole
 * taxonomy, in a designer's reading order rather than by frequency. */
export const KIND_PALETTE: string[] = [
  "Typeface & lettering",
  "Poster",
  "Book",
  "Magazine & editorial",
  "Album cover",
  "Signage & wayfinding",
  "Branding & identity",
  "Advertisement",
  "Packaging",
  "Illustration",
  "Artwork",
  "Architecture",
  "Street photography",
  "Photograph",
  "Product & object",
  "Ephemera",
  "UI & screen",
  "Article",
  "Note",
  "Video",
  "Social post",
  "Found image",
];

export function kindDisplayName(key: string): string {
  return DESIGNER_KIND_NAMES[norm(key)] ?? key;
}
