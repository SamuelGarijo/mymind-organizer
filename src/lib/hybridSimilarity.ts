import type { DesignObject } from "../types";
import { norm } from "./textNorm";
import {
  BLOB_PALETTE_KEY,
  DESCRIPTION_KEY,
  MYMIND_OWNED_FIELD_KEYS,
  NOTE_CONTENT_KEY,
  NOTE_ID_KEY,
  asFieldString,
} from "./mymindSync";

/**
 * Local hybrid similarity engine (issue #23) — replaces mymind's own
 * `similarTo`/embedding-based ranking, which only works for a mymind object
 * that happens to carry an embedding (an opt-in, rarely-fetched field —
 * `store.ts`'s old "similar" branch returned an empty list whenever the
 * target lacked one, which was most of the time). Every signal here is
 * computed from data every object already has regardless of source
 * (mymind/Are.na/personal), so "Similar to this" works everywhere.
 *
 * Four signals, weighted sum, each normalized to 0-1:
 * - tag: Jaccard overlap of normalized tags — cheap, primary.
 * - color: mymind's own per-image palette (#69's BLOB_PALETTE_KEY) — a
 *   weighted best-match color distance, not just "do they share a color".
 * - facet: Jaccard overlap of "field:value" pairs (role/facet fields only —
 *   mymind-owned/system keys excluded so this doesn't mistake identical
 *   `source_url`s or `created` timestamps for a facet match).
 * - keyword: TF-IDF cosine over title+summary — secondary/optional, since
 *   a personal upload often has no text at all; when either side has none,
 *   this signal is dropped entirely and its weight redistributes across
 *   whichever signals ARE available, rather than silently scoring it 0
 *   (which would just penalize every text-less object for no reason).
 */

const WEIGHTS = { tag: 0.35, color: 0.3, facet: 0.25, keyword: 0.1 };

export type SimilarityBreakdown = { tag: number; color: number; facet: number; keyword: number };
export type SimilarityResult = { id: string; score: number; breakdown: SimilarityBreakdown };

// ---------------------------------------------------------------------------
// Tag overlap
// ---------------------------------------------------------------------------

function jaccard(a: Set<string>, b: Set<string>): number {
  if (a.size === 0 && b.size === 0) return 0;
  let intersection = 0;
  for (const x of a) if (b.has(x)) intersection++;
  const union = a.size + b.size - intersection;
  return union === 0 ? 0 : intersection / union;
}

function tagSet(object: DesignObject): Set<string> {
  return new Set(object.tags.map(norm));
}

// ---------------------------------------------------------------------------
// Color/palette — reuses #69's BLOB_PALETTE_KEY, not a new extraction
// ---------------------------------------------------------------------------

function hexToRgb(hex: string): [number, number, number] | null {
  const m = /^#?([0-9a-f]{6})$/i.exec(hex.trim());
  if (!m) return null;
  const n = parseInt(m[1], 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
}

function rgbDistance(a: [number, number, number], b: [number, number, number]): number {
  const maxDistance = Math.sqrt(3 * 255 * 255);
  const d = Math.sqrt((a[0] - b[0]) ** 2 + (a[1] - b[1]) ** 2 + (a[2] - b[2]) ** 2);
  return d / maxDistance; // 0-1
}

function parsePalette(object: DesignObject): Record<string, number> | null {
  const raw = object.fields[BLOB_PALETTE_KEY];
  if (typeof raw !== "string") return null;
  try {
    return JSON.parse(raw);
  } catch {
    return null;
  }
}

/** Weighted best-match: each color in A is matched to its closest color in
 * B, contributing `weightA * (1 - distance)` — a palette dominated by one
 * strong color that closely matches the other's dominant color scores high
 * even if the two palettes have a different number of entries. */
function paletteSimilarity(
  paletteA: Record<string, number> | null,
  paletteB: Record<string, number> | null
): number {
  if (!paletteA || !paletteB) return 0;
  const bEntries = Object.entries(paletteB)
    .map(([hex, weight]) => ({ rgb: hexToRgb(hex), weight }))
    .filter((e): e is { rgb: [number, number, number]; weight: number } => !!e.rgb);
  if (bEntries.length === 0) return 0;

  let totalWeight = 0;
  let scoreSum = 0;
  for (const [hexA, weightA] of Object.entries(paletteA)) {
    const rgbA = hexToRgb(hexA);
    if (!rgbA) continue;
    let best = Infinity;
    for (const { rgb } of bEntries) {
      const d = rgbDistance(rgbA, rgb);
      if (d < best) best = d;
    }
    scoreSum += weightA * (1 - best);
    totalWeight += weightA;
  }
  return totalWeight === 0 ? 0 : scoreSum / totalWeight;
}

// ---------------------------------------------------------------------------
// Facet field-value overlap — role/facet fields only, mymind-owned/system
// keys excluded so a shared source_url or created timestamp never counts.
// ---------------------------------------------------------------------------

const SYSTEM_FIELD_KEYS = new Set<string>([
  ...MYMIND_OWNED_FIELD_KEYS,
  DESCRIPTION_KEY,
  NOTE_ID_KEY,
  NOTE_CONTENT_KEY,
]);

function facetPairSet(object: DesignObject): Set<string> {
  const pairs = new Set<string>();
  for (const [field, value] of Object.entries(object.fields)) {
    if (SYSTEM_FIELD_KEYS.has(field)) continue;
    const values = Array.isArray(value) ? value : [value];
    for (const v of values) {
      if (v) pairs.add(`${norm(field)}:${norm(v)}`);
    }
  }
  return pairs;
}

// ---------------------------------------------------------------------------
// TF-IDF keyword distinctiveness over title + summary
// ---------------------------------------------------------------------------

function tokenize(text: string): string[] {
  return (text.toLowerCase().match(/[a-z0-9À-ž]{3,}/g) ?? []) as string[];
}

function objectText(object: DesignObject): string {
  return `${object.title} ${asFieldString(object.fields.summary)}`.trim();
}

type CorpusStats = { documentFrequency: Map<string, number>; totalDocs: number };

/** Precomputed once per `objects` array reference (issue #23's own "cache
 * at sync, not per query" ask) — a module-level cache keyed by reference
 * identity, not a React hook, since this is called from store.ts's plain
 * getVisibleObjects function, not a component. */
let corpusCache: { objectsRef: DesignObject[]; stats: CorpusStats } | null = null;

function getCorpusStats(objects: DesignObject[]): CorpusStats {
  if (corpusCache && corpusCache.objectsRef === objects) return corpusCache.stats;
  const documentFrequency = new Map<string, number>();
  let totalDocs = 0;
  for (const object of objects) {
    const text = objectText(object);
    if (!text) continue;
    totalDocs++;
    const seen = new Set(tokenize(text));
    for (const term of seen) documentFrequency.set(term, (documentFrequency.get(term) ?? 0) + 1);
  }
  const stats = { documentFrequency, totalDocs };
  corpusCache = { objectsRef: objects, stats };
  return stats;
}

function tfidfVector(object: DesignObject, stats: CorpusStats): Map<string, number> | null {
  const text = objectText(object);
  if (!text) return null;
  const terms = tokenize(text);
  if (terms.length === 0) return null;
  const termFrequency = new Map<string, number>();
  for (const t of terms) termFrequency.set(t, (termFrequency.get(t) ?? 0) + 1);
  const vector = new Map<string, number>();
  for (const [term, tf] of termFrequency) {
    const df = stats.documentFrequency.get(term) ?? 1;
    const idf = Math.log((stats.totalDocs + 1) / (df + 1)) + 1;
    vector.set(term, (tf / terms.length) * idf);
  }
  return vector;
}

function cosineSim(a: Map<string, number>, b: Map<string, number>): number {
  let dot = 0;
  let normA = 0;
  let normB = 0;
  for (const v of a.values()) normA += v * v;
  for (const v of b.values()) normB += v * v;
  const [small, large] = a.size <= b.size ? [a, b] : [b, a];
  for (const [term, v] of small) {
    const other = large.get(term);
    if (other) dot += v * other;
  }
  if (normA === 0 || normB === 0) return 0;
  return dot / (Math.sqrt(normA) * Math.sqrt(normB));
}

// ---------------------------------------------------------------------------
// Combined score
// ---------------------------------------------------------------------------

function scorePair(
  target: DesignObject,
  candidate: DesignObject,
  targetTfidf: Map<string, number> | null,
  candidateTfidf: Map<string, number> | null
): { score: number; breakdown: SimilarityBreakdown } {
  const tag = jaccard(tagSet(target), tagSet(candidate));
  const color = paletteSimilarity(parsePalette(target), parsePalette(candidate));
  const facet = jaccard(facetPairSet(target), facetPairSet(candidate));
  const keyword =
    targetTfidf && candidateTfidf ? Math.max(0, cosineSim(targetTfidf, candidateTfidf)) : null;

  // Keyword's weight only applies when both sides have text — otherwise it
  // redistributes proportionally across the other three so a text-less
  // object isn't just penalized for something it was never going to have.
  const activeWeights =
    keyword === null
      ? { tag: WEIGHTS.tag, color: WEIGHTS.color, facet: WEIGHTS.facet }
      : WEIGHTS;
  const weightSum = Object.values(activeWeights).reduce((a, b) => a + b, 0);

  const score =
    (tag * activeWeights.tag +
      color * activeWeights.color +
      facet * activeWeights.facet +
      (keyword ?? 0) * (keyword === null ? 0 : WEIGHTS.keyword)) /
    weightSum;

  return { score, breakdown: { tag, color, facet, keyword: keyword ?? 0 } };
}

/** Pairwise score between two specific objects (0-1) — same signals/weights
 * as rankByHybridSimilarity, exposed separately for a smart collection's
 * "similar to this object" criterion (lib/ruleEngine.ts's FilterSimilarity),
 * which checks one seed against every candidate individually rather than
 * ranking a fixed pool. `allObjects` is only for the TF-IDF corpus cache. */
export function similarityScore(a: DesignObject, b: DesignObject, allObjects: DesignObject[]): number {
  const stats = getCorpusStats(allObjects);
  return scorePair(a, b, tfidfVector(a, stats), tfidfVector(b, stats)).score;
}

/** Ranks every candidate against `target`, most similar first — the
 * replacement for `lib/similarity.ts`'s embedding-only `rankBySimilarity`.
 * `allObjects` is the full pool (used only to build/cache TF-IDF corpus
 * stats); `candidates` is whoever's actually eligible to appear (already
 * excludes the target itself). */
export function rankByHybridSimilarity(
  target: DesignObject,
  candidates: DesignObject[],
  allObjects: DesignObject[],
  limit = 60
): SimilarityResult[] {
  const stats = getCorpusStats(allObjects);
  const targetTfidf = tfidfVector(target, stats);
  return candidates
    .map((c) => {
      const { score, breakdown } = scorePair(target, c, targetTfidf, tfidfVector(c, stats));
      return { id: c.id, score, breakdown };
    })
    .sort((a, b) => b.score - a.score)
    .slice(0, limit);
}
