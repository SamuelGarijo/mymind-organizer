// ---------------------------------------------------------------------------
// Core object: one design reference. `fields` holds arbitrary custom
// metadata (e.g. { style: "Swiss" }) beyond the built-in tags array.
// ---------------------------------------------------------------------------
export type DesignObject = {
  id: string;
  title: string;
  imageUrl: string;
  tags: string[];
  /** A value is a plain string for every mymind-owned key and for `select`/
   * `date` role fields; `multi-select` role fields (issue #99) hold a
   * non-empty string[] instead — the empty-array case is never stored, the
   * key is just absent, so existing falsy "is this set?" checks keep
   * working unchanged for both shapes. */
  fields: Record<string, string | string[]>;
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
  /** The object's item type / role (Photo, Author, Book, Album…) — a single
   * app-wide concept (issue #84), NOT a per-collection facet value. The
   * display-cased name of a RoleDefinition in the store's `roles` map; the
   * role's field package determines which classification fields this object
   * gets everywhere it appears. Local-only — never written to mymind. */
  role?: string;
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

export type FacetFieldType = "date" | "select" | "multi-select";

export type FacetField = {
  name: string;
  type: FacetFieldType;
  /** Meaningful for "select" and "multi-select" — the fixed choice list. */
  options?: string[];
};

/** One item type (Photo, Author, Book, Album…) and the field package every
 * object carrying it gets, in every collection it appears in (issue #84 —
 * schema ownership lives here, not on collections). Editing `fields` is
 * retroactive: it changes what renders for every object with this role.
 * Classification fields only — select/multi-select/date, never free text
 * (that's what the description is for). Keyed in the store's `roles` map
 * by norm(name); `name` keeps display casing. */
export type RoleDefinition = {
  name: string;
  fields: FacetField[];
};

export type ManualCollection = {
  id: string;
  type: "manual";
  name: string;
  createdAt: string;
  /** Facet schema for this collection: a fixed, ordered set of typed fields
   * (e.g. [{name:"fact-check",type:"select",
   * options:["unverified","verified","false"]}]) defined once per
   * collection. Every member item gets inputs for exactly these fields in
   * its detail panel — structured metadata per collection, never invented
   * per-object. Values live in each object's fields map, keyed by name.
   * @deprecated legacy shape, superseded by facetSchema — kept only so
   * collections created before this existed still read correctly via
   * normalizeFacetSchema() in lib/facetSchema.ts. */
  facetFields?: string[];
  /** @deprecated Superseded by role-owned field packages (issue #84) —
   * collections no longer own schemas; an object's fields come from its
   * role's RoleDefinition. Kept only so pre-#84 persisted data and old
   * backups still parse (the leftover data is inert — no migration, per
   * CLAUDE.md's prototype-phase rule), and as a suggestion source for
   * lib/fieldCatalog.ts. Never rendered or edited anymore. */
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
