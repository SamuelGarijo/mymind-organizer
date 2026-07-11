import type { DesignObject } from "../types";

// ---------------------------------------------------------------------------
// Raw mymind object shape, per mymind's documented Object model.
// ---------------------------------------------------------------------------
type RawMymindTag = { id?: string; name: string; flags: number };
type RawMymindEmbedding = { id: string; vector: number[]; modelId: number };
/** `body` is a plain string for text/markdown content, or a ProseMirror
 * doc object for application/prose+json — mymind stores notes as Prose
 * internally and returns them that way regardless of what format they were
 * created with, per the docs. See proseToPlainText below. */
type RawMymindNote = { id: string; content?: { type: string; body: unknown } };

type RawMymindObject = {
  id: string;
  title: string;
  summary?: string;
  tags: RawMymindTag[];
  source?: { url: string };
  entityType?: string;
  created: string;
  modified: string;
  /** mymind's own "resurface to top" timestamp — distinct from `modified`,
   * which also bumps on incidental changes (e.g. background AI tagging).
   * Only `bumped` reflects an intentional bump/re-save. */
  bumped?: string;
  embeddings?: RawMymindEmbedding[];
  /** Up to 100 per object per mymind's API, but only notes[0] is surfaced
   * anywhere (in mymind's own app, and here) — see DESCRIPTION_KEY below. */
  notes?: RawMymindNote[];
  /** Only present for objects backed by an uploaded attachment (image,
   * video, PDF) — its `type` (a real MIME type, e.g. "image/jpeg") is what
   * tells us a downloadable original exists at all, and what to name/
   * extension the download as. Not present for link/article-type objects,
   * which have no uploaded blob to fetch. `width`/`height` (confirmed
   * empirically present on real image blobs, 2026-07-08) are the real pixel
   * dimensions — used for BLOB_ASPECT_KEY, the masonry grid's height
   * estimate (see lib/masonry.ts). */
  blob?: { type?: string; path?: string; width?: number; height?: number };
  /** The object's OWN primary body — distinct from `notes[]` (a secondary
   * annotation slot attachable to any object, always empty for a real
   * mymind Note). For entityType "Note" this is the actual written text;
   * confirmed empirically (2026-07-08) against real Note objects where
   * `notes` was `[]` and this held the real ProseMirror content. Same
   * `{type, body}` shape as RawMymindNote.content, reuses extractNoteText. */
  content?: { type: string; body: unknown };
};

/** Where our local "description" field lives once synced from/to mymind:
 * mymind's own notes[0] on the object (see mymindWrite.ts for the write
 * side). Exported so DetailPanel reads/writes the same key. */
export const DESCRIPTION_KEY = "description";
/** The mymind note id backing DESCRIPTION_KEY, once one exists — needed to
 * PUT (update in place) instead of POST (create a second note) on a later
 * edit. Absent until the first push creates one. */
export const NOTE_ID_KEY = "mymind_note_id";
/** The uploaded attachment's real MIME type (e.g. "image/jpeg"), when the
 * object has one — read-only, straight from mymind's `blob.type`. Its mere
 * presence is what tells DetailPanel a downloadable original exists at all
 * (see lib/downloadFilename.ts), and what extension to give the download. */
export const BLOB_TYPE_KEY = "mymind_blob_type";
/** The object's real primary body (e.g. a Note's actual written text) —
 * read from mymind's own `content` field, written back via
 * `PUT /objects/:id/content` (see mymindWrite.ts's updateMymindContent).
 * Deliberately NOT in MYMIND_OWNED_FIELD_KEYS, same reasoning as
 * DESCRIPTION_KEY: an edit the user just typed but hasn't pushed yet must
 * survive a resync that hasn't seen it. */
export const NOTE_CONTENT_KEY = "mymind_note_content";
/** Real width/height ratio of an image blob (e.g. "0.4615" for a
 * 1080x2340 portrait photo) — read-only, straight from mymind's
 * `blob.width`/`blob.height`. Lets the masonry grid (lib/masonry.ts)
 * estimate a card's rendered height without measuring the DOM or waiting
 * for the image to load. Absent for non-image objects and for anything
 * synced before this field existed (falls back to a square-ish default). */
export const BLOB_ASPECT_KEY = "mymind_blob_aspect";

/**
 * entityTypes empirically confirmed to have NO working image endpoint at
 * all in mymind's API — `/objects/:id/thumbnail` returns 404 for every
 * object of these types (sample sizes noted per group below). Three
 * distinct reasons land a type here — see docs/mymind-api.md for the PDF/doc
 * parity audit this was found in (2026-07-08):
 *
 * - InstagramPost/XPost/FacebookReel/RedditPost/MusicAlbum/Placeholder
 *   (tested against 6 real InstagramPost objects, plus one of each other
 *   type): their actual media lives in `entities[].attachments[]`
 *   (undocumented at the time of writing), which has no fetchable URL yet.
 *   mymind's team confirmed (Discord, 2026-07-07) a new API for this is in
 *   their backlog — no ETA. See issue #72 — remove a type once it starts
 *   working.
 * - Note/Content (tested 13+4 real objects respectively, 0 had a `blob`):
 *   there's simply no image to have — the real content is text, in the
 *   `content` field (see NOTE_CONTENT_KEY), not an uploaded attachment.
 * - Document (tested 13 real PDF objects, all 404): DOES have a real
 *   downloadable original (`blob`, `application/pdf` — see BLOB_TYPE_KEY and
 *   DetailPanel's "Download original" button), just no working preview
 *   thumbnail. Different underlying reason from the other two groups, same
 *   practical fix — grid falls back to the `summary` text-preview card
 *   instead of a wasted request.
 *
 * Until fixed/inapplicable, don't even attempt a thumbnail request for
 * these: it always fails, and every attempt burns mymind's rate-limited API
 * credits for nothing.
 */
const ENTITY_TYPES_WITHOUT_IMAGE_ACCESS = new Set([
  "InstagramPost",
  "XPost",
  "FacebookReel",
  "RedditPost",
  "MusicAlbum",
  "Placeholder",
  "Note",
  "Content",
  "Document",
]);

/** mymind-owned metadata keys — refreshed from every sync, dropped from
 * `existing.fields` first so a sync that no longer carries one doesn't
 * leave a stale value behind (see the merge in store.ts's
 * syncMymindObjects). Everything else in `fields` is user-entered (facet
 * schema values, and DESCRIPTION_KEY/NOTE_ID_KEY/NOTE_CONTENT_KEY below)
 * and must survive a resync even when mymind's response doesn't mention it.
 *
 * DESCRIPTION_KEY/NOTE_ID_KEY/NOTE_CONTENT_KEY are deliberately NOT in this
 * list, even though they originate from mymind once pushed:
 * `mapMymindObjectToDesignObject` only includes them in `obj.fields` when
 * mymind actually has a value for that object. If they were "owned", a
 * sync would drop an edit the user just typed but hasn't been pushed to
 * mymind yet (obj.fields lacks the key, so it'd never survive the
 * strip-then-overlay merge) — the exact bug already fixed for tags in #3.
 * Leaving them out of this list means: mymind's copy overwrites the local
 * one whenever mymind has a value (real two-way sync), and an unpushed
 * local edit is simply never touched when mymind doesn't. */
export const MYMIND_OWNED_FIELD_KEYS = [
  "mymind_id",
  "source_url",
  "summary",
  "created",
  "modified",
  "bumped",
  "entity_type",
  BLOB_TYPE_KEY,
  BLOB_ASPECT_KEY,
] as const;

/** ProseMirror doc node — minimal shape, just enough to flatten to plain
 * text. Only ever needs to round-trip content this app itself wrote (plain
 * paragraphs, no marks/tables/etc.), so this doesn't attempt a full Prose
 * parser — a note written richly directly in mymind will still show its
 * text, just without formatting, which is fine for a plain <textarea>. */
type ProseNode = { type: string; text?: string; content?: ProseNode[] };
const PROSE_BLOCK_TYPES = new Set(["paragraph", "heading", "listItem", "blockquote", "codeBlock"]);

function proseToPlainText(node: ProseNode): string {
  if (node.type === "text") return node.text ?? "";
  const children = (node.content ?? []).map(proseToPlainText).join("");
  return PROSE_BLOCK_TYPES.has(node.type) ? children + "\n" : children;
}

/** Extracts plain text from a note's content, whichever format mymind
 * happens to return it in. */
function extractNoteText(content?: { type: string; body: unknown }): string {
  if (!content) return "";
  if (typeof content.body === "string") return content.body;
  try {
    return proseToPlainText(content.body as ProseNode).trim();
  } catch {
    return "";
  }
}

/** RFC 9457 problem+json body. Branch on `type` (a stable PascalCase
 * identifier), never on `detail` (human prose that can reword). */
export type MymindProblem = {
  type: string;
  status?: number;
  detail?: string;
  title?: string;
};

export class MymindSyncError extends Error {
  status: number;
  problem: MymindProblem | null;
  constructor(status: number, problem: MymindProblem | null) {
    super(problem?.title ?? problem?.detail ?? `mymind sync failed (${status})`);
    this.name = "MymindSyncError";
    this.status = status;
    this.problem = problem;
  }
}

/**
 * Maps a raw mymind object into our DesignObject shape.
 *
 * - tags[] maps directly, 1:1 — no translation, since our own model already
 *   treats tags as the universal concept.
 * - tagGroups is deliberately NEVER touched here — groups are a purely
 *   local Organizer concept the user assigns by hand; a synced tag always
 *   starts ungrouped, even if it's named "Swiss".
 * - mymind's id becomes our own `id` directly (also duplicated into
 *   fields.mymind_id per spec) so re-syncing naturally upserts instead of
 *   duplicating, via the store's existing merge-by-id logic.
 * - Image is always the real `/objects/:id/thumbnail` endpoint via our
 *   proxy — no guessing at blob/screenshot field shapes.
 * - embedding is only present when the sync explicitly requested
 *   `include=embeddings`; the store's merge preserves a previously-fetched
 *   embedding if a later sync didn't ask for one.
 */
export function mapMymindObjectToDesignObject(raw: RawMymindObject): DesignObject {
  const now = new Date().toISOString();
  const tags: string[] = [];
  const tagFlags: Record<string, number> = {};

  for (const t of raw.tags ?? []) {
    if (!t?.name) continue;
    // mymind can legitimately list the same tag name twice as distinct tag
    // objects (e.g. AI-suggested and manually confirmed) — confirmed
    // empirically against the real backup (10+ objects hit this in a
    // partial scan). Left undeduped, the repeated string broke every place
    // that keys off a tag's name (React list keys in Card/DetailPanel,
    // `tags.includes()` checks elsewhere) — dedupe here once, at the
    // source, rather than patching every consumer.
    if (!tags.includes(t.name)) tags.push(t.name);
    // Combine flags across duplicate entries (bitwise OR) instead of
    // letting whichever one is last silently win.
    const key = t.name.trim().toLowerCase();
    tagFlags[key] = (tagFlags[key] ?? 0) | (t.flags ?? 0);
  }

  const sourceUrl = raw.source?.url;
  const embedding = raw.embeddings?.[0]?.vector;
  // Only notes[0] is surfaced — see the RawMymindObject.notes comment.
  const note = raw.notes?.[0];
  const description = note ? extractNoteText(note.content) : "";
  const noteContent = raw.content ? extractNoteText(raw.content) : "";

  const hasKnownImageAccess =
    !raw.entityType || !ENTITY_TYPES_WITHOUT_IMAGE_ACCESS.has(raw.entityType);

  return {
    id: raw.id,
    title: raw.title?.trim() || "Untitled",
    // Containment-box size keeps grid thumbnails ~tens of KB instead of
    // full-resolution originals — with thousands of cards this is the
    // difference between a snappy grid and megabytes per screenful.
    // Empty for ENTITY_TYPES_WITHOUT_IMAGE_ACCESS — see that constant's
    // comment; the request would just 404 anyway.
    imageUrl: hasKnownImageAccess ? `/api/mymind/image/${raw.id}?size=512x512` : "",
    tags,
    fields: {
      mymind_id: raw.id,
      ...(sourceUrl ? { source_url: sourceUrl } : {}),
      ...(raw.summary ? { summary: raw.summary } : {}),
      ...(raw.created ? { created: raw.created } : {}),
      ...(raw.modified ? { modified: raw.modified } : {}),
      ...(raw.bumped ? { bumped: raw.bumped } : {}),
      ...(raw.entityType ? { entity_type: raw.entityType } : {}),
      ...(description ? { [DESCRIPTION_KEY]: description } : {}),
      ...(note ? { [NOTE_ID_KEY]: note.id } : {}),
      ...(raw.blob?.type ? { [BLOB_TYPE_KEY]: raw.blob.type } : {}),
      ...(raw.blob?.width && raw.blob?.height
        ? { [BLOB_ASPECT_KEY]: String(raw.blob.width / raw.blob.height) }
        : {}),
      ...(noteContent ? { [NOTE_CONTENT_KEY]: noteContent } : {}),
    },
    manualCollectionIds: [],
    sourceUrl,
    createdAt: now,
    updatedAt: now,
    tagFlags,
    source: "mymind",
    ...(embedding ? { embedding } : {}),
  };
}

type FetchPageParams = { spaceId?: string; limit: number; includeEmbeddings?: boolean };

async function fetchRawPage({
  spaceId,
  limit,
  includeEmbeddings,
}: FetchPageParams): Promise<{ raw: RawMymindObject[]; truncated: boolean }> {
  const search = new URLSearchParams();
  if (spaceId) search.set("spaceId", spaceId);
  search.set("limit", String(limit));
  if (includeEmbeddings) search.set("include", "embeddings");

  const res = await fetch(`/api/mymind/objects?${search.toString()}`);
  if (!res.ok) {
    let problem: MymindProblem | null = null;
    try {
      problem = await res.json();
    } catch {
      // non-JSON error body; status still carries the failure
    }
    throw new MymindSyncError(res.status, problem);
  }

  const raw: RawMymindObject[] = await res.json();
  return { raw, truncated: res.headers.get("X-Organizer-Truncated") === "true" };
}

export type SyncResult = {
  objects: DesignObject[];
  /** How many of `objects` are actually new-or-changed vs. what's already
   * stored locally — what "X new items synced" should report. */
  newOrChangedCount: number;
  truncated: boolean;
  /** True if the incremental boundary was never found (first-ever sync, or
   * the ordering assumption below didn't hold) — every fetched object was
   * treated as new-or-changed, same outcome as a full sync. */
  scannedFullLibrary: boolean;
};

const INITIAL_BATCH = 200;
const BATCH_GROWTH = 5;
const HARD_MAX = 10000;

/**
 * Incremental sync: fetches only what's *new* since the last sync, instead
 * of re-diffing the whole library on every click.
 *
 * UNDOCUMENTED BEHAVIOR — READ BEFORE TOUCHING, CORRECTED 2026-07-05:
 * `GET /objects` (no `q`) returns a fixed default order that is NOT part of
 * mymind's published contract and could change without notice. The 2026-07-
 * 04 note here claimed that order was newest-first by `modified`, verified
 * by watching two freshly-created test objects land at the top. That test
 * couldn't actually distinguish `created`-order from `modified`-order,
 * because for a brand-new object those two timestamps are the same instant.
 *
 * Re-verified 2026-07-05 against the full real library (8019 objects, no
 * filters): checking every adjacent pair for a descending violation gave
 * `created` 20 violations vs. `modified` 1579 violations. The default order
 * tracks `created`, not `modified` — explicit `sort=`/`orderBy=` query
 * params were also probed and are silently ignored, so there's no way to
 * request modified-order directly.
 *
 * Consequence: `created` never changes for a given object, so this
 * boundary-scan can only prove "this object was already known" — it cannot
 * prove "nothing below this point has changed since last sync," because an
 * old object edited/re-tagged today stays exactly where it always was,
 * arbitrarily deep in the list. Incremental sync therefore reliably catches
 * every genuinely NEW object (that part degrades safely, same as before: if
 * the ordering assumption ever fully breaks, `scannedFullLibrary` comes back
 * true and it's equivalent to a full sync, just slower). It does NOT
 * reliably catch an edit to an object mymind already had before — that
 * requires a full resync. This is a real, narrower guarantee than originally
 * documented; if silently-missed edits ever matter, either resync fully on
 * a schedule or re-check for a real modified-order endpoint.
 */
export async function syncIncremental(
  params: { spaceId?: string; includeEmbeddings?: boolean },
  existingObjects: Record<string, DesignObject>
): Promise<SyncResult> {
  let limit = INITIAL_BATCH;
  let raw: RawMymindObject[] = [];
  let truncated = false;
  let boundaryIndex = -1;

  while (true) {
    const page = await fetchRawPage({ ...params, limit });
    raw = page.raw;
    truncated = page.truncated;

    boundaryIndex = raw.findIndex((o) => existingObjects[o.id]?.fields.modified === o.modified);

    const exhaustedEverything = raw.length < limit; // mymind had nothing more to give
    if (boundaryIndex !== -1 || exhaustedEverything || limit >= HARD_MAX) break;
    limit = Math.min(limit * BATCH_GROWTH, HARD_MAX);
  }

  const newOrChangedRaw = boundaryIndex === -1 ? raw : raw.slice(0, boundaryIndex);
  const objects = newOrChangedRaw.map(mapMymindObjectToDesignObject);

  return {
    objects,
    newOrChangedCount: objects.length,
    // "truncated" should only ever mean "there's more out there we didn't
    // get to see". Once the boundary is found, the sync is complete by
    // construction — everything past it is already known — regardless of
    // whether that particular page happened to be exactly `limit` long.
    truncated: boundaryIndex === -1 && truncated,
    scannedFullLibrary: boundaryIndex === -1,
  };
}

/** Explicit full resync — fetches and refreshes everything regardless of
 * what's already stored. Always available as a fallback/sanity-check even
 * though incremental sync is the default. */
export async function syncFull(params: {
  spaceId?: string;
  includeEmbeddings?: boolean;
}): Promise<SyncResult> {
  const { raw, truncated } = await fetchRawPage({ ...params, limit: HARD_MAX });
  const objects = raw.map(mapMymindObjectToDesignObject);
  return { objects, newOrChangedCount: objects.length, truncated, scannedFullLibrary: true };
}

export type DeletionCheckResult = {
  /** Every object id mymind currently has — absence from this set is what
   * marks a locally-known mymind object as deleted there. */
  presentIds: Set<string>;
  /** True if mymind didn't return everything (hit HARD_MAX). Callers MUST
   * skip reconciliation when this is true — a partial id set would treat
   * every object mymind just didn't get around to listing as "deleted",
   * exactly the false-positive risk flagged in issue #29. */
  truncated: boolean;
};

/**
 * Fetches just the set of ids mymind currently has — used to detect objects
 * deleted in mymind so the local mirror doesn't keep showing them forever
 * (see store.ts's reconcileMymindDeletions). mymind has no dedicated
 * "current ids" or "deletions" endpoint, so this reuses the same raw fetch
 * as a full sync and discards everything except `id`. Cheap relative to a
 * user-facing Full resync: same one network request, just never mapped or
 * merged into the store — this only ever removes, never touches fields.
 */
export async function fetchAllMymindIds(params: {
  spaceId?: string;
}): Promise<DeletionCheckResult> {
  const { raw, truncated } = await fetchRawPage({ ...params, limit: HARD_MAX });
  return { presentIds: new Set(raw.map((o) => o.id)), truncated };
}

/** Turns a sync failure into a message worth showing the user — branches on
 * the RFC 9457 `type` field (a stable machine key), never on `detail`
 * (human prose that can reword without notice). */
export function describeMymindError(err: unknown): string {
  if (err instanceof MymindSyncError) {
    switch (err.problem?.type) {
      case "Unauthorized":
        return "mymind rejected the request — check MYMIND_KID / MYMIND_SECRET in your .env file.";
      case "Forbidden":
        return "This access key doesn't have permission for that request (check its access level and scope).";
      case "NotFound":
        return "That space wasn't found — double-check the Space ID.";
      case "RateLimited":
        return "mymind is rate-limiting requests right now — wait a moment and try again.";
      case "BadRequest":
        return "The request was malformed — this is likely a bug in the proxy, not your data.";
      case "Unprocessable":
        return "mymind rejected the request as invalid.";
      case "InternalServerError":
        return "mymind had an internal error — safe to try again.";
      case "Unavailable":
        return "mymind is temporarily unavailable — try again shortly.";
      default:
        return (
          err.problem?.title ??
          err.problem?.detail ??
          `mymind sync failed (${err.status}).`
        );
    }
  }
  if (err instanceof TypeError) {
    return "Couldn't reach the local proxy server — make sure it's running (npm run server).";
  }
  return err instanceof Error ? err.message : "Something went wrong syncing from mymind.";
}
