// ---------------------------------------------------------------------------
// Core object: one design reference. `fields` holds arbitrary custom
// metadata (e.g. { style: "Swiss" }) beyond the built-in tags array.
// ---------------------------------------------------------------------------
export type DesignObject = {
  id: string;
  title: string;
  imageUrl: string;
  tags: string[];
  fields: Record<string, string>;
  /** Manual collection ids this object has been curated into. Lives on our
   * side only — never written back to mymind. */
  manualCollectionIds: string[];
  sourceUrl?: string;
  createdAt: string;
  updatedAt: string;
  /** Tag name (normalized) -> mymind's raw flags bitmask (2=AI, 8=Manual),
   * present only on objects synced from mymind. Purely a display hint —
   * never used for filtering, and unrelated to our own local tagGroups. */
  tagFlags?: Record<string, number>;
  /** Where this object came from: locally imported test data ("sample") or
   * a real mymind sync ("mymind"). Optional because objects created before
   * this field existed lack it — treat fields.mymind_id as the tiebreaker. */
  source?: "sample" | "mymind";
  /** mymind's own embedding vector (from GET /objects?include=embeddings),
   * present only when a sync explicitly opted in — large, so not fetched by
   * default. Used entirely client-side for local cosine-similarity ranking;
   * never sent anywhere. mymind-sourced objects only. */
  embedding?: number[];
};

// ---------------------------------------------------------------------------
// Smart collection filter rules
// ---------------------------------------------------------------------------
export type FilterField = "tag" | "text" | (string & {});

export type FilterOperator = "includes" | "equals" | "contains" | "notEquals";

export type FilterCondition = {
  kind: "condition";
  id: string;
  /** "tag" checks the tags array, "text" checks title+tags+fields,
   * anything else is treated as a custom field key (e.g. "style"). */
  field: FilterField;
  operator: FilterOperator;
  value: string;
};

export type FilterGroup = {
  kind: "group";
  id: string;
  combinator: "AND" | "OR";
  children: (FilterCondition | FilterGroup)[];
};

export type SmartCollection = {
  id: string;
  type: "smart";
  name: string;
  rule: FilterGroup;
  createdAt: string;
};

export type FacetFieldType = "text" | "date" | "select";

export type FacetField = {
  name: string;
  type: FacetFieldType;
  /** Only meaningful when type === "select" — the fixed choice list. */
  options?: string[];
};

export type ManualCollection = {
  id: string;
  type: "manual";
  name: string;
  createdAt: string;
  /** Facet schema for this collection: a fixed, ordered set of typed fields
   * (e.g. [{name:"author",type:"text"}, {name:"fact-check",type:"select",
   * options:["unverified","verified","false"]}]) defined once per
   * collection. Every member item gets inputs for exactly these fields in
   * its detail panel — structured metadata per collection, never invented
   * per-object. Values live in each object's fields map, keyed by name.
   * @deprecated legacy shape, superseded by facetSchema — kept only so
   * collections created before this existed still read correctly via
   * normalizeFacetSchema() in lib/facetSchema.ts. */
  facetFields?: string[];
  facetSchema?: FacetField[];
};

export type Collection = SmartCollection | ManualCollection;

/** Tag name (normalized, lowercase) -> group label (e.g. "style"). Purely a
 * local Organizer concept for grouping/tinting tags — never sourced from
 * mymind, and optional per tag. */
export type TagGroups = Record<string, string>;

// ---------------------------------------------------------------------------
// View selection in the sidebar
// ---------------------------------------------------------------------------
export type ViewSelection =
  | { kind: "all" }
  | { kind: "unclassified" }
  | { kind: "collection"; collectionId: string }
  | { kind: "similar"; objectId: string };
