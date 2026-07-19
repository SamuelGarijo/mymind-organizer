const BASE_URL = "https://api.are.na/v3";
const USER_AGENT = "the-organizer/0.1 (local dev proxy)";
/** Are.na's own guidance: bare S3 object URL for an uploaded file's `value`
 * is `https://s3.amazonaws.com/arena_images-temp/<key>` (query string
 * stripped) — the presign response's `key` slots straight in here. */
const S3_PUBLIC_BASE = "https://s3.amazonaws.com/arena_images-temp";

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

export class ArenaApiError extends Error {
  constructor(status, body) {
    super(body?.message || body?.error || `Are.na API error (${status})`);
    this.name = "ArenaApiError";
    this.status = status;
    this.body = body;
  }
}

function authHeaders() {
  const token = process.env.ARENA_TOKEN;
  if (!token) {
    throw new ArenaApiError(401, { message: "ARENA_TOKEN is not configured" });
  }
  return {
    Authorization: `Bearer ${token}`,
    "Content-Type": "application/json",
    "User-Agent": USER_AGENT,
  };
}

/**
 * A single retry on 429, honoring `retry_after` (seconds) from the response
 * body per the v3 spec — Are.na's rate limits are modest (30-600 req/min
 * depending on account tier) and a bulk export is many sequential writes,
 * so a transient 429 mid-export is an expected, recoverable case, not an
 * error to surface to the user.
 */
async function arenaFetch(path, options = {}) {
  const res = await fetch(`${BASE_URL}${path}`, {
    ...options,
    headers: { ...authHeaders(), ...(options.headers ?? {}) },
  });

  if (res.status === 429) {
    const body = await res.json().catch(() => null);
    const retryAfterMs = (body?.retry_after ?? 2) * 1000;
    await sleep(retryAfterMs);
    return arenaFetch(path, options);
  }

  if (!res.ok) {
    const body = await res.json().catch(() => null);
    throw new ArenaApiError(res.status, body);
  }

  if (res.status === 204) return null;
  return res.json();
}

/** GET /v3/me — the connected account's identity, so the UI can always show
 * WHOSE Are.na is about to receive an export (never publish blind). `slug`
 * is Are.na's username-equivalent (there's no `username` field). */
export function getMe() {
  return arenaFetch("/me", { method: "GET" });
}

/**
 * The account's own channels, for the single-object "add to which channel?"
 * picker. Are.na has no channel-list endpoint filtered to the user, so this
 * reads GET /v3/users/{slug}/contents (blocks + channels the user created)
 * and keeps only the channels the user can actually add to. Reads only —
 * never writes.
 */
export async function listMyChannels() {
  const me = await getMe();
  const slug = me?.slug ?? me?.id;
  if (!slug) return { channels: [], me };
  // The contents feed mixes blocks and channels, newest-first, paginated
  // ({meta, data}). Channels aren't separable by a type filter, so walk a
  // few pages collecting the Channel items — bounded at 4 pages (≤400
  // recent items) so a huge library can't turn one picker into dozens of
  // requests; the user's active channels are recent by construction.
  const byId = new Map();
  for (let page = 1; page <= 4; page++) {
    const res = await arenaFetch(
      `/users/${encodeURIComponent(slug)}/contents?per=100&page=${page}`,
      { method: "GET" }
    );
    const items = Array.isArray(res?.data) ? res.data : [];
    for (const it of items) {
      if (it?.type === "Channel" && it?.can?.add_to !== false && !byId.has(it.id)) {
        byId.set(it.id, {
          id: it.id,
          slug: it.slug,
          title: it.title,
          visibility: it.visibility,
        });
      }
    }
    if (!res?.meta?.has_more_pages) break;
  }
  return { channels: [...byId.values()], me };
}

/**
 * GET /v3/search — text search over Are.na (v3; requires auth and is
 * currently Premium-gated upstream). Returns the raw {meta, data} page;
 * the route maps it to a compact DTO. A 402/403 from Are.na surfaces as
 * a structured error so the UI can explain the Premium gate instead of
 * failing opaquely.
 */
export function searchArena({ query, type = "Image", page = 1, per = 24 }) {
  const params = new URLSearchParams({
    query,
    type,
    page: String(page),
    per: String(per),
    sort: "score_desc",
  });
  return arenaFetch(`/search?${params}`, { method: "GET" });
}

/**
 * POST /v3/channels — `title` is the only required field. `visibility`
 * defaults to Are.na's own default ("closed" — link-only, not publicly
 * listed) when the caller doesn't specify one.
 */
export function createChannel({ title, description, visibility }) {
  return arenaFetch("/channels", {
    method: "POST",
    body: JSON.stringify({
      title,
      ...(description ? { description } : {}),
      ...(visibility ? { visibility } : {}),
    }),
  });
}

/**
 * POST /v3/blocks — `value` is the one field that decides the block's
 * type: a URL infers Image/Link/Embed server-side, plain text becomes a
 * Text block. `channel_ids` connects it into the channel in the SAME
 * call — no separate connection request needed. `metadata` is Are.na's
 * generic custom key/value store (not shown in Are.na's own UI, but
 * retrievable via the API) — used here to carry local tags/role/facets
 * that have no other home in Are.na's title/description/alt_text fields.
 */
export function createBlock({
  value,
  title,
  description,
  altText,
  channelId,
  metadata,
  originalSourceUrl,
}) {
  return arenaFetch("/blocks", {
    method: "POST",
    body: JSON.stringify({
      value,
      ...(title ? { title } : {}),
      ...(description ? { description } : {}),
      ...(altText ? { alt_text: altText } : {}),
      ...(originalSourceUrl ? { original_source_url: originalSourceUrl } : {}),
      ...(metadata && Object.keys(metadata).length > 0 ? { metadata } : {}),
      channel_ids: [channelId],
    }),
  });
}

/**
 * The full upload path for a file whose bytes are NOT publicly reachable by
 * Are.na (every mymind asset — its image/blob URLs sit behind our
 * authenticated proxy). Three steps, per the v3 spec:
 *   1. POST /v3/uploads/presign → a presigned S3 PUT URL + a `key`.
 *   2. PUT the raw bytes to that URL (auth is baked into the query string;
 *      Content-Type must match what we presigned).
 *   3. Create the block with `value` = the bare S3 object URL for that key;
 *      Are.na infers Image vs Attachment from the content type.
 * Steps 1 and 3 count against the Are.na rate limit; step 2 hits S3
 * directly and doesn't.
 */
export async function createBlockFromBytes({
  bytes,
  contentType,
  filename,
  title,
  description,
  altText,
  channelId,
  metadata,
  originalSourceUrl,
}) {
  const presign = await arenaFetch("/uploads/presign", {
    method: "POST",
    body: JSON.stringify({ files: [{ filename, content_type: contentType }] }),
  });
  const file = presign?.files?.[0];
  if (!file?.upload_url || !file?.key) {
    throw new ArenaApiError(502, { message: "Are.na presign returned no upload URL" });
  }

  const put = await fetch(file.upload_url, {
    method: "PUT",
    headers: { "Content-Type": contentType },
    body: bytes,
  });
  if (!put.ok) {
    throw new ArenaApiError(put.status, { message: `S3 upload failed (${put.status})` });
  }

  const value = `${S3_PUBLIC_BASE}/${file.key}`;
  return createBlock({
    value,
    title,
    description,
    altText,
    channelId,
    metadata,
    originalSourceUrl,
  });
}
