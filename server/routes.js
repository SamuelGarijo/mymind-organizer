import express from "express";
import { Readable } from "node:stream";
import {
  addTag,
  createNote,
  fetchObjects,
  getMymindResource,
  MymindApiError,
  updateContent,
  updateNote,
} from "./mymindClient.js";

export const router = express.Router();

function sendError(res, err) {
  if (err instanceof MymindApiError) {
    res
      .status(err.status)
      .json(err.problem ?? { type: "UpstreamError", status: err.status, detail: err.message });
    return;
  }
  console.error("[mymind proxy]", err);
  res.status(500).json({ type: "InternalError", status: 500, detail: err.message });
}

// GET /api/mymind/objects?spaceId=&q=&limit=
// Relays to mymind's GET /objects, signed per-request. There's no
// pagination on this endpoint — `limit` (capped at 10000 by mymind) is the
// whole mechanism, so we just surface whether the result looks truncated.
router.get("/objects", async (req, res) => {
  try {
    const { spaceId, q, limit, include } = req.query;
    const { objects, truncated } = await fetchObjects({
      spaceId: typeof spaceId === "string" ? spaceId : undefined,
      q: typeof q === "string" ? q : undefined,
      limit: limit ? Number(limit) : undefined,
      include: typeof include === "string" ? include : undefined,
    });
    if (truncated) res.setHeader("X-Organizer-Truncated", "true");
    res.json(objects);
  } catch (err) {
    sendError(res, err);
  }
});

// POST /api/mymind/objects/:id/tags  { name: string }
// Adds a single manual tag — never DELETE, never PATCH.
router.post("/objects/:id/tags", async (req, res) => {
  const { id } = req.params;
  const name = typeof req.body?.name === "string" ? req.body.name.trim() : "";
  if (!name) {
    res.status(400).json({ type: "BadRequest", status: 400, detail: "`name` is required" });
    return;
  }
  try {
    const tag = await addTag(id, name);
    res.status(201).json(tag);
  } catch (err) {
    sendError(res, err);
  }
});

// POST /api/mymind/objects/:id/notes  { body: string }
// Creates a new note on the object (mymind's write path for our local
// "description" field). Body is plain markdown, wrapped in JSON here for a
// consistent request shape across this proxy's own routes — translated to
// mymind's expected `text/markdown` request in mymindClient.js.
router.post("/objects/:id/notes", async (req, res) => {
  const { id } = req.params;
  const body = typeof req.body?.body === "string" ? req.body.body : "";
  try {
    const note = await createNote(id, body);
    res.status(201).json(note);
  } catch (err) {
    sendError(res, err);
  }
});

// PUT /api/mymind/objects/:id/notes/:noteId  { body: string }
// Replaces an existing note's body — used once an object already has a
// note id, so an edit updates it in place instead of creating a second
// note. Never DELETE — clearing the description sends an empty body here.
router.put("/objects/:id/notes/:noteId", async (req, res) => {
  const { id, noteId } = req.params;
  const body = typeof req.body?.body === "string" ? req.body.body : "";
  try {
    await updateNote(id, noteId, body);
    res.status(204).end();
  } catch (err) {
    sendError(res, err);
  }
});

// PUT /api/mymind/objects/:id/content  { body: string }
// Replaces a Note's own content — the write path for NOTE_CONTENT_KEY.
// Never DELETE, never PATCH. mymind returns 422 if the object isn't a Note;
// the app only ever shows this editor for entity_type "Note" objects, so
// that's a backstop, not the primary guard.
router.put("/objects/:id/content", async (req, res) => {
  const { id } = req.params;
  const body = typeof req.body?.body === "string" ? req.body.body : "";
  try {
    await updateContent(id, body);
    res.status(204).end();
  } catch (err) {
    sendError(res, err);
  }
});

// Strips characters that'd break a Content-Disposition header value (quotes,
// control chars) — the filename itself is already sanitized client-side
// (lib/downloadFilename.ts) before it ever gets here, this is just a second,
// server-side backstop.
function safeDispositionFilename(name) {
  return name.replace(/["\r\n]/g, "").slice(0, 200);
}

// HTTP headers are ASCII-only — a non-ASCII title (Hungarian, accents, etc.)
// in a plain `filename="..."` either breaks or gets mangled by picky
// clients. RFC 6266 fixes this with a second, percent-encoded UTF-8 param
// that modern browsers prefer; `filename=` stays as an ASCII-stripped
// fallback for anything that doesn't understand filename*.
function contentDispositionHeader(rawFilename) {
  const safe = safeDispositionFilename(rawFilename);
  // eslint-disable-next-line no-control-regex
  const asciiFallback = safe.replace(/[^\x20-\x7e]/g, "").trim() || "download";
  const encoded = encodeURIComponent(safe);
  return `attachment; filename="${asciiFallback}"; filename*=UTF-8''${encoded}`;
}

// Shared by /image and /blob below — both just relay a binary mymind
// response (following any redirect to a signed CDN URL) through to the
// browser same-origin, so there's no CORS/redirect handling needed client-side.
//
// `contentType`, when given, OVERRIDES whatever upstream reports. This is
// necessary, not cosmetic: empirically, mymind's CDN sometimes reports the
// wrong Content-Type for a blob (observed `application/json` on a response
// whose body was a genuine JPEG, confirmed by inspecting the raw bytes) —
// so for /blob specifically, the object's own `blob.type` (captured at
// sync time, see mymindSync.ts's BLOB_TYPE_KEY) is more trustworthy than
// the CDN response header for that same request.
//
// `filename`, when given, sets Content-Disposition so a direct link/fetch
// (not just an <a download> attribute) still prompts a save-as with a
// sensible name instead of mymind's CDN's bare/wrong content type.
async function relayBinary(res, pathname, searchParams, { filename, contentType } = {}) {
  try {
    const upstream = await getMymindResource(pathname, searchParams);

    if (!upstream.ok || !upstream.body) {
      res.status(upstream.status).end();
      return;
    }

    res.status(200);
    res.setHeader(
      "Content-Type",
      contentType || upstream.headers.get("content-type") || "application/octet-stream"
    );
    const cacheControl = upstream.headers.get("cache-control");
    if (cacheControl) res.setHeader("Cache-Control", cacheControl);
    if (filename) res.setHeader("Content-Disposition", contentDispositionHeader(filename));

    Readable.fromWeb(upstream.body).pipe(res);
  } catch (err) {
    console.error("[mymind proxy] binary relay failed", err);
    res.status(502).json({ type: "BadGateway", status: 502, detail: String(err) });
  }
}

// GET /api/mymind/image/:id?size=WxH
// Relays to mymind's GET /objects/:id/thumbnail. `size` is optional — pass
// none for mymind's own default pre-rendered thumbnail (a step up from the
// grid's deliberately small `size=` requests, but still a re-encoded
// derivative, not the original — see /blob below for that).
router.get("/image/:id", async (req, res) => {
  const { id } = req.params;
  const size = typeof req.query.size === "string" ? req.query.size : undefined;
  await relayBinary(res, `/objects/${id}/thumbnail`, { size });
});

// GET /api/mymind/blob/:id?filename=&type=
// Relays to mymind's GET /objects/:id/blob — the original uploaded bytes,
// no transcoded variant. Only exists for objects with a single uploaded
// attachment; mymind 422s for anything else (saved web pages, etc.), which
// passes straight through so the client can fall back to a thumbnail.
// `filename` sets Content-Disposition for the download button; `type`
// overrides Content-Type with the object's real known MIME type (see
// contentType comment on relayBinary above for why that's needed).
router.get("/blob/:id", async (req, res) => {
  const { id } = req.params;
  const filename = typeof req.query.filename === "string" ? req.query.filename : undefined;
  const contentType = typeof req.query.type === "string" ? req.query.type : undefined;
  await relayBinary(res, `/objects/${id}/blob`, {}, { filename, contentType });
});
