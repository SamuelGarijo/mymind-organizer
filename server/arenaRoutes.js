import express from "express";
import {
  ArenaApiError,
  createBlock,
  createBlockFromBytes,
  createChannel,
  getChannelContents,
  getMe,
  listMyChannels,
  searchArena,
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

// GET /api/arena/search?q=&type=&page=
// Maps Are.na's block records to the compact shape the Discovery strip
// renders: id, title, a displayable image URL, the block's own page, and
// the original source URL when the block has one.
arenaRouter.get("/search", async (req, res) => {
  const q = typeof req.query.q === "string" ? req.query.q.trim() : "";
  if (!q) {
    res.status(400).json({ type: "BadRequest", status: 400, detail: "`q` is required" });
    return;
  }
  const type = typeof req.query.type === "string" ? req.query.type : "Image";
  const page = req.query.page ? Number(req.query.page) : 1;
  try {
    const result = await searchArena({ query: q, type, page });
    const items = (Array.isArray(result?.data) ? result.data : [])
      .map((b) => ({
        id: b.id,
        title: b.title || "",
        imageUrl:
          b.image?.small?.url ||
          b.image?.thumb?.url ||
          b.image?.src ||
          b.image?.original?.url ||
          "",
        blockUrl: `https://www.are.na/block/${b.id}`,
        sourceUrl: b.source?.url || "",
        author: b.user?.name || "",
      }))
      .filter((b) => b.id);
    res.json({ items, totalCount: result?.meta?.total_count ?? items.length });
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

/** Are.na returns block text as a string on some types and as
 * {markdown|text} on others. One shape out. */
function asText(value) {
  if (typeof value === "string") return value;
  if (value && typeof value === "object") {
    if (typeof value.markdown === "string") return value.markdown;
    if (typeof value.text === "string") return value.text;
  }
  return "";
}

// GET /api/arena/channel/:slug — a board's blocks, for "+ ADD Something".
// Same compact DTO shape the search route returns, plus the block's own
// text content: an Are.na channel is as often notes as it is images, and
// dropping a board in should bring the words too.
arenaRouter.get("/channel/:slug", async (req, res) => {
  const slug = String(req.params.slug || "").trim();
  if (!slug) {
    res.status(400).json({ type: "BadRequest", status: 400, detail: "`slug` is required" });
    return;
  }
  try {
    const { channel, blocks, truncated } = await getChannelContents(slug);
    const mapped = blocks
      .map((b) => ({
        id: b.id,
        title: b.title || b.generated_title || "",
        // v3 image shape — `image.medium.src`, NOT the `image.large.url`
        // the /search route above uses. They are genuinely different
        // payloads and copying the search mapping here produced an image
        // URL of "" for every single block (caught before shipping,
        // 2026-07-21). medium first: large enough for a card, a fraction
        // of the original's bytes.
        imageUrl: b.image?.medium?.src || b.image?.small?.src || b.image?.src || "",
        sourceUrl: b.source?.url || "",
        // Text arrives either as a plain string or as {markdown|text}
        // depending on block type, so normalise rather than let an object
        // reach the client and stringify into "[object Object]".
        content: asText(b.content) || asText(b.description),
        className: b.class || b.type || "",
      }))
      .filter((b) => b.id);
    res.json({
      title: channel?.title || slug,
      blocks: mapped,
      truncated,
    });
  } catch (err) {
    sendError(res, err);
  }
});
