const BASE_URL = "https://api.are.na/v3";
const USER_AGENT = "the-organizer/0.1 (local dev proxy)";

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
      // Attribution (v3 spec) — set when `value` is the object's own
      // image but it was itself saved FROM somewhere else, so the
      // original page stays reachable from the block instead of only the
      // bare image.
      ...(originalSourceUrl ? { original_source_url: originalSourceUrl } : {}),
      ...(metadata && Object.keys(metadata).length > 0 ? { metadata } : {}),
      channel_ids: [channelId],
    }),
  });
}
