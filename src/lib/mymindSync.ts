import type { DesignObject } from "../types";

// ---------------------------------------------------------------------------
// Raw mymind object shape, per mymind's documented Object model.
// ---------------------------------------------------------------------------
type RawMymindTag = { id?: string; name: string; flags: number };
type RawMymindEmbedding = { id: string; vector: number[]; modelId: number };

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
};

/** mymind-owned metadata keys — refreshed from every sync. Everything else
 * in `fields` is user-entered (facet schema values) and must survive a
 * resync; see the merge in store.ts's syncMymindObjects. */
export const MYMIND_OWNED_FIELD_KEYS = [
  "mymind_id",
  "source_url",
  "summary",
  "created",
  "modified",
  "bumped",
  "entity_type",
] as const;

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
    tags.push(t.name);
    tagFlags[t.name.trim().toLowerCase()] = t.flags ?? 0;
  }

  const sourceUrl = raw.source?.url;
  const embedding = raw.embeddings?.[0]?.vector;

  return {
    id: raw.id,
    title: raw.title?.trim() || "Untitled",
    // Containment-box size keeps grid thumbnails ~tens of KB instead of
    // full-resolution originals — with thousands of cards this is the
    // difference between a snappy grid and megabytes per screenful.
    imageUrl: `/api/mymind/image/${raw.id}?size=512x512`,
    tags,
    fields: {
      mymind_id: raw.id,
      ...(sourceUrl ? { source_url: sourceUrl } : {}),
      ...(raw.summary ? { summary: raw.summary } : {}),
      ...(raw.created ? { created: raw.created } : {}),
      ...(raw.modified ? { modified: raw.modified } : {}),
      ...(raw.bumped ? { bumped: raw.bumped } : {}),
      ...(raw.entityType ? { entity_type: raw.entityType } : {}),
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
