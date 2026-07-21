import express from "express";
import { GeminiError, proposeTaxonomy } from "./geminiClient.js";

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
