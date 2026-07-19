import { DESCRIPTION_KEY, NOTE_CONTENT_KEY, asFieldString } from "./mymindSync";
import type { DesignObject } from "../types";

/** Are.na visibility values (v3 API) — "closed" is Are.na's own default:
 * link-only, not publicly listed. */
export type ArenaVisibility = "public" | "closed" | "private";

export type ArenaChannel = { id: number; slug: string; title: string };

type BlockDraft = {
  value: string;
  title: string;
  description?: string;
  originalSourceUrl?: string;
  metadata?: Record<string, string>;
};

/**
 * Translates one local object into an Are.na block draft. Are.na's `value`
 * field is the one thing that decides block type server-side — a URL
 * infers Image/Link/Embed, plain text becomes a Text block — so the
 * priority order here mirrors Card.tsx's own image-vs-text-only
 * distinction: a real image URL first, then an external source link, then
 * whatever text content the object actually has, so nothing exports empty.
 *
 * Are.na blocks only carry title/description/alt_text as real fields
 * (confirmed against the live v3 OpenAPI spec) — `metadata` is a generic
 * custom key/value store the API accepts but Are.na's own UI never
 * renders, used here as a lossless-but-invisible home for local tags/role
 * that would otherwise have nowhere to go.
 */
export function objectToArenaBlock(
  object: DesignObject,
  opts: { includeMetadata: boolean }
): BlockDraft {
  const textContent =
    asFieldString(object.fields[NOTE_CONTENT_KEY]) || asFieldString(object.fields.summary);
  const value = object.imageUrl || object.sourceUrl || textContent || object.title;
  const description =
    asFieldString(object.fields[DESCRIPTION_KEY]) || asFieldString(object.fields.summary) || undefined;
  // Attribution: only meaningful when the block's value is the image
  // itself but the object ALSO has a source page it was saved from —
  // otherwise sourceUrl IS the value already, and repeating it here would
  // be redundant.
  const originalSourceUrl = object.imageUrl && object.sourceUrl ? object.sourceUrl : undefined;

  const draft: BlockDraft = { value, title: object.title, description, originalSourceUrl };

  if (opts.includeMetadata) {
    const metadata: Record<string, string> = {};
    if (object.tags.length > 0) metadata.tags = object.tags.join(", ");
    if (object.role) metadata.role = object.role;
    if (Object.keys(metadata).length > 0) draft.metadata = metadata;
  }
  return draft;
}

async function postJson<T>(path: string, body: unknown): Promise<T> {
  const res = await fetch(path, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  if (!res.ok) {
    const problem = await res.json().catch(() => null);
    throw new Error(problem?.detail || `Request to ${path} failed (${res.status})`);
  }
  return res.json();
}

/** Delay between sequential block-creation calls — Are.na's own guidance
 * for bulk writes ("200-500ms between sequential requests"), and the only
 * safe assumption regardless of account tier (guest tier is as low as
 * 30 req/min; the batch endpoint is Premium+private-channel only, so it
 * can't be assumed available). */
const WRITE_DELAY_MS = 300;

export type ArenaExportProgress = { done: number; total: number; failed: string[] };

/**
 * Creates the channel, then creates one block per object sequentially
 * (each call also connects it into the channel — no separate connection
 * request needed). A single object's failure is collected and skipped,
 * never aborting the whole export — a partial export the user can see and
 * retry is better than an all-or-nothing job losing everything to one bad
 * block.
 */
export async function exportCollectionToArena(
  objects: DesignObject[],
  channelInput: { title: string; description?: string; visibility: ArenaVisibility },
  opts: { includeMetadata: boolean },
  onProgress: (progress: ArenaExportProgress) => void
): Promise<{ channel: ArenaChannel; failed: string[] }> {
  const channel = await postJson<ArenaChannel>("/api/arena/channels", channelInput);

  const failed: string[] = [];
  for (let i = 0; i < objects.length; i++) {
    const object = objects[i];
    const draft = objectToArenaBlock(object, opts);
    try {
      await postJson(`/api/arena/channels/${channel.id}/blocks`, draft);
    } catch (err) {
      failed.push(object.title || object.id);
    }
    onProgress({ done: i + 1, total: objects.length, failed });
    if (i < objects.length - 1) await new Promise((r) => setTimeout(r, WRITE_DELAY_MS));
  }

  return { channel, failed };
}
