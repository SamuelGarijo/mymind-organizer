import { signMymindRequest } from "./auth.js";

const BASE_URL = "https://api.mymind.com";
const USER_AGENT = "the-organizer/0.1 (local dev proxy)";
const MAX_LIMIT = 10000;

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * Parses mymind's `RateLimit` header:
 *   RateLimit: "burst";r=9990;t=300, "sustained";r=99641;t=2589945
 * A comma-separated list of policies, each a quoted name followed by
 * semicolon-delimited key=value params.
 */
function parsePolicies(headerValue) {
  if (!headerValue) return [];
  return headerValue.split(",").map((entry) => {
    const trimmed = entry.trim();
    const nameMatch = /^"([^"]+)"/.exec(trimmed);
    const name = nameMatch ? nameMatch[1] : trimmed.split(";")[0];
    const params = {};
    for (const part of trimmed.split(";").slice(1)) {
      const [key, value] = part.trim().split("=");
      if (key) params[key] = Number(value);
    }
    return { name, ...params };
  });
}

/**
 * Per the docs: "parse the RateLimit header, find every policy with r=0,
 * and sleep until the slowest of those windows resets — the largest t
 * among the exhausted policies." Falls back to Retry-After, then a plain
 * exponential backoff if neither header is present.
 */
function backoffDelayMs(headers, attempt) {
  const exhausted = parsePolicies(headers.get("ratelimit")).filter((p) => p.r === 0);
  if (exhausted.length > 0) {
    const maxT = Math.max(...exhausted.map((p) => p.t ?? 0));
    return maxT * 1000;
  }

  const retryAfter = headers.get("retry-after");
  if (retryAfter) {
    const seconds = Number(retryAfter);
    if (!Number.isNaN(seconds)) return seconds * 1000;
    const date = Date.parse(retryAfter);
    if (!Number.isNaN(date)) return Math.max(0, date - Date.now());
  }

  return 1000 * 2 ** attempt;
}

export class MymindApiError extends Error {
  constructor(status, problem) {
    super(problem?.title || problem?.detail || `mymind API error (${status})`);
    this.name = "MymindApiError";
    this.status = status;
    /** RFC 9457 problem+json body: { type, status, detail }. Branch on
     * `type` (a stable PascalCase identifier), not `detail` (human prose). */
    this.problem = problem;
  }
}

function buildUrl(pathname, searchParams) {
  const url = new URL(pathname, BASE_URL);
  for (const [key, value] of Object.entries(searchParams ?? {})) {
    if (value !== undefined && value !== null && value !== "") {
      url.searchParams.set(key, String(value));
    }
  }
  return url;
}

/** GET a fully-formed mymind URL, retrying on 429 with backoff, throwing
 * MymindApiError (carrying the RFC 9457 body) on any other non-2xx. */
async function getUrl(url) {
  let attempt = 0;
  while (true) {
    const jwt = signMymindRequest("GET", url.pathname);
    const res = await fetch(url, {
      method: "GET",
      headers: {
        Authorization: `Bearer ${jwt}`,
        "User-Agent": USER_AGENT,
        Accept: "application/json",
      },
    });

    if (res.status === 429 && attempt < 4) {
      const delay = backoffDelayMs(res.headers, attempt);
      attempt += 1;
      await sleep(delay);
      continue;
    }

    if (!res.ok) {
      let problem = null;
      try {
        problem = await res.json();
      } catch {
        // non-JSON body; status code still carries the failure
      }
      throw new MymindApiError(res.status, problem);
    }

    return res;
  }
}

/**
 * Fetches objects matching the given filters. `GET /objects` has no
 * pagination — `limit` (default & max 10000, capped at 1000 when `q` is
 * given) is the entire mechanism. Returns `truncated: true` when the
 * result count hits the requested limit exactly, since that's the only
 * signal available that more objects might exist beyond it.
 *
 * `include` passes straight through to mymind (e.g. "embeddings" adds each
 * object's embedding vector — large, so only requested when the frontend
 * explicitly opts in for the "Similar to this" feature).
 */
export async function fetchObjects({ spaceId, q, limit, include }) {
  const effectiveLimit = Math.min(limit ?? MAX_LIMIT, MAX_LIMIT);
  const res = await getUrl(
    buildUrl("/objects", { spaceId, q, limit: effectiveLimit, include })
  );
  const objects = await res.json();
  return {
    objects: Array.isArray(objects) ? objects : [],
    truncated: Array.isArray(objects) && objects.length >= effectiveLimit,
  };
}

/** GET a mymind endpoint by path (e.g. an object's thumbnail), signed and
 * with redirects followed — used by the image relay route. Returns the raw
 * Response so the caller can stream the body through untouched. */
export async function getMymindResource(pathname, searchParams) {
  const url = buildUrl(pathname, searchParams);
  const jwt = signMymindRequest("GET", url.pathname);
  return fetch(url, {
    method: "GET",
    headers: { Authorization: `Bearer ${jwt}`, "User-Agent": USER_AGENT },
    redirect: "follow",
  });
}

/** POSTs a JSON body to a mymind endpoint, signed, with the same 429 backoff
 * as getUrl. */
async function postUrl(url, body) {
  let attempt = 0;
  while (true) {
    const jwt = signMymindRequest("POST", url.pathname);
    const res = await fetch(url, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${jwt}`,
        "User-Agent": USER_AGENT,
        Accept: "application/json",
        "Content-Type": "application/json",
      },
      body: JSON.stringify(body),
    });

    if (res.status === 429 && attempt < 4) {
      const delay = backoffDelayMs(res.headers, attempt);
      attempt += 1;
      await sleep(delay);
      continue;
    }

    if (!res.ok) {
      let problem = null;
      try {
        problem = await res.json();
      } catch {
        // non-JSON error body; status still carries the failure
      }
      throw new MymindApiError(res.status, problem);
    }

    return res;
  }
}

/**
 * Adds a single manual tag to an object — confirmed empirically against a
 * disposable test object: the body key is `name` (singular), not `tags` or
 * `tag`; a successful call returns 201 with `{ id, name, flags }` where
 * flags=8 marks it manual (vs. 2 for AI-generated, per mymind's tag model).
 * This is the one write endpoint the Organizer is allowed to call.
 */
export async function addTag(objectId, name) {
  const url = buildUrl(`/objects/${objectId}/tags`);
  const res = await postUrl(url, { name });
  return res.json();
}

/** Sends a raw (non-JSON) body to a mymind endpoint — used for the
 * notes endpoints, which take `text/markdown` directly rather than a JSON
 * envelope. Same 429 backoff as postUrl/getUrl. */
async function rawBodyRequest(method, url, body, contentType) {
  let attempt = 0;
  while (true) {
    const jwt = signMymindRequest(method, url.pathname);
    const res = await fetch(url, {
      method,
      headers: {
        Authorization: `Bearer ${jwt}`,
        "User-Agent": USER_AGENT,
        Accept: "application/json",
        "Content-Type": contentType,
      },
      body,
    });

    if (res.status === 429 && attempt < 4) {
      const delay = backoffDelayMs(res.headers, attempt);
      attempt += 1;
      await sleep(delay);
      continue;
    }

    if (!res.ok) {
      let problem = null;
      try {
        problem = await res.json();
      } catch {
        // non-JSON error body; status still carries the failure
      }
      throw new MymindApiError(res.status, problem);
    }

    return res;
  }
}

/**
 * Creates a new note on an object (empirically confirmed against a
 * disposable test object) — mymind auto-converts the markdown body to its
 * internal Prose format. Returns `{ id }` for the new note.
 *
 * Deliberately no corresponding delete function: this proxy never issues
 * DELETE against mymind for anything, by explicit instruction — clearing a
 * description replaces the note's body with an empty string instead (see
 * updateNote), it never removes the note object itself.
 */
export async function createNote(objectId, body) {
  const url = buildUrl(`/objects/${objectId}/notes`);
  const res = await rawBodyRequest("POST", url, body, "text/markdown");
  return res.json();
}

/** Replaces an existing note's body in place — idempotent per mymind's
 * docs. Used once an object already has a note id (from a prior create or
 * from a sync that pulled one down) so a later edit updates it instead of
 * creating a second note. */
export async function updateNote(objectId, noteId, body) {
  const url = buildUrl(`/objects/${objectId}/notes/${noteId}`);
  await rawBodyRequest("PUT", url, body, "text/markdown");
}

/**
 * Replaces a Note's own primary content in place — distinct from
 * createNote/updateNote above, which write to the separate `notes[]`
 * annotation array. This is the real write path for a Note object's actual
 * body (per mymind's docs: "replace a Note's full content body"; 422 for
 * any other object type). Idempotent. No id to track in the response —
 * unlike a note, an object's content isn't a separate entity with its own
 * id, so there's nothing to store back locally.
 */
export async function updateContent(objectId, body) {
  const url = buildUrl(`/objects/${objectId}/content`);
  await rawBodyRequest("PUT", url, body, "text/markdown");
}
