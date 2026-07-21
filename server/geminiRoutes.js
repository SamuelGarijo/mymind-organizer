import express from "express";
import { classifyObjects, GeminiError, proposeTaxonomy } from "./geminiClient.js";
import { getMymindResource } from "./mymindClient.js";

export const geminiRouter = express.Router();

/**
 * POST /api/gemini/taxonomy
 * Body: { typeName, vocabulary: [{tag,count}], existingProperties?, sampleTitles? }
 *
 * The ONLY Gemini route, on purpose. The classifier tier exists to answer
 * a question about the archive's vocabulary, not to look at objects one
 * by one — see geminiClient's header for why that boundary is measured
 * rather than assumed. Adding a per-object endpoint later should be a
 * deliberate decision with its own cost estimate, not a drift.
 *
 * Only tag strings and titles leave the machine. No images, no ids, no
 * credentials, no mymind data beyond the words the user typed themselves.
 */
geminiRouter.post("/taxonomy", async (req, res) => {
  const { typeName, vocabulary, existingProperties, sampleTitles } = req.body ?? {};
  if (typeof typeName !== "string" || !typeName.trim()) {
    res.status(400).json({ error: "typeName is required" });
    return;
  }
  if (!Array.isArray(vocabulary) || vocabulary.length === 0) {
    res.status(400).json({ error: "vocabulary is required" });
    return;
  }
  try {
    const result = await proposeTaxonomy({
      typeName: typeName.trim(),
      vocabulary: vocabulary
        .filter((v) => v && typeof v.tag === "string")
        .map((v) => ({ tag: v.tag, count: Number(v.count) || 1 })),
      existingProperties: Array.isArray(existingProperties) ? existingProperties : [],
      sampleTitles: Array.isArray(sampleTitles) ? sampleTitles : [],
    });
    res.json(result);
  } catch (err) {
    const status = err instanceof GeminiError ? err.status || 502 : 500;
    res.status(status).json({ error: err.message ?? "Gemini request failed" });
  }
});

/** How many objects one classify request may carry. Beyond this the model's
 * attention degrades and a single failure costs too much; the client splits
 * and the batches run in sequence. */
const MAX_BATCH = 25;
/** Thumbnails, not originals — enough to tell a Didone from a Grotesque,
 * a fraction of the bytes. */
const IMAGE_SIZE = "512x512";

/** mymind's image URLs are signed and not publicly fetchable, so Gemini
 * cannot be handed a link. The proxy already holds the credentials, so it
 * fetches the thumbnail itself and inlines the bytes. Failures are silent
 * on purpose: a missing image degrades that item to text-only, which is
 * still a usable answer, rather than failing the whole round. */
async function inlineThumbnail(id) {
  try {
    const upstream = await getMymindResource(`/objects/${id}/thumbnail`, { size: IMAGE_SIZE });
    if (!upstream.ok || !upstream.body) return undefined;
    const buffer = Buffer.from(await upstream.arrayBuffer());
    if (buffer.length === 0 || buffer.length > 4_000_000) return undefined;
    const type = upstream.headers.get("content-type") || "";
    return {
      mimeType: type.startsWith("image/") ? type : "image/jpeg",
      data: buffer.toString("base64"),
    };
  } catch {
    return undefined;
  }
}

/**
 * POST /api/gemini/classify
 * Body: { property, options: string[], allowMultiple?, withImages?,
 *         items: [{id, title?, tags?, summary?}] }
 * → { results: [{id, value, confidence, evidence}] }
 *
 * The object-level tier, and a deliberately separate decision from
 * /taxonomy above rather than a drift out of it (Samuel, 2026-07-21:
 * "user-triggered, specialized enrichment rounds that analyse individual
 * objects and images using a predefined taxonomy").
 *
 * What makes it safe to exist is that it cannot invent a taxonomy — it is
 * only ever handed options that already exist as a declared property, and
 * everything it returns comes back as proposals with confidence and
 * evidence, reviewed before anything is written. It costs per object, so
 * it is never automatic: no sync path, no mount, no background pass.
 *
 * With `withImages`, thumbnails leave the machine. That is a real
 * escalation over /taxonomy's words-only promise, which is why it is an
 * explicit per-request flag the user turns on, never a default.
 */
geminiRouter.post("/classify", async (req, res) => {
  const { property, options, allowMultiple, withImages, items } = req.body ?? {};
  if (typeof property !== "string" || !property.trim()) {
    res.status(400).json({ error: "property is required" });
    return;
  }
  if (!Array.isArray(options) || options.length === 0) {
    res.status(400).json({ error: "options are required — classify against a declared taxonomy" });
    return;
  }
  if (!Array.isArray(items) || items.length === 0) {
    res.status(400).json({ error: "items are required" });
    return;
  }
  if (items.length > MAX_BATCH) {
    res.status(400).json({ error: `At most ${MAX_BATCH} items per request.` });
    return;
  }

  try {
    const prepared = [];
    for (const item of items) {
      if (!item || typeof item.id !== "string") continue;
      prepared.push({
        id: item.id,
        title: typeof item.title === "string" ? item.title : undefined,
        tags: Array.isArray(item.tags) ? item.tags.filter((t) => typeof t === "string") : [],
        summary: typeof item.summary === "string" ? item.summary : undefined,
        image: withImages ? await inlineThumbnail(item.id) : undefined,
      });
    }
    const result = await classifyObjects({
      property: property.trim(),
      options: options.filter((o) => typeof o === "string" && o.trim()),
      allowMultiple: Boolean(allowMultiple),
      items: prepared,
    });
    res.json(result);
  } catch (err) {
    const status = err instanceof GeminiError ? err.status || 502 : 500;
    res.status(status).json({ error: err.message ?? "Gemini request failed" });
  }
});
