import express from "express";
import { ArenaApiError, createBlock, createChannel } from "./arenaClient.js";

export const arenaRouter = express.Router();

function sendError(res, err) {
  if (err instanceof ArenaApiError) {
    res.status(err.status).json({ type: "UpstreamError", status: err.status, detail: err.message });
    return;
  }
  console.error("[are.na proxy]", err);
  res.status(500).json({ type: "InternalError", status: 500, detail: err.message });
}

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

// POST /api/arena/channels/:id/blocks  { value, title?, description?, altText?, metadata? }
// One block per call, connected into the channel in the same request. The
// export flow (src/lib/arenaExport.ts) calls this once per object,
// sequentially with a delay between calls — bulk parallel writes would
// risk the account's rate limit (as low as 30 req/min on a free/guest
// tier), and Are.na's own batch endpoint is Premium-only + private-channel
// only, so it can't be assumed available.
arenaRouter.post("/channels/:id/blocks", async (req, res) => {
  const { id } = req.params;
  const value = typeof req.body?.value === "string" ? req.body.value.trim() : "";
  if (!value) {
    res.status(400).json({ type: "BadRequest", status: 400, detail: "`value` is required" });
    return;
  }
  const title = typeof req.body?.title === "string" ? req.body.title : undefined;
  const description = typeof req.body?.description === "string" ? req.body.description : undefined;
  const altText = typeof req.body?.altText === "string" ? req.body.altText : undefined;
  const originalSourceUrl =
    typeof req.body?.originalSourceUrl === "string" ? req.body.originalSourceUrl : undefined;
  const metadata =
    req.body?.metadata && typeof req.body.metadata === "object" ? req.body.metadata : undefined;
  try {
    const block = await createBlock({
      value,
      title,
      description,
      altText,
      channelId: id,
      metadata,
      originalSourceUrl,
    });
    res.status(201).json(block);
  } catch (err) {
    sendError(res, err);
  }
});
