/**
 * Gemini — the classifier tier (Samuel, 2026-07-21).
 *
 * Scope is deliberately narrow, and the reason is measured rather than
 * cautious. Everything physical about this archive is already derivable
 * for free: colour from the palette (88.6% coverage), orientation from
 * blob dimensions, format, source. What no amount of counting can decide
 * is MEANING — which of your recurring words are kinds of thing, which
 * are properties, and which word is a value of which property. Two
 * separate measurements proved it: ranking tags by cohesion put "spine"
 * first and "architecture" last, and scraping vocabulary by lift offered
 * "Font Style: New Topographics" for photographs.
 *
 * So this is spent on the TAXONOMY, never on the instances. One call
 * reads a compact summary of a group's own vocabulary and answers "what
 * is worth knowing about these, and which words belong to which
 * property". The deterministic pipeline then fills every object for free,
 * because tag→value matching already works once the options exist.
 *
 * Cost shape: one request per typology proposal, a few thousand tokens
 * in, a few hundred out. Not per object — 8,000 calls to say what one
 * call can say would be both slower and worse.
 *
 * The key is Samuel's own, lives in .env beside MYMIND_* / ARENA_TOKEN,
 * never reaches the browser, and is separate project scope from mymind
 * entirely — mymind's plan buys none of this (verified against its live
 * rate-limit headers: credits meter requests, and no inference endpoint
 * exists).
 */

const MODEL = "gemini-2.0-flash";
const ENDPOINT = (model, key) =>
  `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${key}`;

export class GeminiError extends Error {
  constructor(message, status) {
    super(message);
    this.name = "GeminiError";
    this.status = status;
  }
}

/** JSON Schema the model must answer in — structured output means no
 * prose-parsing, and a malformed answer fails loudly instead of silently
 * producing a half-taxonomy. */
const TAXONOMY_SCHEMA = {
  type: "object",
  properties: {
    properties: {
      type: "array",
      items: {
        type: "object",
        properties: {
          name: { type: "string" },
          reason: { type: "string" },
          options: { type: "array", items: { type: "string" } },
        },
        required: ["name", "options"],
      },
    },
    notAKind: {
      type: "array",
      description: "Words offered as the kind's name that are really attributes",
      items: { type: "string" },
    },
  },
  required: ["properties"],
};

/**
 * Given a kind of thing and the vocabulary its members actually carry,
 * propose the properties worth knowing about it and sort that vocabulary
 * into them.
 *
 * @param {{ typeName: string, vocabulary: {tag: string, count: number}[],
 *           existingProperties: string[], sampleTitles: string[] }} input
 */
export async function proposeTaxonomy({
  typeName,
  vocabulary,
  existingProperties = [],
  sampleTitles = [],
}) {
  const key = process.env.GEMINI_API_KEY;
  if (!key) {
    throw new GeminiError("No Gemini API key configured. Add one in Preferences.", 401);
  }

  const prompt = [
    `You are helping organise a personal design-reference archive.`,
    ``,
    `A group of things has been recognised as a kind called "${typeName}".`,
    sampleTitles.length ? `Some of them: ${sampleTitles.slice(0, 12).join("; ")}.` : "",
    ``,
    `These are the words that recur across this group, with how many of them carry each:`,
    vocabulary
      .slice(0, 200)
      .map((v) => `${v.tag} (${v.count})`)
      .join(", "),
    ``,
    existingProperties.length
      ? `It already has these properties, so do NOT propose them again: ${existingProperties.join(", ")}.`
      : "",
    ``,
    `Propose the properties worth knowing about this kind, and sort the words above into them as options.`,
    ``,
    `Rules:`,
    `- Propose at most 4 properties. Fewer is better than more.`,
    `- A property is a DIMENSION things vary along (Style, Era, Photographer, Medium), never a single value.`,
    `- Only use words that appear in the list above as options. Do not invent vocabulary.`,
    `- Ignore words that are not values of anything (generic words like "design", "inspiration").`,
    `- If a word names a person who made the thing, that belongs in an authorship property, not a style one.`,
    `- If the list does not support a property, leave it out. An empty answer is better than a wrong one.`,
    `- Also list, under notAKind, any word that was offered as the KIND's name but is really an attribute.`,
  ]
    .filter(Boolean)
    .join("\n");

  const res = await fetch(ENDPOINT(MODEL, key), {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      contents: [{ parts: [{ text: prompt }] }],
      generationConfig: {
        responseMimeType: "application/json",
        responseSchema: TAXONOMY_SCHEMA,
        temperature: 0.2,
      },
    }),
  });

  if (!res.ok) {
    const detail = await res.text().catch(() => "");
    throw new GeminiError(
      `Gemini refused the request (${res.status}). ${detail.slice(0, 200)}`,
      res.status
    );
  }

  const body = await res.json();
  const text = body?.candidates?.[0]?.content?.parts?.[0]?.text;
  if (!text) throw new GeminiError("Gemini returned no content.", 502);
  try {
    return JSON.parse(text);
  } catch {
    throw new GeminiError("Gemini returned malformed JSON.", 502);
  }
}
