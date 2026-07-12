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
   * present only on objects synced from mymind. Feeds lib/tagOrigin.ts's
   * origin resolution (Curated Piles); unrelated to our own local
   * tagGroups. */
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

/** Where a tag actually came from — powers Curated Piles (only "user" tags
 * become piles) and, later, issue #80's tag→facet promotion path. "facet" is
 * reserved for that promotion (not produced by anything yet); the other
 * three are resolved live by lib/tagOrigin.ts, never stored on the object
 * itself. */
export type TagOrigin = "mymind" | "ai" | "user" | "facet";

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

/** "Same vibe as this specific object" as an editable, removable smart-
 * collection criterion (sidebar drag-to-create-smart-collection flow) —
 * reuses lib/hybridSimilarity.ts's existing 4-signal score instead of
 * inventing a second similarity metric. Lives alongside FilterCondition in
 * the same flat rows list so it can be combined with tag/facet conditions
 * or removed entirely, same as any other row. */
export type FilterSimilarity = {
  kind: "similarity";
  id: string;
  /** The seed object every candidate is scored against. */
  objectId: string;
  /** 0-1 threshold on lib/hybridSimilarity's score — a candidate matches
   * when its similarity to objectId is at or above this. */
  minScore: number;
};

export type FilterGroup = {
  kind: "group";
  id: string;
  combinator: "AND" | "OR";
  children: (FilterCondition | FilterGroup | FilterSimilarity)[];
};

export type SmartCollection = {
  id: string;
  type: "smart";
  name: string;
  rule: FilterGroup;
  createdAt: string;
  /** Channel-style framing for a collection (issue #87) — an Are.na-like
   * optional blurb shown in the collection header. Collection-layer only;
   * never touches an object or mymind. */
  description?: string;
  /** An existing object's id (never a new upload) used as the header's
   * hero image (issue #87). */
  heroImageObjectId?: string;
  /** Nests this collection under a manual collection (issue #126) — purely
   * organizational (sidebar tree placement), never limited in depth and
   * never used for matching: a smart collection's rule still scans the
   * whole library regardless of where it sits in the tree. Absent for a
   * top-level collection. Points at a ManualCollection's id — only manual
   * collections can hold children, per the issue's own scope. */
  parentId?: string;
};

export type FacetFieldType = "date" | "select" | "multi-select";

/** Objective (verifiable data — author, year, ISBN, movement) vs subjective
 * (the user's own interpretation — why it matters, what draws them to it).
 * Presentation-layer only (issue #100): purely how the detail view groups
 * fields visually, never a new field type and never stored on the value. */
export type FacetFieldGroup = "objective" | "subjective";

export type FacetField = {
  name: string;
  type: FacetFieldType;
  /** Meaningful for "select" and "multi-select" — the fixed choice list. */
  options?: string[];
  /** Unmarked (undefined) fields render neutrally, outside either section,
   * until explicitly classified — see FacetFieldGroup. */
  group?: FacetFieldGroup;
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
  /** Channel-style framing for a collection (issue #87) — an Are.na-like
   * optional blurb shown in the collection header. Collection-layer only;
   * never touches an object or mymind. */
  description?: string;
  /** An existing object's id (never a new upload) used as the header's
   * hero image (issue #87). */
  heroImageObjectId?: string;
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
  /** Nests this collection under another manual collection (issue #126) —
   * same organizational-only meaning as SmartCollection.parentId; a nested
   * manual collection's own members/count are still just its own direct
   * manualCollectionIds membership, never an aggregate of its children's. */
  parentId?: string;
  /** Tags auto-assigned to an object the moment it's dropped into this
   * collection (issue #126) — configured once per collection, applied via
   * the same addObjectTag path (and mymind push) a hand-typed tag uses, so
   * they show up as Curated Piles too. Never retroactive: only applied on
   * the drop/assign gesture itself, not backfilled onto existing members
   * when the list changes. */
  autoTags?: string[];
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
