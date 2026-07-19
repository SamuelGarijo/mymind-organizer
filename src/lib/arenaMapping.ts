import {
  BLOB_TYPE_KEY,
  DESCRIPTION_KEY,
  NOTE_CONTENT_KEY,
  asFieldString,
} from "./mymindSync";
import type { DesignObject } from "../types";

/**
 * The single, centralized translation layer from an Organizer/mymind object
 * to an Are.na block (Are.na export follow-up #1/#2). Every export path —
 * whole-collection and single-object — routes through `planArenaBlock`, so
 * "how does each type become an Are.na block" is decided in exactly one
 * place, auditable against real object fields.
 *
 * The original bug this fixes: the old code passed `object.imageUrl`
 * (always a LOCAL proxy URL, `/api/mymind/image/...`) as Are.na's `value`.
 * Are.na's servers can't reach that, so every image silently degraded into
 * a Text block containing the proxy URL as literal text. The fix keys off
 * what the object genuinely IS:
 *
 *   - Has real image bytes (mymind blob, image/*)  → Image block (bytes are
 *     fetched server-side from mymind and uploaded to Are.na — never a URL).
 *   - Has a public source URL (article, webpage, social post) → Link block.
 *   - Has a downloadable non-image original (PDF)  → Link if there's a
 *     public source, else an uploaded Attachment block.
 *   - Is text (a note)                              → Text block.
 *   - None of the above                             → Skip, with a reason
 *     surfaced in the export report (never a silently-wrong block).
 */

export type ArenaBlockPlan =
  | {
      kind: "image";
      mymindId: string;
      title: string;
      description?: string;
      altText?: string;
      originalSourceUrl?: string;
      metadata?: Record<string, string>;
    }
  | {
      kind: "attachment";
      mymindId: string;
      title: string;
      description?: string;
      metadata?: Record<string, string>;
    }
  | {
      kind: "link";
      value: string;
      title: string;
      description?: string;
      metadata?: Record<string, string>;
    }
  | {
      kind: "text";
      value: string;
      title: string;
      description?: string;
      metadata?: Record<string, string>;
    }
  | { kind: "skip"; title: string; reason: string };

/** A genuinely public, Are.na-fetchable http(s) URL — explicitly NOT a
 * local proxy path (`/api/...` fails `new URL` as relative) and not
 * localhost, so a local asset can never masquerade as a public one (the
 * whole point of the original bug). */
export function isPublicHttpUrl(value: string | undefined): value is string {
  if (!value) return false;
  try {
    const u = new URL(value);
    return (
      (u.protocol === "http:" || u.protocol === "https:") &&
      u.hostname !== "localhost" &&
      u.hostname !== "127.0.0.1"
    );
  } catch {
    return false;
  }
}

/** Are.na `metadata` keys must be alphanumeric/underscore; values scalar.
 * Carries the local structure that has no home in title/description. */
function buildMetadata(object: DesignObject): Record<string, string> | undefined {
  const metadata: Record<string, string> = {};
  if (object.tags.length > 0) metadata.tags = object.tags.join(", ");
  if (object.role) metadata.role = object.role;
  const entityType = asFieldString(object.fields.entity_type);
  if (entityType) metadata.entity_type = entityType;
  const mymindId = asFieldString(object.fields.mymind_id);
  if (mymindId) metadata.organizer_mymind_id = mymindId;
  return Object.keys(metadata).length > 0 ? metadata : undefined;
}

export function planArenaBlock(
  object: DesignObject,
  opts: { includeMetadata: boolean }
): ArenaBlockPlan {
  const blobType = asFieldString(object.fields[BLOB_TYPE_KEY]);
  const sourceUrl = object.sourceUrl || asFieldString(object.fields.source_url);
  const text = (
    asFieldString(object.fields[NOTE_CONTENT_KEY]) || asFieldString(object.fields.summary)
  ).trim();
  const description =
    asFieldString(object.fields[DESCRIPTION_KEY]) ||
    asFieldString(object.fields.summary) ||
    undefined;
  const isMymind = object.source === "mymind" || !!asFieldString(object.fields.mymind_id);
  const metadata = opts.includeMetadata ? buildMetadata(object) : undefined;
  const base = { title: object.title, description, metadata };
  const publicSource = isPublicHttpUrl(sourceUrl) ? sourceUrl : undefined;

  // 1. Real image with fetchable original bytes → Image block (upload).
  if (isMymind && blobType.startsWith("image/")) {
    return {
      kind: "image",
      mymindId: object.id,
      altText: object.title,
      originalSourceUrl: publicSource,
      ...base,
    };
  }

  // 2. A PDF (downloadable original, no image) → prefer the public source
  //    page as a Link (lighter, richer preview); else upload the file.
  if (isMymind && blobType === "application/pdf") {
    if (publicSource) return { kind: "link", value: publicSource, ...base };
    return { kind: "attachment", mymindId: object.id, ...base };
  }

  // 3. Anything with a public source URL (article, webpage, social post,
  //    video with a real page) → Link block. Covers the mymind types that
  //    have no fetchable media of their own but do carry a source.
  if (publicSource) return { kind: "link", value: publicSource, ...base };

  // 4. A non-mymind object whose imageUrl is itself genuinely public (e.g.
  //    a sample/imported object) → Link; Are.na infers the image.
  if (isPublicHttpUrl(object.imageUrl)) return { kind: "link", value: object.imageUrl, ...base };

  // 5. Real text content → Text block.
  if (text) return { kind: "text", value: text, ...base };

  // 6. Nothing exportable faithfully.
  const entityType = asFieldString(object.fields.entity_type);
  const reason = entityType
    ? `${entityType} has no fetchable media, public URL, or text to export`
    : "no image, public URL, or text to export";
  return { kind: "skip", title: object.title, reason };
}

/** Short human label for a plan — used in the export report. */
export function planKindLabel(plan: ArenaBlockPlan): string {
  switch (plan.kind) {
    case "image":
      return "image";
    case "attachment":
      return "file";
    case "link":
      return "link";
    case "text":
      return "text";
    case "skip":
      return "skipped";
  }
}
