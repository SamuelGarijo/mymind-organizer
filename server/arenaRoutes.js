import express from "express";
import {
  ArenaApiError,
  createBlock,
  createBlockFromBytes,
  createChannel,
  getMe,
  listMyChannels,
} from "./arenaClient.js";
import { getMymindResource } from "./mymindClient.js";

export const arenaRouter = express.Router();

function sendError(res, err) {
  if (err instanceof ArenaApiError) {
    res.status(err.status).json({ type: "UpstreamError", status: err.status, detail: err.message });
    return;
  }
  console.error("[are.na proxy]", err);
  res.status(500).json({ type: "InternalError", status: 500, detail: err.message });
}

// GET /api/arena/me — connected account identity (slug/name/avatar), so the
// UI can always show whose Are.na an export will land in.
arenaRouter.get("/me", async (_req, res) => {
  try {
    const me = await getMe();
    res.json({ id: me.id, slug: me.slug, name: me.name, avatar: me.avatar ?? null });
  } catch (err) {
    sendError(res, err);
  }
});

// GET /api/arena/channels — the account's own channels, for the
// single-object "add to which channel?" picker.
arenaRouter.get("/channels", async (_req, res) => {
  try {
    const { channels } = await listMyChannels();
    res.json({ channels });
  } catch (err) {
    sendError(res, err);
  }
});

// POST /api/arena/channels  { title, description?, visibility? }
arenaRouter.post("/channels", async (req, res) => {
  const title = typeof req.body?.title === "string" ? req.body.title.trim() : "";
  if (!title) {
    res.status(400).json({ type: "BadRequest", status: 400, detail: "`title` is required" });
    return;
  }
  const description = typeof req.body?.description === "string" ? req.body.description : undefined;
  const visibility = typeof req.body?.visibility === "string" ? req.body.visibility : undefined;
  try {
    const channel = await createChannel({ title, description, visibility });
    res.status(201).json(channel);
  } catch (err) {
    sendError(res, err);
  }
});

/** Fetches an asset's bytes from mymind through the signed proxy — an
 * image thumbnail (bounded size, matches what Organizer renders) or the
 * original blob (for a PDF/attachment, where there's no thumbnail of the
 * real file). Returns the bytes plus the upstream content type, which we
 * carry straight into Are.na's presign so the block type is inferred
 * correctly. */
async function fetchMymindBytes(pathname, searchParams) {
  const upstream = await getMymindResource(pathname, searchParams);
  if (!upstream.ok) {
    throw new ArenaApiError(upstream.status, {
      message: `mymind asset fetch failed (${upstream.status})`,
    });
  }
  const contentType = upstream.headers.get("content-type") || "application/octet-stream";
  const bytes = Buffer.from(await upstream.arrayBuffer());
  return { bytes, contentType };
}

/** Maps a MIME type to a file extension for the presigned filename — Are.na
 * infers Image vs Attachment from the content type, not the extension, but
 * a sensible name keeps the uploaded file legible in Are.na. */
function extForType(contentType) {
  if (contentType.includes("png")) return "png";
  if (contentType.includes("gif")) return "gif";
  if (contentType.includes("webp")) return "webp";
  if (contentType.includes("pdf")) return "pdf";
  if (contentType.includes("jpeg") || contentType.includes("jpg")) return "jpg";
  return "bin";
}

// POST /api/arena/channels/:id/blocks
// One block per call, connected into the channel in the same request. The
// `kind` decides the mechanism (the client's centralized type-mapping in
// lib/arenaMapping.ts already resolved it from the object's real fields):
//   - "link" / "text": `value` is a public URL or literal text — no upload.
//   - "image": `mymindId`'s thumbnail bytes are fetched from mymind and
//     uploaded to Are.na (a local /api/... URL is NOT publicly reachable, so
//     it can never be passed as `value` — that was the original bug that
//     silently produced Text blocks full of proxy URLs).
//   - "attachment": the original blob bytes (e.g. a PDF) are uploaded.
// Returns the created Are.na block so the client can record the placement.
arenaRouter.post("/channels/:id/blocks", async (req, res) => {
  const { id } = req.params;
  const kind = typeof req.body?.kind === "string" ? req.body.kind : "text";
  const title = typeof req.body?.title === "string" ? req.body.title : undefined;
  const description = typeof req.body?.description === "string" ? req.body.description : undefined;
  const altText = typeof req.body?.altText === "string" ? req.body.altText : undefined;
  const originalSourceUrl =
    typeof req.body?.originalSourceUrl === "string" ? req.body.originalSourceUrl : undefined;
  const metadata =
    req.body?.metadata && typeof req.body.metadata === "object" ? req.body.metadata : undefined;

  try {
    if (kind === "image" || kind === "attachment") {
      const mymindId = typeof req.body?.mymindId === "string" ? req.body.mymindId : "";
      if (!mymindId) {
        res
          .status(400)
          .json({ type: "BadRequest", status: 400, detail: "`mymindId` is required for uploads" });
        return;
      }
      const { bytes, contentType } =
        kind === "image"
          ? await fetchMymindBytes(`/objects/${mymindId}/thumbnail`, { size: "1024x1024" })
          : await fetchMymindBytes(`/objects/${mymindId}/blob`, {});
      const block = await createBlockFromBytes({
        bytes,
        contentType,
        filename: `${mymindId}.${extForType(contentType)}`,
        title,
        description,
        altText,
        channelId: id,
        metadata,
        originalSourceUrl,
      });
      res.status(201).json(block);
      return;
    }

    // link / text
    const value = typeof req.body?.value === "string" ? req.body.value.trim() : "";
    if (!value) {
      res.status(400).json({ type: "BadRequest", status: 400, detail: "`value` is required" });
      return;
    }
    const block = await createBlock({
      value,
      title,
      description,
      channelId: id,
      metadata,
      originalSourceUrl,
    });
    res.status(201).json(block);
  } catch (err) {
    sendError(res, err);
  }
});
