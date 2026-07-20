import type { DesignObject, ObjectRelation } from "../types";
import { norm } from "./textNorm";
import { isFormField, isFormWord } from "./formVocabulary";
import { BLOB_ASPECT_KEY } from "./mymindSync";
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

// ---------------------------------------------------------------------------
// Per-object feature caches (perf maintenance, 2026-07-20). Ranking 8k
// candidates recomputed every derived feature per PAIR — parsePalette alone
// was 8k JSON.parses per panel open, tag/facet sets 16k Set builds, tfidf
// 8k tokenizations. Objects are replaced by fresh references on any update,
// so WeakMaps keyed by the object are self-invalidating and leak-free.
// ---------------------------------------------------------------------------

function weakCached<T>(cache: WeakMap<DesignObject, T>, o: DesignObject, build: (o: DesignObject) => T): T {
  const hit = cache.get(o);
  if (hit !== undefined) return hit;
  const value = build(o);
  cache.set(o, value);
  return value;
}

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

const tagSetCache = new WeakMap<DesignObject, Set<string>>();
function tagSet(object: DesignObject): Set<string> {
  return weakCached(tagSetCache, object, (o) => new Set(o.tags.map(norm)));
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

const paletteCache = new WeakMap<DesignObject, Record<string, number> | null>();
function parsePalette(object: DesignObject): Record<string, number> | null {
  return weakCached(paletteCache, object, (o) => {
    const raw = o.fields[BLOB_PALETTE_KEY];
    if (typeof raw !== "string") return null;
    try {
      return JSON.parse(raw) as Record<string, number>;
    } catch {
      return null;
    }
  });
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

const facetPairCache = new WeakMap<DesignObject, Set<string>>();
function facetPairSet(object: DesignObject): Set<string> {
  return weakCached(facetPairCache, object, (o) => {
    const pairs = new Set<string>();
    for (const [field, value] of Object.entries(o.fields)) {
      if (SYSTEM_FIELD_KEYS.has(field)) continue;
      const values = Array.isArray(value) ? value : [value];
      for (const v of values) {
        if (v) pairs.add(`${norm(field)}:${norm(v)}`);
      }
    }
    return pairs;
  });
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
 * at sync, not per query" ask) — a WeakMap rather than a single slot, so
 * the store's stable list and any component-memoized pool each keep their
 * own stats instead of evicting each other on every alternating call
 * (that ping-pong was a full 8k-object retokenization per panel open). */
const corpusCacheMap = new WeakMap<DesignObject[], CorpusStats>();

function getCorpusStats(objects: DesignObject[]): CorpusStats {
  const cached = corpusCacheMap.get(objects);
  if (cached) return cached;
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
  corpusCacheMap.set(objects, stats);
  return stats;
}

// Keyed by object AND validated against the stats the vector was built
// with — a corpus rebuild (library changed) invalidates every entry lazily.
const tfidfCache = new WeakMap<
  DesignObject,
  { stats: CorpusStats; vector: Map<string, number> | null }
>();

function tfidfVector(object: DesignObject, stats: CorpusStats): Map<string, number> | null {
  const hit = tfidfCache.get(object);
  if (hit && hit.stats === stats) return hit.vector;
  const vector = buildTfidfVector(object, stats);
  tfidfCache.set(object, { stats, vector });
  return vector;
}

function buildTfidfVector(object: DesignObject, stats: CorpusStats): Map<string, number> | null {
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

// Same norm-per-pair waste as embeddings, same cure: the norm is a
// property of the vector, computed once and remembered with it.
const tfidfNormCache = new WeakMap<Map<string, number>, number>();
function tfidfNorm(v: Map<string, number>): number {
  const hit = tfidfNormCache.get(v);
  if (hit !== undefined) return hit;
  let n = 0;
  for (const x of v.values()) n += x * x;
  const norm = Math.sqrt(n);
  tfidfNormCache.set(v, norm);
  return norm;
}

function cosineSim(a: Map<string, number>, b: Map<string, number>): number {
  const normA = tfidfNorm(a);
  const normB = tfidfNorm(b);
  if (normA === 0 || normB === 0) return 0;
  let dot = 0;
  const [small, large] = a.size <= b.size ? [a, b] : [b, a];
  for (const [term, v] of small) {
    const other = large.get(term);
    if (other) dot += v * other;
  }
  return dot / (normA * normB);
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

// ---------------------------------------------------------------------------
// Split similarity (issue #136): FORM (how it looks) vs CONTENT (what it's
// about) as two independently tunable rankings, never one unexplained
// blended number. Signals reuse this engine's primitives, partitioned by
// the shared form vocabulary (lib/formVocabulary):
//
//   FORM:    palette distance · form-tags · form-facets · aspect ratio
//   CONTENT: content-tags · TF-IDF keywords · content-facets ·
//            mymind embedding cosine (when both sides carry one) ·
//            entity/role match
//
// Both modes accept the knowledge graph: a manually created relationship
// between seed and candidate is a ranking BOOST (issue #133's relations
// feeding discovery), applied after the mode score so it never masquerades
// as visual/semantic likeness.
// ---------------------------------------------------------------------------

export type SimilarityMode = "form" | "content" | "blend";

/** Independently tunable (issue #136 requirement) — adjust one mode
 * without touching the other. */
const FORM_WEIGHTS = { color: 0.35, formTag: 0.3, formFacet: 0.2, aspect: 0.15 };
const CONTENT_WEIGHTS = { contentTag: 0.3, keyword: 0.25, contentFacet: 0.2, embedding: 0.15, entity: 0.1 };
/** Direct seed↔candidate relationship boost — additive, post-score. */
const RELATION_BOOST = 0.2;

const splitTagCaches = {
  form: new WeakMap<DesignObject, Set<string>>(),
  content: new WeakMap<DesignObject, Set<string>>(),
};
function splitTagSet(object: DesignObject, form: boolean): Set<string> {
  return weakCached(splitTagCaches[form ? "form" : "content"], object, (o) =>
    new Set(o.tags.filter((t) => isFormWord(t) === form).map(norm))
  );
}

const splitFacetCaches = {
  form: new WeakMap<DesignObject, Set<string>>(),
  content: new WeakMap<DesignObject, Set<string>>(),
};
function splitFacetPairSet(object: DesignObject, form: boolean): Set<string> {
  return weakCached(splitFacetCaches[form ? "form" : "content"], object, (o) => {
    const pairs = new Set<string>();
    for (const [field, value] of Object.entries(o.fields)) {
      if (SYSTEM_FIELD_KEYS.has(field)) continue;
      if (isFormField(field) !== form) continue;
      const values = Array.isArray(value) ? value : [value];
      for (const v of values) {
        if (v) pairs.add(`${norm(field)}:${norm(v)}`);
      }
    }
    return pairs;
  });
}

function aspectOf(object: DesignObject): number | null {
  const raw = asFieldString(object.fields[BLOB_ASPECT_KEY]);
  const n = Number(raw);
  return raw && Number.isFinite(n) && n > 0 ? n : null;
}

/** Aspect-ratio proximity in log space (a 2:1 vs 1:2 pair is as far apart
 * as 1:1 vs 4:1) — a quiet compositional signal: portrait posters cluster
 * with portrait posters, spreads with spreads. */
function aspectSimilarity(a: DesignObject, b: DesignObject): number | null {
  const aa = aspectOf(a);
  const bb = aspectOf(b);
  if (aa === null || bb === null) return null;
  const d = Math.abs(Math.log(aa) - Math.log(bb));
  return Math.max(0, 1 - d / Math.log(4));
}

// Norms cached per object — recomputing the target's 1536-float norm once
// per CANDIDATE was ~12M wasted multiplications per ranking pass.
const embeddingNormCache = new WeakMap<DesignObject, number>();
function embeddingNorm(o: DesignObject): number {
  const hit = embeddingNormCache.get(o);
  if (hit !== undefined) return hit;
  const e = o.embedding;
  let n = 0;
  if (e) for (let i = 0; i < e.length; i++) n += e[i] * e[i];
  const norm = Math.sqrt(n);
  embeddingNormCache.set(o, norm);
  return norm;
}

function embeddingCosine(a: DesignObject, b: DesignObject): number | null {
  const ea = a.embedding;
  const eb = b.embedding;
  if (!ea || !eb || ea.length !== eb.length || ea.length === 0) return null;
  const na = embeddingNorm(a);
  const nb = embeddingNorm(b);
  if (na === 0 || nb === 0) return null;
  let dot = 0;
  for (let i = 0; i < ea.length; i++) dot += ea[i] * eb[i];
  return Math.max(0, dot / (na * nb));
}

/** Weighted sum over available signals — a null signal's weight
 * redistributes across the rest (same missing-signal policy as the
 * original hybrid keyword handling). */
function weighted(entries: [number | null, number][]): number {
  let sum = 0;
  let weightSum = 0;
  for (const [value, weight] of entries) {
    if (value === null) continue;
    sum += value * weight;
    weightSum += weight;
  }
  return weightSum === 0 ? 0 : sum / weightSum;
}

function formScorePair(target: DesignObject, candidate: DesignObject): number {
  return weighted([
    [paletteSimilarity(parsePalette(target), parsePalette(candidate)) || null, FORM_WEIGHTS.color],
    [jaccard(splitTagSet(target, true), splitTagSet(candidate, true)), FORM_WEIGHTS.formTag],
    [jaccard(splitFacetPairSet(target, true), splitFacetPairSet(candidate, true)), FORM_WEIGHTS.formFacet],
    [aspectSimilarity(target, candidate), FORM_WEIGHTS.aspect],
  ]);
}

function contentScorePair(
  target: DesignObject,
  candidate: DesignObject,
  targetTfidf: Map<string, number> | null,
  candidateTfidf: Map<string, number> | null
): number {
  const entityA = norm(asFieldString(target.fields.entity_type) || target.role || "");
  const entityB = norm(asFieldString(candidate.fields.entity_type) || candidate.role || "");
  return weighted([
    [jaccard(splitTagSet(target, false), splitTagSet(candidate, false)), CONTENT_WEIGHTS.contentTag],
    [
      targetTfidf && candidateTfidf ? Math.max(0, cosineSim(targetTfidf, candidateTfidf)) : null,
      CONTENT_WEIGHTS.keyword,
    ],
    [jaccard(splitFacetPairSet(target, false), splitFacetPairSet(candidate, false)), CONTENT_WEIGHTS.contentFacet],
    [embeddingCosine(target, candidate), CONTENT_WEIGHTS.embedding],
    [entityA && entityB ? (entityA === entityB ? 1 : 0) : null, CONTENT_WEIGHTS.entity],
  ]);
}

export type ModeSimilarityResult = {
  id: string;
  /** The mode's own score (or the blend), relation boost included. */
  score: number;
  /** Both components exposed — never one unexplained number (#136). */
  formScore: number;
  contentScore: number;
  related: boolean;
};

/**
 * Ranks candidates against `target` in a specific mode. `blendWeight`
 * (0 = pure form … 1 = pure content, default 0.5) powers the future
 * blended slider; `relations` (the store's objectRelations) boosts
 * directly connected pairs.
 */
export function rankBySimilarityMode(
  target: DesignObject,
  candidates: DesignObject[],
  allObjects: DesignObject[],
  opts: {
    mode: SimilarityMode;
    limit?: number;
    blendWeight?: number;
    relations?: ObjectRelation[];
  }
): ModeSimilarityResult[] {
  const { mode, limit = 60, blendWeight = 0.5, relations } = opts;
  const stats = getCorpusStats(allObjects);
  const targetTfidf = tfidfVector(target, stats);
  const relatedIds = new Set<string>();
  if (relations) {
    for (const r of relations) {
      if (r.sourceObjectId === target.id) relatedIds.add(r.targetObjectId);
      else if (r.targetObjectId === target.id) relatedIds.add(r.sourceObjectId);
    }
  }
  return candidates
    .map((c) => {
      const formScore = formScorePair(target, c);
      const contentScore =
        mode === "form" ? 0 : contentScorePair(target, c, targetTfidf, tfidfVector(c, stats));
      const base =
        mode === "form"
          ? formScore
          : mode === "content"
          ? contentScore
          : formScore * (1 - blendWeight) + contentScore * blendWeight;
      const related = relatedIds.has(c.id);
      return {
        id: c.id,
        score: Math.min(1, base + (related ? RELATION_BOOST : 0)),
        formScore,
        contentScore,
        related,
      };
    })
    .sort((a, b) => b.score - a.score)
    .slice(0, limit);
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
