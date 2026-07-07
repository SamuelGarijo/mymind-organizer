import type { DesignObject, TagGroups } from "../types";
import { makeId } from "./id";

/**
 * Raw shape we accept from an imported JSON file. Deliberately loose: this is
 * the seam that gets replaced by the real mymind API response later, so we
 * normalize a few common aliases (image/imageUrl, a top-level "style" key)
 * rather than demanding one exact shape.
 */
type RawObject = {
  id?: string;
  title?: string;
  name?: string;
  image?: string;
  imageUrl?: string;
  url?: string;
  sourceUrl?: string;
  tags?: string[];
  fields?: Record<string, string>;
  style?: string;
  [key: string]: unknown;
};

const KNOWN_TOP_LEVEL = new Set([
  "id",
  "title",
  "name",
  "image",
  "imageUrl",
  "url",
  "sourceUrl",
  "tags",
  "fields",
  "style",
]);

export function normalizeImportedObject(raw: RawObject): DesignObject {
  const now = new Date().toISOString();
  const extraFields: Record<string, string> = { ...(raw.fields ?? {}) };

  // A top-level "style" is treated as a tag (not a separate field) — it
  // becomes just another entry in tags[], same as everything else.
  const tags = Array.isArray(raw.tags) ? raw.tags.filter((t) => typeof t === "string") : [];
  const styleValue = typeof raw.style === "string" ? raw.style.trim() : "";
  if (styleValue && !tags.some((t) => t.toLowerCase() === styleValue.toLowerCase())) {
    tags.push(styleValue);
  }

  // Fold any other unrecognized top-level string/number keys into fields.
  for (const [key, value] of Object.entries(raw)) {
    if (KNOWN_TOP_LEVEL.has(key)) continue;
    if (typeof value === "string" || typeof value === "number") {
      extraFields[key] = String(value);
    }
  }

  return {
    id: raw.id ? String(raw.id) : makeId("obj"),
    title: raw.title ?? raw.name ?? "Untitled",
    imageUrl: raw.imageUrl ?? raw.image ?? raw.url ?? "",
    tags,
    fields: extraFields,
    manualCollectionIds: [],
    sourceUrl: raw.sourceUrl,
    createdAt: now,
    updatedAt: now,
    source: "sample",
  };
}

export function parseImportFile(jsonText: string): {
  objects: DesignObject[];
  tagGroupHints: TagGroups;
} {
  const parsed = JSON.parse(jsonText);
  const list: RawObject[] = Array.isArray(parsed) ? parsed : parsed.objects ?? [];

  const tagGroupHints: TagGroups = {};
  const objects = list.map((raw) => {
    if (typeof raw.style === "string" && raw.style.trim() !== "") {
      tagGroupHints[raw.style.trim().toLowerCase()] = "style";
    }
    return normalizeImportedObject(raw);
  });

  return { objects, tagGroupHints };
}
