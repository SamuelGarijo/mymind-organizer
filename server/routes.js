import express from "express";
import { Readable } from "node:stream";
import { addTag, fetchObjects, getMymindResource, MymindApiError } from "./mymindClient.js";

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
// The one write operation this proxy performs. Adds a single manual tag —
// never DELETE, never PATCH, never a content write.
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

// GET /api/mymind/image/:id?size=WxH
// Relays to mymind's GET /objects/:id/thumbnail, which may 302 to a
// signed CDN URL — fetched server-side so redirects and any CORS
// restriction are handled same-origin instead of directly in the browser.
router.get("/image/:id", async (req, res) => {
  const { id } = req.params;
  const size = typeof req.query.size === "string" ? req.query.size : undefined;

  try {
    const upstream = await getMymindResource(`/objects/${id}/thumbnail`, { size });

    if (!upstream.ok || !upstream.body) {
      res.status(upstream.status).end();
      return;
    }

    res.status(200);
    res.setHeader(
      "Content-Type",
      upstream.headers.get("content-type") ?? "application/octet-stream"
    );
    const cacheControl = upstream.headers.get("cache-control");
    if (cacheControl) res.setHeader("Cache-Control", cacheControl);

    Readable.fromWeb(upstream.body).pipe(res);
  } catch (err) {
    console.error("[mymind proxy] image relay failed", err);
    res.status(502).json({ type: "BadGateway", status: 502, detail: String(err) });
  }
});
