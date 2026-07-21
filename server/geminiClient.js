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

/**
 * Turns Google's error envelope into one sentence a person can act on.
 *
 * The old code pasted 200 characters of raw upstream JSON into the message
 * and that message went straight to the UI. What Samuel actually saw on a
 * spent free tier (2026-07-21) was:
 *
 *   Gemini refused the request (429). { "error": { "code": 429, "message":
 *   "You exceeded your current quota, please check your plan and billing
 *   details. For more information on this error, head to: https://ai.goo…
 *
 * — truncated mid-URL, and it read as a bug in the app rather than as a
 * bill. The status codes that can realistically happen here each have a
 * different remedy, so each gets its own sentence; anything unforeseen
 * still falls through to Google's own `message`, which is at least prose.
 */
function humanGeminiError(status, body) {
  let detail = "";
  try {
    detail = JSON.parse(body)?.error?.message ?? "";
  } catch {
    detail = "";
  }

  if (status === 429) {
    // The most likely one by far, and the only one that isn't a bug: the
    // free tier is small and resets on Google's clock, not ours.
    return "Gemini's quota is used up — the free tier resets daily, or add billing to your Google AI Studio key.";
  }
  if (status === 400 && /API key not valid/i.test(detail)) {
    return "That Gemini key isn't valid. Paste a fresh one in Preferences → Classifier.";
  }
  if (status === 401 || status === 403) {
    return "Gemini rejected the key. Check it's enabled for the Generative Language API.";
  }
  if (status >= 500) {
    return "Gemini is having trouble on its end — worth trying again in a minute.";
  }
  return detail
    ? `Gemini refused the request: ${detail}`
    : `Gemini refused the request (${status}).`;
}

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
      humanGeminiError(res.status, detail),
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

/** Per-object classification against a taxonomy the user already declared.
 * Batched, because one request per object would be absurd at archive
 * scale; capped because a batch that's too big degrades attention. */
const CLASSIFY_BATCH_SCHEMA = {
  type: "object",
  properties: {
    results: {
      type: "array",
      items: {
        type: "object",
        properties: {
          id: { type: "string" },
          value: { type: "string" },
          confidence: { type: "number" },
          evidence: { type: "string" },
        },
        required: ["id", "value", "confidence"],
      },
    },
  },
  required: ["results"],
};

/**
 * Classify individual objects against a PREDEFINED taxonomy — the second
 * step Samuel asked for: "specialized enrichment rounds that analyse
 * individual objects and images using a predefined taxonomy, for example
 * classifying a Typography collection as Serif, Grotesque, Didone,
 * Bauhaus-influenced".
 *
 * Deliberately different in kind from proposeTaxonomy above. That one
 * decides WHAT to know, once, per group. This one decides WHICH VALUE for
 * each thing, and so it costs per object — which is why it is only ever
 * user-triggered, batched, scoped to a chosen property, and returns
 * confidence and evidence so the result can be reviewed rather than
 * trusted.
 *
 * Images are opt-in (`withImages`) and passed as inline bytes the caller
 * has already fetched, because mymind's own image URLs are not publicly
 * reachable. Without them this reads titles, tags and summaries — which
 * is enough for many properties and a great deal cheaper.
 *
 * @param {{ property: string, options: string[], allowMultiple?: boolean,
 *           items: {id: string, title?: string, tags?: string[],
 *                   summary?: string, image?: {mimeType: string, data: string}}[] }} input
 */
export async function classifyObjects({ property, options, allowMultiple = false, items }) {
  const key = process.env.GEMINI_API_KEY;
  if (!key) {
    throw new GeminiError("No Gemini API key configured. Add one in Preferences.", 401);
  }
  if (!Array.isArray(options) || options.length === 0) {
    throw new GeminiError("A taxonomy is required — classify against declared options.", 400);
  }

  const instructions = [
    `Classify each item below by "${property}".`,
    ``,
    `Allowed values, and NOTHING else: ${options.join(", ")}.`,
    ``,
    `Rules:`,
    `- Answer for every item, using its exact id.`,
    `- Use only the allowed values. Never invent one.`,
    allowMultiple
      ? `- If several apply, join them with " | ".`
      : `- Choose the single best value.`,
    `- confidence is 0 to 1: how sure you are for THIS item, not in general.`,
    `- If nothing fits, answer with an empty value and low confidence. A gap is better than a guess.`,
    `- evidence: the few words that decided it.`,
  ].join("\n");

  // Text goes in one part; each image (when opted into) rides alongside
  // its own id so the model can tie them together.
  const parts = [{ text: instructions }];
  for (const item of items) {
    parts.push({
      text: [
        ``,
        `id: ${item.id}`,
        item.title ? `title: ${item.title}` : "",
        item.tags?.length ? `tags: ${item.tags.slice(0, 25).join(", ")}` : "",
        item.summary ? `summary: ${item.summary.slice(0, 300)}` : "",
      ]
        .filter(Boolean)
        .join("\n"),
    });
    if (item.image?.data) {
      parts.push({ inlineData: { mimeType: item.image.mimeType, data: item.image.data } });
    }
  }

  const res = await fetch(ENDPOINT(MODEL, key), {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      contents: [{ parts }],
      generationConfig: {
        responseMimeType: "application/json",
        responseSchema: CLASSIFY_BATCH_SCHEMA,
        temperature: 0.1,
      },
    }),
  });

  if (!res.ok) {
    const detail = await res.text().catch(() => "");
    throw new GeminiError(
      humanGeminiError(res.status, detail),
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
