import type { DesignObject, FacetField } from "../types";
import {
  BLOB_ASPECT_KEY,
  BLOB_PALETTE_KEY,
  BLOB_TYPE_KEY,
  CREATOR_KEY,
  PUBLISHED_KEY,
  asFieldString,
} from "./mymindSync";
import { domainOf } from "./objectKind";
import { norm } from "./textNorm";

/**
 * The enrichment pipeline — why role fields stop being empty.
 *
 * The role/facet model was sound but lifeless: a field added after its role
 * was assigned never got backfilled (store.ts's `applyRoleToObject` only
 * auto-filled at role-apply time, only from tags, only on an exact match
 * against an already-declared option), so most fields stayed empty, so there
 * was nothing worth filtering by. This module is the answer: every field
 * value that CAN be derived from data we already hold, gets derived —
 * repeatably, with evidence, and reversibly.
 *
 * ## Deliberately a pipeline, not a deterministic dead end
 *
 * Everything downstream — confidence gating, evidence display,
 * `fieldProvenance`, tag promotion, reversible application, the "+ property"
 * popover — consumes `Proposal[]` and does not care what produced it. A
 * provider implements `propose` (cheap, synchronous, pure) or `proposeAsync`
 * (batched, cancellable). Deterministic extractors use the former; a future
 * classifier uses the latter and NOTHING else in the app changes.
 *
 * The intended next kind of provider is a user-triggered, entity-specific
 * enrichment pass — "Run Typography Enrichment on this collection" — carrying
 * predefined properties, controlled vocabularies, and visual definitions with
 * reference examples per term, so a taxonomy (serif, sans-serif, gothic,
 * Bauhaus, modernist, rationalist, display…) is declared once rather than
 * rediscovered on every run. It would return the same `Proposal[]` with the
 * same confidence/evidence/provenance and the same one-click reversibility.
 * That layer is NOT implemented here — only the seam it plugs into.
 *
 * ## What the data can and cannot answer (measured, not assumed)
 *
 * Coverage over 1,000 live objects (2026-07-20): palette 88.6%, blob
 * dimensions 89.0%, blob type 89.1%, entityType 100%, source url 47.9%,
 * `mainEntity.authors` 3.3%, `mainEntity.published` 1.5%.
 *
 * The boundary that matters: in the Typography slice, 85% of objects would
 * get a Colour value but only 3.3% would get a Type (serif/sans) value —
 * across the whole archive, 1,195 objects carry a `typography` tag while
 * `grotesk` appears zero times and `monospace` three. Deterministic
 * extraction answers PHYSICAL questions (what colour is it, which way up, what
 * format, where from). It cannot answer SEMANTIC ones (serif or sans, which
 * foundry, which movement) because that was never recorded anywhere. Those
 * are the classifier's job, later — not something to fake here.
 */

export type Proposal = {
  objectId: string;
  field: string;
  value: string | string[];
  /** 0–1. Consumers gate on this: high applies automatically, medium is
   * offered with a count and applied on one click. */
  confidence: number;
  /** Why this value — shown to the user and used to debug a bad rule.
   * "palette #1354a8 · 60%", "tag: sans-serif". */
  evidence: string;
  providerId: string;
  /** Set when the value came from one of the object's own tags: that tag is
   * PROMOTED (hidden from the generic tag presentation, kept on the object,
   * reversible) rather than copied or deleted. See lib/tagPromotion.ts. */
  fromTag?: string;
};

export type VocabularyEntry = { value: string; count: number };

export type ProviderContext = {
  /** The field being filled, when it already exists — providers may use its
   * declared options to constrain themselves. Absent while proposing a
   * brand-new field, which is exactly when `proposeVocabulary` matters. */
  field?: FacetField;
};

export type EnrichmentProvider = {
  id: string;
  kind: "deterministic" | "classifier";
  /** Human-readable source, shown in the "+ property" popover: "image
   * palette", "tags", "source domain". */
  label: string;
  /** Does this provider know how to fill a field with this name? */
  serves: (fieldName: string) => boolean;
  /** Cheap, synchronous, pure. Deterministic providers implement this. */
  propose?: (objects: DesignObject[], fieldName: string, ctx: ProviderContext) => Proposal[];
  /** Batched and awaitable. The seam for classifiers — unused today. */
  proposeAsync?: (
    objects: DesignObject[],
    fieldName: string,
    ctx: ProviderContext
  ) => Promise<Proposal[]>;
  /** The option list this provider would create for a NEW field, most
   * frequent first — so the user never has to invent a vocabulary up front. */
  proposeVocabulary?: (objects: DesignObject[], fieldName: string) => VocabularyEntry[];
};

/** Confidence floor for silent application. Below it, a proposal is offered
 * rather than applied — the app's standing "suggest, never write blindly"
 * norm, expressed as one number instead of scattered per-provider policy. */
export const AUTO_APPLY_CONFIDENCE = 0.8;

// ---------------------------------------------------------------------------
// Colour — the highest-coverage signal in the archive (88.6%).
// ---------------------------------------------------------------------------

/** Named colour buckets, ordered roughly by how often they occur in this
 * library. Exported so the "+ property" popover can seed a field's options
 * in a stable, sensible order rather than by whatever the sample happened to
 * contain. */
export const COLOR_BUCKETS = [
  "Black",
  "Dark grey",
  "Grey",
  "Light grey",
  "White",
  "Beige",
  "Cream",
  "Brown",
  "Red",
  "Orange",
  "Yellow",
  "Green",
  "Teal",
  "Blue",
  "Purple",
  "Pink",
] as const;

function hexToRgb(hex: string): [number, number, number] | null {
  let h = hex.replace(/^#/, "");
  if (h.length === 3) h = h.split("").map((c) => c + c).join("");
  if (h.length === 8) h = h.slice(0, 6); // mymind sends some 8-digit values; alpha is ignored
  if (h.length !== 6 || !/^[0-9a-f]{6}$/i.test(h)) return null;
  const n = parseInt(h, 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
}

function rgbToHsl(r: number, g: number, b: number): [number, number, number] {
  r /= 255;
  g /= 255;
  b /= 255;
  const mx = Math.max(r, g, b);
  const mn = Math.min(r, g, b);
  const l = (mx + mn) / 2;
  if (mx === mn) return [0, 0, l];
  const d = mx - mn;
  const s = l > 0.5 ? d / (2 - mx - mn) : d / (mx + mn);
  const h =
    (mx === r ? (g - b) / d + (g < b ? 6 : 0) : mx === g ? (b - r) / d + 2 : (r - g) / d + 4) * 60;
  return [h, s, l];
}

/**
 * One hex → one colour name.
 *
 * The warm-hue branch is the whole reason this isn't three lines: a plain HSL
 * wheel labelled 23% of this archive "Orange", because aged paper (#eddfd0),
 * tan (#cec6b4) and sepia (#35211c) all sit in the orange hue range. In a
 * library that is largely vintage print, that reads as nonsense. Splitting
 * warm hues by lightness/saturation BEFORE hue recovers Brown, Beige and
 * Cream as first-class names and drops Orange to a believable 8%.
 */
export function colorBucket(hex: string): string | null {
  const rgb = hexToRgb(hex);
  if (!rgb) return null;
  const [h, s, l] = rgbToHsl(...rgb);

  // The neutral spine — greys carry no hue worth naming.
  if (s < 0.1) {
    return l < 0.18 ? "Black" : l < 0.42 ? "Dark grey" : l < 0.72 ? "Grey" : l < 0.9 ? "Light grey" : "White";
  }
  if (l < 0.1) return "Black";
  if (l > 0.96 && s < 0.2) return "White";

  if (h < 50 || h >= 345) {
    if (l < 0.32) return "Brown";
    if (s < 0.28) return l > 0.82 ? "Cream" : "Beige";
    if (l > 0.86 && s < 0.45) return "Cream";
    if (h >= 345 || h < 14) return "Red";
    if (h < 38) return "Orange";
    return "Yellow";
  }
  if (h < 70) return s < 0.25 ? "Beige" : "Yellow";
  if (h < 165) return "Green";
  if (h < 200) return "Teal";
  if (h < 255) return "Blue";
  if (h < 290) return "Purple";
  return "Pink";
}

function parsePalette(object: DesignObject): [string, number][] {
  const raw = object.fields[BLOB_PALETTE_KEY];
  if (typeof raw !== "string") return [];
  try {
    const parsed = JSON.parse(raw) as Record<string, number>;
    return Object.entries(parsed).sort((a, b) => b[1] - a[1]);
  } catch {
    return [];
  }
}

/** A colour needs this share of the image before it counts as one of its
 * colours — below it we're naming compression noise, not a colour choice. */
const PALETTE_SECONDARY_MIN = 0.15;

const COLOR_FIELD = /^(colou?r|palette|dominant colou?r|tone)$/i;

const paletteColorProvider: EnrichmentProvider = {
  id: "palette-color",
  kind: "deterministic",
  label: "image palette",
  serves: (name) => COLOR_FIELD.test(name.trim()),
  propose: (objects, fieldName, ctx) => {
    const multi = ctx.field?.type === "multi-select";
    const out: Proposal[] = [];
    for (const object of objects) {
      const palette = parsePalette(object);
      if (palette.length === 0) continue;
      if (multi) {
        const names: string[] = [];
        for (const [hex, weight] of palette) {
          if (weight < PALETTE_SECONDARY_MIN) continue;
          const name = colorBucket(hex);
          if (name && !names.includes(name)) names.push(name);
        }
        if (names.length === 0) continue;
        out.push({
          objectId: object.id,
          field: fieldName,
          value: names,
          confidence: 0.9,
          evidence: `palette · ${names.length} colour${names.length > 1 ? "s" : ""} over ${Math.round(PALETTE_SECONDARY_MIN * 100)}%`,
          providerId: "palette-color",
        });
      } else {
        const [hex, weight] = palette[0];
        const name = colorBucket(hex);
        if (!name) continue;
        out.push({
          objectId: object.id,
          field: fieldName,
          value: name,
          // A dominant colour that owns most of the image is a stronger claim
          // than one that barely leads a busy palette.
          confidence: weight >= 0.4 ? 0.95 : 0.85,
          evidence: `palette ${hex} · ${Math.round(weight * 100)}%`,
          providerId: "palette-color",
        });
      }
    }
    return out;
  },
  proposeVocabulary: (objects, fieldName) => tally(
    paletteColorProvider.propose!(objects, fieldName, {})
  ),
};

// ---------------------------------------------------------------------------
// Orientation — free, 89% coverage, and genuinely useful for a visual archive.
// ---------------------------------------------------------------------------

const ORIENTATION_FIELD = /^(orientation|aspect|format ratio|shape)$/i;

const orientationProvider: EnrichmentProvider = {
  id: "blob-aspect",
  kind: "deterministic",
  label: "image dimensions",
  serves: (name) => ORIENTATION_FIELD.test(name.trim()),
  propose: (objects, fieldName) => {
    const out: Proposal[] = [];
    for (const object of objects) {
      const ratio = Number(asFieldString(object.fields[BLOB_ASPECT_KEY]));
      if (!Number.isFinite(ratio) || ratio <= 0) continue;
      const value = ratio > 1.15 ? "Landscape" : ratio < 0.87 ? "Portrait" : "Square";
      out.push({
        objectId: object.id,
        field: fieldName,
        value,
        confidence: 1,
        evidence: `ratio ${ratio.toFixed(2)}`,
        providerId: "blob-aspect",
      });
    }
    return out;
  },
  proposeVocabulary: (objects, fieldName) =>
    tally(orientationProvider.propose!(objects, fieldName, {})),
};

// ---------------------------------------------------------------------------
// File type — "a PDF is a file before it is a picture".
// ---------------------------------------------------------------------------

const FILETYPE_FIELD = /^(file ?type|format|medium)$/i;

const fileTypeProvider: EnrichmentProvider = {
  id: "blob-type",
  kind: "deterministic",
  label: "file type",
  serves: (name) => FILETYPE_FIELD.test(name.trim()),
  propose: (objects, fieldName) => {
    const out: Proposal[] = [];
    for (const object of objects) {
      const mime = asFieldString(object.fields[BLOB_TYPE_KEY]);
      if (!mime) continue;
      const sub = mime.split("/").pop();
      if (!sub) continue;
      out.push({
        objectId: object.id,
        field: fieldName,
        value: sub.toUpperCase(),
        confidence: 1,
        evidence: mime,
        providerId: "blob-type",
      });
    }
    return out;
  },
  proposeVocabulary: (objects, fieldName) =>
    tally(fileTypeProvider.propose!(objects, fieldName, {})),
};

// ---------------------------------------------------------------------------
// Source domain — where a thing came from (47.9%).
// ---------------------------------------------------------------------------

const SOURCE_FIELD = /^(source|publication|site|domain|from)$/i;

const sourceDomainProvider: EnrichmentProvider = {
  id: "source-domain",
  kind: "deterministic",
  label: "source domain",
  serves: (name) => SOURCE_FIELD.test(name.trim()),
  propose: (objects, fieldName) => {
    const out: Proposal[] = [];
    for (const object of objects) {
      const domain = domainOf(object.sourceUrl || asFieldString(object.fields.source_url));
      if (!domain) continue;
      out.push({
        objectId: object.id,
        field: fieldName,
        value: domain,
        confidence: 1,
        evidence: domain,
        providerId: "source-domain",
      });
    }
    return out;
  },
  proposeVocabulary: (objects, fieldName) =>
    tally(sourceDomainProvider.propose!(objects, fieldName, {})),
};

// ---------------------------------------------------------------------------
// mymind's own per-type facts. Kept because the code is four lines, NOT
// because they cover anything: measured at 3.3% (creator) and 1.5% (year).
// Never promise coverage on these.
// ---------------------------------------------------------------------------

const CREATOR_FIELD = /^(author|creator|designer|artist|brand|foundry|photographer)$/i;
const YEAR_FIELD = /^(year|published|date|era|decade)$/i;

const creatorProvider: EnrichmentProvider = {
  id: "mymind-creator",
  kind: "deterministic",
  label: "mymind metadata",
  serves: (name) => CREATOR_FIELD.test(name.trim()),
  propose: (objects, fieldName) =>
    objects.flatMap((object) => {
      const creator = asFieldString(object.fields[CREATOR_KEY]);
      return creator
        ? [{
            objectId: object.id,
            field: fieldName,
            value: creator,
            confidence: 0.9,
            evidence: "mymind metadata",
            providerId: "mymind-creator",
          }]
        : [];
    }),
  proposeVocabulary: (objects, fieldName) =>
    tally(creatorProvider.propose!(objects, fieldName, {})),
};

const publishedProvider: EnrichmentProvider = {
  id: "mymind-published",
  kind: "deterministic",
  label: "mymind metadata",
  serves: (name) => YEAR_FIELD.test(name.trim()),
  propose: (objects, fieldName) =>
    objects.flatMap((object) => {
      const year = asFieldString(object.fields[PUBLISHED_KEY]);
      if (!/^\d{4}$/.test(year)) return [];
      const decade = /^(era|decade)$/i.test(fieldName.trim());
      return [{
        objectId: object.id,
        field: fieldName,
        value: decade ? `${year.slice(0, 3)}0s` : year,
        confidence: 0.9,
        evidence: `published ${year}`,
        providerId: "mymind-published",
      }];
    }),
  proposeVocabulary: (objects, fieldName) =>
    tally(publishedProvider.propose!(objects, fieldName, {})),
};

// ---------------------------------------------------------------------------
// Tags → any field. The general case, and the one that PROMOTES rather than
// copies: a matched tag stops being a loose tag and becomes structure.
// ---------------------------------------------------------------------------

/** Whole-word containment, so a `sans-serif typeface` tag can satisfy a
 * "Sans" option without `art` matching `artwork`. */
function tagMatchesOption(tag: string, option: string): "exact" | "contains" | null {
  const t = norm(tag);
  const o = norm(option);
  if (!o) return null;
  if (t === o) return "exact";
  const escaped = o.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  return new RegExp(`\\b${escaped}\\b`).test(t) ? "contains" : null;
}

const tagVocabularyProvider: EnrichmentProvider = {
  id: "tag-vocabulary",
  kind: "deterministic",
  label: "tags",
  // The fallback provider: it can serve any field, given options to match.
  serves: () => true,
  propose: (objects, fieldName, ctx) => {
    const options = ctx.field?.options ?? [];
    if (options.length === 0) return [];
    const multi = ctx.field?.type === "multi-select";
    const out: Proposal[] = [];
    for (const object of objects) {
      const hits: { option: string; tag: string; kind: "exact" | "contains" }[] = [];
      for (const tag of object.tags) {
        for (const option of options) {
          const kind = tagMatchesOption(tag, option);
          if (kind) hits.push({ option, tag, kind });
        }
      }
      if (hits.length === 0) continue;
      if (multi) {
        const seen = new Set<string>();
        const values = hits.filter((h) => !seen.has(h.option) && seen.add(h.option)).map((h) => h.option);
        out.push({
          objectId: object.id,
          field: fieldName,
          value: values,
          confidence: hits.every((h) => h.kind === "exact") ? 0.95 : 0.7,
          evidence: `tags: ${hits.map((h) => h.tag).join(", ")}`,
          providerId: "tag-vocabulary",
          fromTag: hits[0].tag,
        });
      } else {
        // Single-value field with two candidate tags is genuinely ambiguous —
        // prefer an exact match, and only if exactly one exists.
        const exact = hits.filter((h) => h.kind === "exact");
        const pick = exact.length === 1 ? exact[0] : hits.length === 1 ? hits[0] : null;
        if (!pick) continue;
        out.push({
          objectId: object.id,
          field: fieldName,
          value: pick.option,
          confidence: pick.kind === "exact" ? 0.95 : 0.7,
          evidence: `tag: ${pick.tag}`,
          providerId: "tag-vocabulary",
          fromTag: pick.tag,
        });
      }
    }
    return out;
  },
  /** With no declared options there is nothing to match against, so the
   * vocabulary a NEW field would get from tags is the object set's own most
   * common tags — the user picks which of them are really values of this
   * property. */
  proposeVocabulary: (objects) => {
    const counts = new Map<string, { display: string; count: number }>();
    for (const object of objects) {
      for (const tag of object.tags) {
        const key = norm(tag);
        const entry = counts.get(key);
        if (entry) entry.count++;
        else counts.set(key, { display: tag, count: 1 });
      }
    }
    return Array.from(counts.values())
      .filter((e) => e.count >= 2)
      .sort((a, b) => b.count - a.count)
      .slice(0, 40)
      .map((e) => ({ value: e.display, count: e.count }));
  },
};

// ---------------------------------------------------------------------------
// Registry
// ---------------------------------------------------------------------------

/** Order matters: the first provider that serves a field name is the one the
 * popover offers first. `tag-vocabulary` serves everything, so it sits last
 * as the general fallback. */
export const PROVIDERS: EnrichmentProvider[] = [
  paletteColorProvider,
  orientationProvider,
  fileTypeProvider,
  sourceDomainProvider,
  creatorProvider,
  publishedProvider,
  tagVocabularyProvider,
];

export function providersFor(fieldName: string): EnrichmentProvider[] {
  return PROVIDERS.filter((p) => p.serves(fieldName));
}

export function providerById(id: string): EnrichmentProvider | undefined {
  return PROVIDERS.find((p) => p.id === id);
}

/** What each provider would contribute to a field, for the "+ property"
 * popover: how many objects it would fill and with what vocabulary. Pure and
 * cheap enough to run live while the user types a field name. */
export type ProviderPreview = {
  provider: EnrichmentProvider;
  filled: number;
  vocabulary: VocabularyEntry[];
};

export function previewProviders(
  objects: DesignObject[],
  fieldName: string,
  field?: FacetField
): ProviderPreview[] {
  const name = fieldName.trim();
  if (!name) return [];
  return providersFor(name)
    .map((provider) => {
      const proposals = provider.propose?.(objects, name, { field }) ?? [];
      const vocabulary =
        proposals.length > 0
          ? tally(proposals)
          : (provider.proposeVocabulary?.(objects, name) ?? []);
      return {
        provider,
        filled: new Set(proposals.map((p) => p.objectId)).size,
        vocabulary,
      };
    })
    .filter((preview) => preview.filled > 0 || preview.vocabulary.length > 0);
}

/** Run one provider over a set of objects. The single entry point every
 * caller uses — property creation, the per-field "fill" affordance, the
 * post-sync pass — so there is one code path, not three. */
export function proposeWithProvider(
  provider: EnrichmentProvider,
  objects: DesignObject[],
  fieldName: string,
  field?: FacetField
): Proposal[] {
  return provider.propose?.(objects, fieldName.trim(), { field }) ?? [];
}

/** Frequency of proposed values, most common first — a proposal's value list
 * IS the field's option list. */
function tally(proposals: Proposal[]): VocabularyEntry[] {
  const counts = new Map<string, number>();
  for (const proposal of proposals) {
    const values = Array.isArray(proposal.value) ? proposal.value : [proposal.value];
    for (const value of values) counts.set(value, (counts.get(value) ?? 0) + 1);
  }
  return Array.from(counts.entries())
    .map(([value, count]) => ({ value, count }))
    .sort((a, b) => b.count - a.count);
}

/** Colour vocabulary in a stable, readable order rather than by frequency —
 * a Colour field whose options run Black→White→warm→hue reads like a swatch
 * card; one ordered by whatever the sample contained reads like noise. */
export function orderVocabulary(fieldName: string, vocabulary: VocabularyEntry[]): VocabularyEntry[] {
  if (!COLOR_FIELD.test(fieldName.trim())) return vocabulary;
  const rank = new Map<string, number>(COLOR_BUCKETS.map((name, i) => [name, i]));
  return [...vocabulary].sort(
    (a, b) => (rank.get(a.value) ?? 999) - (rank.get(b.value) ?? 999)
  );
}
