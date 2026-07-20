import type { DesignObject } from "../types";
import {
  BLOB_TYPE_KEY,
  CREATOR_KEY,
  NOTE_CONTENT_KEY,
  PRICE_KEY,
  PUBLISHED_KEY,
  asFieldString,
} from "./mymindSync";

/**
 * What a thing IS, in one place (issue #92).
 *
 * mymind hands back ~18 entityTypes, but a Book and an Image both arrive as
 * "a picture with a title" — the cover. Before this, every one of them
 * rendered identically, so the grid couldn't answer "what am I looking at?"
 * without opening it. The differentiator is never decoration: it's the
 * per-type FACT mymind already knows (a book's author and year, a
 * product's brand and price, an article's publication, a post's handle),
 * lifted out of `mainEntity` at sync time.
 *
 * Design-philosophy constraint: one quiet meta line under the title, in the
 * mono register, plus at most one overlay affordance where the medium
 * genuinely differs (a video plays, a document is a file). No badges on
 * everything — a label on every card is chrome, not meaning.
 */

export type ObjectKind =
  | "note"
  | "document"
  | "book"
  | "album"
  | "article"
  | "link"
  | "product"
  | "social"
  | "video"
  | "image";

/** Overlay affordance drawn ON the preview — only where the medium itself
 * behaves differently, never as a type badge. */
export type KindAffordance = "play" | "file" | null;

export type KindDescriptor = {
  kind: ObjectKind;
  /** The one quiet line under the title. Empty = show nothing. */
  meta: string;
  affordance: KindAffordance;
  /** Portrait-ish media (book covers, posters) read better with the title
   * hugging the cover; used by Card to keep the pairing tight. */
  portraitCover: boolean;
};

/** `https://www.lrb.co.uk/blog/x` → `lrb.co.uk` — the fact that matters
 * about a link is where it came from, not its full query string. */
export function domainOf(url: string | undefined): string {
  if (!url) return "";
  try {
    return new URL(url).hostname.replace(/^www\./, "");
  } catch {
    return "";
  }
}

const SOCIAL = new Set([
  "InstagramPost",
  "InstagramReel",
  "RedditPost",
  "XPost",
  "FacebookReel",
  "TikTokPost",
]);
const VIDEO = new Set(["Video", "YouTubeVideo", "Movie"]);

function join(parts: (string | undefined)[]): string {
  return parts.filter((p) => p && p.trim()).join(" · ");
}

export function describeObject(object: DesignObject): KindDescriptor {
  const type = asFieldString(object.fields.entity_type);
  const creator = asFieldString(object.fields[CREATOR_KEY]);
  const year = asFieldString(object.fields[PUBLISHED_KEY]);
  const price = asFieldString(object.fields[PRICE_KEY]);
  const domain = domainOf(object.sourceUrl);
  const blobType = asFieldString(object.fields[BLOB_TYPE_KEY]);

  if (type === "Note" || (!object.imageUrl && asFieldString(object.fields[NOTE_CONTENT_KEY]))) {
    return { kind: "note", meta: "", affordance: null, portraitCover: false };
  }
  if (type === "Document") {
    // A PDF is a file before it is a picture — say which kind.
    const ext = blobType.split("/").pop()?.toUpperCase() ?? "";
    return { kind: "document", meta: join([ext, creator]), affordance: "file", portraitCover: false };
  }
  if (type === "Book") {
    return { kind: "book", meta: join([creator, year]), affordance: null, portraitCover: true };
  }
  if (type === "MusicAlbum") {
    return { kind: "album", meta: join([creator, year]), affordance: null, portraitCover: false };
  }
  if (type === "Article") {
    return { kind: "article", meta: join([domain, creator]), affordance: null, portraitCover: false };
  }
  if (type === "Product") {
    return { kind: "product", meta: join([creator, price]), affordance: null, portraitCover: false };
  }
  if (SOCIAL.has(type)) {
    const handle = creator ? (creator.startsWith("@") ? creator : `@${creator}`) : "";
    return { kind: "social", meta: join([handle || domain, year]), affordance: null, portraitCover: false };
  }
  if (VIDEO.has(type)) {
    return { kind: "video", meta: domain, affordance: "play", portraitCover: false };
  }
  if (type === "WebPage" || type === "Bookmark") {
    return { kind: "link", meta: domain, affordance: null, portraitCover: false };
  }
  // Image, Screenshot, Placeholder, anything new: the picture speaks for
  // itself. A source domain is still worth saying when there is one.
  return { kind: "image", meta: type === "Screenshot" ? "" : domain, affordance: null, portraitCover: false };
}
