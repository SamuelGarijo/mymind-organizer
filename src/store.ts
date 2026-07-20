import { create, type StoreApi } from "zustand";
import { persist } from "zustand/middleware";
import type {
  Collection,
  DesignObject,
  FacetField,
  FilterGroup,
  ManualCollection,
  RoleDefinition,
  SmartCollection,
  TagGroups,
  ViewSelection,
  ArenaPlacement,
  CanvasDoc,
  ObjectRelation,
  WritingDoc,
  DiscoverySession,
  ExternalSource,
} from "./types";
import { makeId } from "./lib/id";
import { matchesSmartCollection, norm } from "./lib/ruleEngine";
import type { FacetMode } from "./lib/quickFilter";
import type { ColorFilter } from "./lib/colorSearch";
import { createIdbStorage } from "./lib/idbStorage";
import { loadEmbeddings, saveEmbeddings } from "./lib/embeddingsStorage";
import { applyCuratedCollectionsSeed } from "./lib/curatedCollectionsSeed";
import { rankByHybridSimilarity, rankBySimilarityMode } from "./lib/hybridSimilarity";
import { sortByRecency } from "./lib/recency";
import { MYMIND_OWNED_FIELD_KEYS } from "./lib/mymindSync";
import type { Proposal } from "./lib/fieldExtraction";
import {
  addPromotion,
  revertPromotionsIntoField,
  type TagPromotions,
} from "./lib/tagPromotion";
import { parseBackup } from "./lib/backupValidation";
import { CURATED_ROLE_FIELDS } from "./lib/curatedRoleFields";
import { addMymindTag } from "./lib/mymindWrite";

export type ViewMode = "grid" | "table";
export type DetailViewMode = "side" | "centered";

/** One entry in the exploration back-stack (non-destructive navigation,
 * design-philosophy: "don't navigate away from a thought — open space
 * beside it"). Captures everything a "Same vibe" jump would otherwise
 * clobber, so returning restores it exactly — the browser-back-button
 * model, not the Workbench (that stays reserved for deliberate curation,
 * see #135 feedback: forcing same-vibe results into the Workbench hijacked
 * its drag-and-drop worktable for a purely exploratory glance). */
type ViewSnapshot = {
  view: ViewSelection;
  searchQuery: string;
  facetTags: string[];
  facetMode: FacetMode;
  excludedTags: string[];
  facetFieldFilter: { field: string; value: string } | null;
  colorFilter: ColorFilter | null;
  typeFilter: string;
  roleFilter: string;
  groupBy: string | null;
  scrollTop: number;
  /** What we're leaving — shown on the "← Back to {label}" pill. */
  label: string;
};

type State = {
  objects: Record<string, DesignObject>;
  collections: Record<string, Collection>;
  collectionOrder: string[];
  selectedView: ViewSelection;
  detailObjectId: string | null;
  /** Which object's media is being viewed fullscreen in the carousel
   * overlay — opened by clicking the preview image/video/pdf inside
   * DetailPanel (not a persistent display mode anymore, see detailViewMode
   * above). Independent of detailObjectId: the detail panel stays open
   * underneath while the carousel is up, so closing the carousel returns
   * to it rather than closing everything. */
  carouselObjectId: string | null;

  /** Tag name -> group label (e.g. "style"). Local-only, optional, never
   * sourced from mymind — the user assigns these themselves. */
  tagGroups: TagGroups;

  /** Quick-filter layer: narrows whatever the current view already shows.
   * Works the same in All/Unclassified/smart/manual views. */
  searchQuery: string;
  facetTags: string[];
  facetMode: FacetMode;
  /** Tags that must NOT be present — a separate set from facetTags so a tag
   * can be excluded without ever having been an include filter. */
  excludedTags: string[];
  /** Facet/role field value filter, e.g. { field: "Genre", value: "Portrait" } —
   * null means no filter. Independent of tag filtering; combines with it (AND). */
  facetFieldFilter: { field: string; value: string } | null;
  /** Color search (issue #69) — matches against mymind's own per-image
   * palette (BLOB_PALETTE_KEY), not any local color extraction. null means
   * no filter; combines with everything else (AND), same footing as
   * facetFieldFilter. */
  colorFilter: ColorFilter | null;
  /** mymind's entityType (fields.entity_type), e.g. "Image"/"Article" — "" means
   * no filter. A separate control from the free-text search box. */
  typeFilter: string;
  /** Our own item-type/role (object.role, issue #84) — independent of
   * mymind's entity_type above (an "Author Photography" role can span
   * multiple entity_types). "" means no filter. */
  roleFilter: string;
  /** Grid view's item-size control — a delta applied on top of the
   * container-width-based column count (lib/masonry.ts's columnsForWidth),
   * not an absolute column count, so it still adapts as the window/sidebar
   * resizes. Positive = smaller cards (more columns), negative = bigger. */
  gridZoom: number;

  /** Masonry grid vs. virtualized table — same filtered/sorted dataset. */
  viewMode: ViewMode;

  /** Detail preview display mode (issue #108) — a persistent user
   * preference (Preferences menu), not per-item state: "side" is the
   * original docked slide-over (default); "centered" is the same content
   * in a larger, centered modal; "carousel" is a separate image-only
   * browsing mode (DetailCarousel.tsx) with no metadata fields at all. */
  detailViewMode: DetailViewMode;

  importObjects: (objs: DesignObject[], tagGroupHints?: TagGroups) => void;
  /** Upserts objects synced from mymind. Unlike importObjects (JSON import,
   * a full replace), this preserves manualCollectionIds and createdAt across
   * re-syncs — local curation and first-seen time are ours. Tags are merged
   * (mymind's tags, minus anything in `localTagRemovals`, plus any tag that
   * only exists locally) rather than overwritten, so hand-added/removed
   * tags survive a Full resync instead of being reverted to mymind's raw
   * copy. Facet-schema field values are preserved the same way. Never
   * touches tagGroups. */
  syncMymindObjects: (objs: DesignObject[]) => void;
  /** Removes locally imported sample objects only — never anything synced
   * from mymind, and never calls mymind's API. Returns how many were removed. */
  deleteSampleObjects: () => number;
  /** mymind ids removed locally via `deleteObjectLocally`. mymind has no
   * DELETE endpoint we're authorized to use, so deletion is local-only —
   * this list is what keeps a later Full resync / Sync from mymind from
   * silently bringing a deleted object back. */
  deletedMymindIds: string[];
  /** Removes a single object from the local library. Never calls mymind's
   * API (no DELETE is authorized) — if it's a synced object, its mymind id
   * is tombstoned in `deletedMymindIds` so it doesn't reappear on the next
   * sync. */
  deleteObjectLocally: (id: string) => void;
  /** Bulk version of deleteObjectLocally, driven by a fresh set of ids
   * mymind currently has (see lib/mymindSync.ts's fetchAllMymindIds) — any
   * local mymind-sourced object missing from that set is tombstoned exactly
   * like a manual delete (same deletedMymindIds list, never calls mymind).
   * Returns how many were removed, for the sync-result message. Callers
   * MUST NOT invoke this with a possibly-partial id set (see that
   * function's `truncated` flag) — a partial set would wrongly tombstone
   * everything mymind just didn't get around to listing. */
  reconcileMymindDeletions: (presentIds: Set<string>) => number;
  /** Tag names the user has explicitly removed locally, per object id, that
   * originated from mymind. mymind has no tag-removal endpoint we're
   * authorized to use, so a removal is local-only — this is what stops
   * `syncMymindObjects` from silently re-adding a tag the user took off,
   * on every subsequent sync forever. */
  localTagRemovals: Record<string, string[]>;
  /** Tag names this app itself added by hand, per object id — the durable
   * "user" side of lib/tagOrigin.ts's origin resolution (Curated Piles).
   * Kept separate from mymind's own tagFlags because a tag added here can
   * get pushed to mymind and echoed back with mymind's own Manual flag on a
   * later sync; without this record, that round-trip would make it
   * indistinguishable from a tag someone typed inside mymind's own UI, and
   * it would quietly stop being a pile. */
  localUserTags: Record<string, string[]>;
  /** Adds a tag the user typed by hand — local-only, never pushed to mymind
   * itself by this action (the one write endpoint we're authorized to use
   * is the facet-field push in DetailPanel, not this — callers that DO want
   * to push, like DetailPanel's own "Add tag" box, call mymindWrite's
   * addMymindTag separately after this). Also clears any prior local
   * removal of the same tag, since re-adding it supersedes that, and
   * records it in localUserTags so its origin survives resync. */
  addObjectTag: (objectId: string, tag: string) => void;
  /** Records `value` as hand-picked in this app — the same durable
   * localUserTags signal addObjectTag already gives a typed tag, reusable
   * from any other direct-selection gesture (a facet chip pick, a
   * classification-panel/bucket drag-drop) so lib/tagOrigin.ts's
   * resolveTagOrigin reads "user" for those too. Never touches tags[]
   * (unlike addObjectTag) since these values usually already live in a
   * facet field, not the tags list. Deliberately never called from
   * applyRoleToObject's auto-fill — that path stays non-user by design. */
  recordUserValue: (objectId: string, value: string) => void;
  /** Removes a tag locally. mymind has no removal endpoint, so this only
   * ever affects our own copy — and records the removal so a later sync
   * doesn't bring the tag straight back. Also drops it from localUserTags,
   * so a later re-add (by hand or from mymind) resolves its origin fresh. */
  removeObjectTag: (objectId: string, tag: string) => void;
  setTagGroup: (tagName: string, group: string | null) => void;
  /** `parentId` nests the new collection under a manual collection (issue
   * #126) — organizational only, omit for a top-level collection. */
  addSmartCollection: (name: string, rule: FilterGroup, parentId?: string) => string;
  updateSmartCollection: (id: string, name: string, rule: FilterGroup) => void;
  addManualCollection: (name: string, facetSchema?: FacetField[], parentId?: string) => string;
  updateManualCollection: (
    id: string,
    patch: { name?: string; autoTags?: string[] }
  ) => void;

  /** Item types (issue #84): role name (normalized via norm()) → its
   * definition, including the field package every object with that role
   * gets, in every collection. Grows organically — assigning a role that
   * doesn't exist yet auto-creates an empty definition. */
  roles: Record<string, RoleDefinition>;
  /** Sets (or clears, with null) an object's role. Local-only — never
   * calls mymind. A brand-new role name is seeded from
   * lib/curatedRoleFields.ts when it matches the starter catalog, else an
   * empty field package; the stored `object.role` always uses the
   * definition's display casing. Also auto-fills any of the role's select
   * fields whose options exactly match one of the object's own tags (see
   * applyRoleToObject above) — the tag moves into the field, same as a
   * manual drag. */
  setObjectRole: (objectId: string, roleName: string | null) => void;
  /** Same as setObjectRole, applied to many objects in one atomic update —
   * the bulk "Auto-assign roles" action's write path (issue #104). Skips
   * any objectId that no longer exists; does not touch objects not listed. */
  bulkAssignRoles: (assignments: { objectId: string; role: string }[]) => void;
  /** Replaces a role's field package (and, optionally, its pinned
   * primaryFacets — omit to leave the current pins untouched). Retroactive
   * by construction: every consumer looks fields up through `roles`, so
   * objects with this role pick the change up everywhere immediately. */
  updateRoleFields: (
    roleName: string,
    fields: FacetField[],
    primaryFacets?: string[]
  ) => void;

  /** Which provider last wrote each auto-derived field value:
   * objectId → fieldName → providerId (lib/fieldExtraction.ts). Local-only,
   * persisted, additive on top of mymind exactly like manualCollectionIds.
   *
   * This is what makes enrichment REPEATABLE rather than a one-shot
   * migration: a later run may overwrite a value it produced itself (so an
   * improved rule retroactively improves the archive) while a hand-set value
   * — recorded in localUserTags — is never touched. Without it, re-running
   * could only ever fill blanks and a bad early guess would be permanent. */
  fieldProvenance: Record<string, Record<string, string>>;
  /** Tags promoted into facet values — see lib/tagPromotion.ts for why this
   * is an overlay and not an edit to `tags`. Local-only, persisted. */
  tagPromotions: TagPromotions;
  /** Applies enrichment proposals: writes values, records provenance, and
   * promotes any tag a value came from. Skips a proposal whose field value
   * is hand-set (localUserTags) or was written by a different, unrelated
   * provider — the caller has already gated on confidence. Returns nothing;
   * it's a single atomic update regardless of how many objects it touches. */
  applyProposals: (proposals: Proposal[]) => void;
  /** Adds one field to a role's package, seeded with `options`, and pins it
   * as a primary facet so it shows up in the collection ledger immediately.
   * The write half of the "+ property" gesture — a no-op if the role already
   * has a field with this name (case-insensitive). */
  addRoleField: (roleName: string, field: FacetField, pin?: boolean) => void;
  /** Clears a field's value on these objects and reverts any tag promoted
   * into it — the true inverse of an enrichment pass, so a rule that turned
   * out wrong leaves nothing behind. */
  clearFieldValues: (objectIds: string[], fieldName: string) => void;
  renameCollection: (id: string, name: string) => void;
  /** Updates a collection's optional channel-style metadata (issue #87) —
   * shared by both collection types, since description/hero image aren't
   * tied to the smart-vs-manual distinction. Collection-layer only, no
   * effect on objects or sync. Empty description collapses to unset;
   * `heroImageObjectId: null` explicitly clears the hero image. */
  updateCollectionMeta: (
    id: string,
    meta: { description: string; heroImageObjectId: string | null }
  ) => void;
  deleteCollection: (id: string) => void;

  /** Timestamp of the last successful auto-backup write, shown in the
   * sidebar. Undefined until auto-backup has been configured and run once. */
  lastBackupAt?: string;
  setLastBackupAt: (iso: string) => void;

  /** Whether the left sidebar is hidden — persisted like viewMode, so it
   * stays collapsed across reloads once the user hides it. */
  sidebarCollapsed: boolean;
  setSidebarCollapsed: (collapsed: boolean) => void;

  /** Temporary override that shows the sidebar even while `sidebarCollapsed`
   * is true, for the duration of a card drag — so there's a folder to drop
   * onto. Deliberately separate from `sidebarCollapsed` itself (never
   * persisted, never mutates the user's actual collapse preference): once
   * the drag ends this just flips back to false and the real preference
   * takes back over on its own, whether the drag ended in a drop or was
   * cancelled. */
  dragRevealSidebar: boolean;
  setDragRevealSidebar: (reveal: boolean) => void;

  /** Current multi-object selection in the Grid (issue #103) — Finder-style:
   * rectangle marquee, Shift-click range, Cmd/Ctrl-click toggle, all
   * combinable. Transient UI state: never persisted, cleared whenever the
   * view changes (Grid.tsx) since a range/marquee only makes sense against
   * the visual order of the objects currently on screen. Dragging any
   * selected card carries the whole set (Card.tsx); dragging an unselected
   * one carries just itself. */
  selectedObjectIds: Set<string>;
  /** The pivot for Shift-click range selection — the id of the last card
   * touched by a plain or Cmd-click. Shift-clicking again re-ranges from
   * this same anchor rather than the most recent Shift target, matching
   * Finder. Null once nothing has been individually clicked yet (e.g. right
   * after a marquee, or after clearing). */
  selectionAnchorId: string | null;
  /** Replaces the selection wholesale — used by marquee (recomputed every
   * mousemove), Shift-click (recomputed range), Cmd-click (toggled set),
   * and clearing (empty set + null anchor). No business logic here by
   * design; callers (Grid.tsx, Card.tsx) compute the new set. */
  setSelection: (ids: Set<string>, anchorId: string | null) => void;

  setSelectedView: (view: ViewSelection) => void;
  openDetail: (id: string) => void;
  closeDetail: () => void;
  openCarousel: (id: string) => void;
  closeCarousel: () => void;

  /** Whether the collection-workspace Board view (Kanban-style columns,
   * replacing Grid/Table in the main content area) is active. Ephemeral UI
   * state, not persisted, same treatment as detailObjectId — coexists with
   * it freely (opening an item's detail panel while Board is active is the
   * same as doing so from Grid/Table). */
  classificationPanelOpen: boolean;
  openClassificationPanel: () => void;
  closeClassificationPanel: () => void;

  /** Workbench — a provisional, reversible worktable (a separate concept
   * from Classify: no roles, no facets, no durable structure). Its
   * CONTENTS persist across reloads so temporary work is never silently
   * lost; whether the compartment is open is transient UI state. */
  /** Ephemeral — never persisted, same treatment as workbenchOpen (a hard
   * reload starting fresh is fine; this is a browsing convenience, not
   * durable state). */
  viewBackStack: ViewSnapshot[];
  /** Snapshots the CURRENT view+filters+scroll onto the stack, labeled
   * with what's being left, then jumps to `next`. */
  pushViewSnapshot: (next: ViewSelection, label: string, scrollTop: number) => void;
  /** Restores the top snapshot's view+filters (scroll restoration is the
   * caller's job — it needs the popped scrollTop after the DOM re-renders). */
  popViewSnapshot: () => void;
  dismissViewBackStack: () => void;

  /** Remembers a successful Are.na publication on the object itself, so the
   * export is not fire-and-forget (issue: Are.na follow-up #5). Appends to
   * the object's arenaPlacements; de-dupes by blockId so re-recording the
   * same block is idempotent. */
  recordArenaPlacement: (objectId: string, placement: ArenaPlacement) => void;

  /** One-line ephemeral notice for interaction feedback (e.g. why a drop
   * was rejected) — rendered in App's toast stack, auto-dismissed there.
   * Transient UI state, never persisted. */
  flashNotice: string | null;
  setFlashNotice: (notice: string | null) => void;

  /** Infinite canvases (issue #133) — presentation documents over the
   * knowledge model. The canvas stores positions/sizes/visual edges (a
   * tldraw snapshot); knowledge lives in objects and objectRelations. */
  canvases: Record<string, CanvasDoc>;
  canvasOrder: string[];
  /** Which canvas fills the main area — transient, like a view. */
  openCanvasId: string | null;
  /** User-dragged width of the canvas split (right membrane while a
   * canvas is open) — persisted so the chosen balance between slit and
   * canvas survives. null = default (window - 300). */
  canvasSplitWidth: number | null;
  setCanvasSplitWidth: (px: number | null) => void;
  openCanvas: (id: string | null) => void;
  /** Creates a canvas seeded with the given objects (from the bench, a
   * collection, anything) and returns its id. */
  createCanvas: (name: string, seedObjectIds: string[]) => string;
  saveCanvasSnapshot: (id: string, snapshot: unknown) => void;
  renameCanvas: (id: string, name: string) => void;
  /** Binds/unbinds a frame shape to a MEANING (issue #133 §7, semantic
   * sections): dropping an object into a bound frame applies that
   * metadata. Stored on the canvas doc (presentation layer owns which
   * rectangle means what; the applied metadata itself lands on objects). */
  setCanvasSemantic: (
    canvasId: string,
    frameId: string,
    semantic: { kind: "tag" | "collection"; value: string; label: string } | null
  ) => void;
  /** Deletes the canvas DOCUMENT only — objectRelations deliberately
   * survive (#133: relationships outlive the canvas). */
  deleteCanvas: (id: string) => void;

  /** Writing workspace (issue #137). Standalone documents live here; the
   * workspace can ALSO open a mymind Note object directly (the improved
   * note-editing space), in which case the body reads/writes the object's
   * NOTE_CONTENT_KEY and pushes via the sanctioned content endpoint. */
  writingDocs: Record<string, WritingDoc>;
  writingDocOrder: string[];
  /** What the workspace is editing — a doc of ours, or a bound Note. */
  openWritingTarget: { kind: "doc"; id: string } | { kind: "note"; objectId: string } | null;
  openWriting: (target: { kind: "doc"; id: string } | { kind: "note"; objectId: string } | null) => void;
  createWritingDoc: (title?: string) => string;
  updateWritingDoc: (id: string, patch: Partial<Pick<WritingDoc, "title" | "body">>) => void;
  deleteWritingDoc: (id: string) => void;
  /** Reader-set body size for the writing surface, in px (16–26) — a
   * reading/writing comfort setting, so it persists like gridZoom. */
  writingFontSize: number;
  setWritingFontSize: (px: number) => void;
  /** Dragged width of the writing column, in px (420–1100). null = the
   * default measure. Persisted like canvasSplitWidth: the balance the
   * author chose between line length and white space is theirs to keep. */
  writingPageWidth: number | null;
  setWritingPageWidth: (px: number | null) => void;

  /** Knowledge relationships between objects (issue #133) — created on a
   * canvas, stored independently of any canvas. Deduped by
   * source+target+type; visual-edge deletion does NOT remove these. */
  objectRelations: ObjectRelation[];
  addObjectRelation: (
    rel: Omit<ObjectRelation, "id" | "createdAt">
  ) => void;
  removeObjectRelation: (id: string) => void;

  /** Bottom Discovery membrane (issue #134) — transient like
   * workbenchOpen; the compartment's own content decides what discovery
   * means for the current view. */
  discoveryOpen: boolean;
  setDiscoveryOpen: (open: boolean) => void;

  /** The current discovery investigation (external discovery brief §6) — a
   * navigation entity: returnable, regeneratable, editable, and it
   * remembers which collection it grew from. Persisted so the last
   * search survives a reload. */
  discoverySession: DiscoverySession | null;
  setDiscoverySession: (session: DiscoverySession | null) => void;
  patchDiscoverySession: (patch: Partial<DiscoverySession>) => void;

  /** Imports an externally discovered thing as a real Organizer object —
   * keeping provider, original URL/id, the query that surfaced it, and
   * the context it grew from (ExternalSource provenance). Lands on the
   * workbench (the importing hand's natural destination). Idempotent per
   * provider id: re-importing the same block just returns the existing
   * object's id. */
  importExternalObject: (input: {
    title: string;
    imageUrl: string;
    sourceUrl: string;
    provider: ExternalSource["provider"];
    externalId?: string;
    discoveryQuery?: string;
    discoveredFromObjectIds?: string[];
  }) => string;

  workbenchIds: string[];
  workbenchOpen: boolean;
  setWorkbenchOpen: (open: boolean) => void;
  /** Dedupe-append — dragging the same thing twice never duplicates it. */
  addToWorkbench: (ids: string[]) => void;
  removeFromWorkbench: (id: string) => void;
  /** Moves `id` to sit immediately before `beforeId` (or to the end when
   * beforeId is null) — the drag-reorder primitive. */
  reorderWorkbench: (id: string, beforeId: string | null) => void;
  clearWorkbench: () => void;

  setSearchQuery: (query: string) => void;
  toggleFacetTag: (tag: string) => void;
  setFacetMode: (mode: FacetMode) => void;
  clearFacetTags: () => void;
  toggleExcludeTag: (tag: string) => void;
  clearExcludedTags: () => void;
  setFacetFieldFilter: (filter: { field: string; value: string } | null) => void;
  setColorFilter: (filter: ColorFilter | null) => void;
  setTypeFilter: (type: string) => void;
  setRoleFilter: (role: string) => void;
  /** Grid/Table grouping lens — lives in the store (not per-view local
   * state) so the TopBar's filter popover, Grid, and Table all read the
   * same value (the "Group by should live inside filters" call). Reset on
   * view change by App, like roleFilter. */
  groupBy: string | null;
  setGroupBy: (field: string | null) => void;
  setGridZoom: (zoom: number) => void;
  setViewMode: (mode: ViewMode) => void;
  setDetailViewMode: (mode: DetailViewMode) => void;

  updateObject: (
    id: string,
    patch: Partial<Pick<DesignObject, "title" | "tags" | "fields">>
  ) => void;
  assignToManualCollection: (objectId: string, collectionId: string) => void;
  removeFromManualCollection: (objectId: string, collectionId: string) => void;
  /** Atomically moves a plain tag onto a facet field, removing `tag` from
   * the object's tags either way — one store update, not two, so there's
   * no risk of a half-applied state if a caller reads it back mid-way.
   * mode "replace" sets `fields[fieldName]` to `value` (select/date);
   * "append" adds `value` into that field's array instead, creating it if
   * absent and no-op if already present (multi-select, issue #99). */
  moveTagToField: (
    objectId: string,
    tag: string,
    fieldName: string,
    value: string,
    mode: "replace" | "append"
  ) => void;
  /** Bucket-drag write path (issue #102): sets/appends a facet field's
   * value for one or more objects in one atomic update. `value === ""`
   * clears the field entirely regardless of mode — the "drag onto
   * Unassigned" case. Skips any objectId that no longer exists; unlike
   * moveTagToField this never touches tags, since a bucket drag doesn't
   * originate from a tag pill. */
  assignFieldValue: (
    objectIds: string[],
    fieldName: string,
    value: string,
    mode: "replace" | "append"
  ) => void;
  /** Adds a new option to every role's field definition sharing this exact
   * name (case-insensitive) — field names are shared vocabulary across
   * roles (issue #96), so a value created via one role's grouped view
   * (issue #102's "drop onto a new bucket") is available from every other
   * role reusing that field name too, not just wherever the drop happened
   * to originate. No-op if the option already exists on a given field. */
  addFieldOption: (fieldName: string, option: string) => void;

  exportDataString: () => string;
  /** Full restore from a backup produced by exportDataString — replaces
   * objects/collections/tagGroups wholesale. Used for disaster recovery,
   * not everyday import. Validates structure first (lib/backupValidation.ts)
   * and throws BackupValidationError without touching the store at all if
   * the shape looks truncated/corrupted — callers should catch this and
   * show `err.message` directly, it's already written to be user-facing. */
  restoreFromBackup: (json: string) => void;
};

/** What actually gets persisted — deliberately narrower than State. See the
 * `partialize` comment below for why the rest is excluded. */
type PersistedState = Pick<
  State,
  | "objects"
  | "collections"
  | "collectionOrder"
  | "tagGroups"
  | "roles"
  | "lastBackupAt"
  | "viewMode"
  | "detailViewMode"
  | "deletedMymindIds"
  | "localTagRemovals"
  | "workbenchIds"
  | "canvases"
  | "canvasOrder"
  | "objectRelations"
  | "discoverySession"
  | "canvasSplitWidth"
  | "writingDocs"
  | "writingDocOrder"
  | "writingFontSize"
  | "writingPageWidth"
  | "localUserTags"
  | "fieldProvenance"
  | "tagPromotions"
  | "sidebarCollapsed"
>;

// Captured synchronously when the creator below runs (before `create()`
// returns), so `onRehydrateStorage`'s callback — which only fires later,
// once rehydration finishes — can reach the store without a circular
// reference to `useStore` itself.
let storeApi: StoreApi<State> | null = null;

/**
 * Applies a role to one object: creates its RoleDefinition (seeded from
 * CURATED_ROLE_FIELDS when the name is brand new — see that file) if it
 * doesn't exist yet, then auto-fills any of the role's empty select fields
 * from a tag that's an exact (case-insensitive) match for one of the
 * field's options (issue #104, closed 2026-07-11). Skipped per-field when
 * more than one of the object's tags matches — ambiguous, left for manual
 * resolution rather than guessed wrong.
 *
 * Changed 2026-07-20: a matched tag is now PROMOTED, not deleted. This used
 * to filter the tag out of `obj.tags` and tombstone it in localTagRemovals,
 * which was survivable for a per-object gesture but not for archive-scale
 * enrichment — a rule that fired wrongly would have destroyed thousands of
 * tags irrecoverably. Now the tag stays on the object and a `tagPromotions`
 * record hides it from the generic tag presentation instead, keeping
 * provenance and making the whole thing reversible. See lib/tagPromotion.ts.
 *
 * Shared by setObjectRole (one object) and bulkAssignRoles (many at
 * once) so both paths get identical behavior for free.
 */
function applyRoleToObject(
  obj: DesignObject,
  roleName: string,
  roles: Record<string, RoleDefinition>
): {
  object: DesignObject;
  roles: Record<string, RoleDefinition>;
  promotions: { tag: string; field: string; value: string }[];
} {
  const trimmed = roleName.trim();
  const key = norm(trimmed);
  const existingDef = roles[key];
  const nextRoles = existingDef
    ? roles
    : { ...roles, [key]: { name: trimmed, fields: CURATED_ROLE_FIELDS[key] ?? [] } };
  const def = nextRoles[key];

  const fields = { ...obj.fields };
  const promotions: { tag: string; field: string; value: string }[] = [];
  for (const field of def.fields) {
    if (field.type === "date" || fields[field.name] || !field.options?.length) continue;
    const matches = obj.tags.filter((t) => field.options!.some((opt) => norm(opt) === norm(t)));
    if (field.type === "select") {
      // Exactly one match or skip — an object with two candidate tags for a
      // single-value field is ambiguous, left for manual resolution.
      if (matches.length !== 1) continue;
      const [tag] = matches;
      const value = field.options.find((opt) => norm(opt) === norm(tag))!;
      fields[field.name] = value;
      promotions.push({ tag, field: field.name, value });
    } else {
      // multi-select: no ambiguity concept — an object can legitimately
      // carry more than one value here, so every matching tag moves in.
      if (matches.length === 0) continue;
      const values = matches.map((tag) => field.options!.find((opt) => norm(opt) === norm(tag))!);
      fields[field.name] = values;
      matches.forEach((tag, i) => promotions.push({ tag, field: field.name, value: values[i] }));
    }
  }

  return { object: { ...obj, role: def.name, fields }, roles: nextRoles, promotions };
}

export const useStore = create<State>()(
  persist(
    (set, get, api) => {
      storeApi = api;
      return {
      objects: {},
      collections: {},
      collectionOrder: [],
      selectedView: { kind: "all" },
      detailObjectId: null,
      carouselObjectId: null,

      tagGroups: {},

      searchQuery: "",
      facetTags: [],
      facetMode: "AND",
      excludedTags: [],
      facetFieldFilter: null,
      colorFilter: null,
      typeFilter: "",
      roleFilter: "",
      groupBy: null,
      gridZoom: 0,
      viewMode: "grid",
      detailViewMode: "side",

      deletedMymindIds: [],
      localTagRemovals: {},
      localUserTags: {},

      lastBackupAt: undefined,
      setLastBackupAt: (iso) => set({ lastBackupAt: iso }),

      // Collapsed by default (design-philosophy N20): the left panel holds
      // FIXED concepts — interface controls and deliberately-created
      // collections — not things conditional on the current exploration, so
      // its resting state is the thin rail. Expands on drag-toward or
      // intentional open; a persisted user choice overrides this default.
      sidebarCollapsed: true,
      setSidebarCollapsed: (collapsed) => set({ sidebarCollapsed: collapsed }),

      dragRevealSidebar: false,
      setDragRevealSidebar: (reveal) => set({ dragRevealSidebar: reveal }),

      selectedObjectIds: new Set(),
      selectionAnchorId: null,
      setSelection: (ids, anchorId) => set({ selectedObjectIds: ids, selectionAnchorId: anchorId }),

      importObjects: (objs, tagGroupHints) =>
        set((s) => {
          const next = { ...s.objects };
          for (const obj of objs) next[obj.id] = obj;
          // Hints (e.g. a "style" value seen at import time) seed the local
          // registry but never override a group the user already assigned.
          const tagGroups = tagGroupHints
            ? { ...tagGroupHints, ...s.tagGroups }
            : s.tagGroups;
          return { objects: next, tagGroups };
        }),

      syncMymindObjects: (objs) =>
        set((s) => {
          const next = { ...s.objects };
          const tombstoned = new Set(s.deletedMymindIds);
          for (const obj of objs) {
            // Locally deleted — don't let a resync resurrect it.
            if (tombstoned.has(obj.id)) continue;
            const existing = next[obj.id];
            // mymind's fresh tag list, minus anything the user explicitly
            // removed locally, plus any tag that only exists in our copy
            // (hand-added, or facet-pushed but not yet reflected back by
            // mymind) — never a flat overwrite, or every local tag edit
            // would be reverted the next time this object is touched by a
            // sync (in practice: every object, on a Full resync).
            const removedTags = new Set(s.localTagRemovals[obj.id] ?? []);
            const localOnlyTags = existing
              ? existing.tags.filter((t) => !obj.tags.includes(t) && !removedTags.has(t))
              : [];
            const tags = [...obj.tags.filter((t) => !removedTags.has(t)), ...localOnlyTags];
            next[obj.id] = existing
              ? {
                  ...obj,
                  tags,
                  manualCollectionIds: existing.manualCollectionIds,
                  // Local-only, never from mymind — a resync must not wipe
                  // it (same invariant as manualCollectionIds above).
                  arenaPlacements: existing.arenaPlacements,
                  createdAt: existing.createdAt,
                  // Embeddings are opt-in per sync (large payload) — a sync
                  // that didn't request them shouldn't erase one fetched
                  // earlier.
                  embedding: obj.embedding ?? existing.embedding,
                  // The item type is a local classification mymind knows
                  // nothing about — the fresh `obj` never carries one, so
                  // without this line every resync would silently strip it
                  // (the same failure mode tags/facet values had before
                  // their explicit preservation above).
                  role: existing.role,
                  // `obj.fields` only ever carries mymind-owned keys (see
                  // MYMIND_OWNED_FIELD_KEYS) — anything else in the existing
                  // object's fields is user-entered (facet schema values)
                  // and would otherwise be silently wiped by every resync
                  // that happens to touch this object.
                  fields: {
                    ...Object.fromEntries(
                      Object.entries(existing.fields).filter(
                        ([key]) => !(MYMIND_OWNED_FIELD_KEYS as readonly string[]).includes(key)
                      )
                    ),
                    ...obj.fields,
                  },
                }
              : { ...obj, tags };
          }
          // Persisted separately, on its own debounce — see
          // lib/embeddingsStorage.ts for why this can't just ride along with
          // the main store's own (now-cheap) persistence path.
          saveEmbeddings(next);
          return { objects: next };
        }),

      deleteSampleObjects: () => {
        const s = get();
        const doomed = Object.values(s.objects).filter(isSampleObject);
        if (doomed.length === 0) return 0;
        set((st) => {
          const objects = { ...st.objects };
          for (const obj of doomed) delete objects[obj.id];
          const detailObjectId =
            st.detailObjectId && !objects[st.detailObjectId] ? null : st.detailObjectId;
          return { objects, detailObjectId };
        });
        return doomed.length;
      },

      deleteObjectLocally: (id) =>
        set((s) => {
          const existing = s.objects[id];
          if (!existing) return {};
          const { [id]: _removed, ...objects } = s.objects;
          // `id` IS the mymind id for synced objects (see mapMymindObjectToDesignObject)
          // — tombstone it so a later resync doesn't bring it back.
          const deletedMymindIds =
            existing.source === "mymind" && !s.deletedMymindIds.includes(id)
              ? [...s.deletedMymindIds, id]
              : s.deletedMymindIds;
          const detailObjectId = s.detailObjectId === id ? null : s.detailObjectId;
          return { objects, deletedMymindIds, detailObjectId };
        }),

      reconcileMymindDeletions: (presentIds) => {
        let removed = 0;
        set((s) => {
          const objects = { ...s.objects };
          let deletedMymindIds = s.deletedMymindIds;
          for (const obj of Object.values(s.objects)) {
            if (obj.source !== "mymind" || presentIds.has(obj.id)) continue;
            delete objects[obj.id];
            removed++;
            if (!deletedMymindIds.includes(obj.id)) {
              deletedMymindIds = [...deletedMymindIds, obj.id];
            }
          }
          if (removed === 0) return {};
          const detailObjectId =
            s.detailObjectId && !objects[s.detailObjectId] ? null : s.detailObjectId;
          return { objects, deletedMymindIds, detailObjectId };
        });
        return removed;
      },

      addObjectTag: (objectId, tag) =>
        set((s) => {
          const existing = s.objects[objectId];
          if (!existing || existing.tags.includes(tag)) return {};
          const removals = s.localTagRemovals[objectId];
          const localTagRemovals = removals?.includes(tag)
            ? { ...s.localTagRemovals, [objectId]: removals.filter((t) => t !== tag) }
            : s.localTagRemovals;
          const userTags = s.localUserTags[objectId] ?? [];
          const localUserTags = userTags.includes(tag)
            ? s.localUserTags
            : { ...s.localUserTags, [objectId]: [...userTags, tag] };
          return {
            objects: {
              ...s.objects,
              [objectId]: {
                ...existing,
                tags: [...existing.tags, tag],
                updatedAt: new Date().toISOString(),
              },
            },
            localTagRemovals,
            localUserTags,
          };
        }),

      recordUserValue: (objectId, value) =>
        set((s) => {
          if (!value || !s.objects[objectId]) return {};
          const userTags = s.localUserTags[objectId] ?? [];
          if (userTags.includes(value)) return {};
          return { localUserTags: { ...s.localUserTags, [objectId]: [...userTags, value] } };
        }),

      removeObjectTag: (objectId, tag) =>
        set((s) => {
          const existing = s.objects[objectId];
          if (!existing) return {};
          const removals = s.localTagRemovals[objectId] ?? [];
          const userTags = s.localUserTags[objectId];
          const localUserTags = userTags?.includes(tag)
            ? { ...s.localUserTags, [objectId]: userTags.filter((t) => t !== tag) }
            : s.localUserTags;
          return {
            objects: {
              ...s.objects,
              [objectId]: {
                ...existing,
                tags: existing.tags.filter((t) => t !== tag),
                updatedAt: new Date().toISOString(),
              },
            },
            localTagRemovals: removals.includes(tag)
              ? s.localTagRemovals
              : { ...s.localTagRemovals, [objectId]: [...removals, tag] },
            localUserTags,
          };
        }),

      setTagGroup: (tagName, group) =>
        set((s) => {
          const key = norm(tagName);
          if (!group || group.trim() === "") {
            const { [key]: _removed, ...rest } = s.tagGroups;
            return { tagGroups: rest };
          }
          return { tagGroups: { ...s.tagGroups, [key]: group.trim() } };
        }),

      addSmartCollection: (name, rule, parentId) => {
        const id = makeId("smart");
        const collection: SmartCollection = {
          id,
          type: "smart",
          name,
          rule,
          createdAt: new Date().toISOString(),
          ...(parentId ? { parentId } : {}),
        };
        set((s) => ({
          collections: { ...s.collections, [id]: collection },
          collectionOrder: [...s.collectionOrder, id],
        }));
        return id;
      },

      updateSmartCollection: (id, name, rule) =>
        set((s) => {
          const existing = s.collections[id];
          if (!existing || existing.type !== "smart") return {};
          const updated: SmartCollection = { ...existing, name, rule };
          return { collections: { ...s.collections, [id]: updated } };
        }),

      addManualCollection: (name, facetSchema, parentId) => {
        const id = makeId("manual");
        const collection: ManualCollection = {
          id,
          type: "manual",
          name,
          createdAt: new Date().toISOString(),
          ...(facetSchema && facetSchema.length > 0 ? { facetSchema } : {}),
          ...(parentId ? { parentId } : {}),
        };
        set((s) => ({
          collections: { ...s.collections, [id]: collection },
          collectionOrder: [...s.collectionOrder, id],
        }));
        return id;
      },

      updateManualCollection: (id, patch) =>
        set((s) => {
          const existing = s.collections[id];
          if (!existing || existing.type !== "manual") return {};
          const updated: ManualCollection = {
            ...existing,
            ...(patch.name !== undefined ? { name: patch.name } : {}),
            ...(patch.autoTags !== undefined ? { autoTags: patch.autoTags } : {}),
          };
          return { collections: { ...s.collections, [id]: updated } };
        }),

      roles: {},

      setObjectRole: (objectId, roleName) =>
        set((s) => {
          const obj = s.objects[objectId];
          if (!obj) return {};
          if (roleName === null) {
            return { objects: { ...s.objects, [objectId]: { ...obj, role: undefined } } };
          }
          if (!roleName.trim()) return {};
          const { object, roles, promotions } = applyRoleToObject(obj, roleName, s.roles);
          let tagPromotions = s.tagPromotions;
          for (const promotion of promotions) {
            tagPromotions = addPromotion(tagPromotions, objectId, promotion);
          }
          return { objects: { ...s.objects, [objectId]: object }, roles, tagPromotions };
        }),

      bulkAssignRoles: (assignments) =>
        set((s) => {
          const objects = { ...s.objects };
          let roles = s.roles;
          let tagPromotions = s.tagPromotions;
          for (const { objectId, role } of assignments) {
            const obj = objects[objectId];
            if (!obj) continue;
            const applied = applyRoleToObject(obj, role, roles);
            objects[objectId] = applied.object;
            roles = applied.roles;
            for (const promotion of applied.promotions) {
              tagPromotions = addPromotion(tagPromotions, objectId, promotion);
            }
          }
          return { objects, roles, tagPromotions };
        }),

      updateRoleFields: (roleName, fields, primaryFacets) =>
        set((s) => {
          const key = norm(roleName);
          const existing = s.roles[key];
          const def: RoleDefinition = {
            ...(existing ?? { name: roleName.trim() }),
            fields,
            ...(primaryFacets !== undefined ? { primaryFacets } : {}),
          };
          return { roles: { ...s.roles, [key]: def } };
        }),

      fieldProvenance: {},
      tagPromotions: {},

      addRoleField: (roleName, field, pin = true) =>
        set((s) => {
          const key = norm(roleName);
          const existing = s.roles[key];
          const base: RoleDefinition = existing ?? { name: roleName.trim(), fields: [] };
          if (base.fields.some((f) => norm(f.name) === norm(field.name))) return {};
          const primaryFacets = base.primaryFacets ?? [];
          return {
            roles: {
              ...s.roles,
              [key]: {
                ...base,
                fields: [...base.fields, field],
                // Pinning is what makes the new property visible in the
                // ledger at all — a property you just asked for that doesn't
                // appear anywhere would read as the gesture having failed.
                ...(pin && primaryFacets.length < 5
                  ? { primaryFacets: [...primaryFacets, field.name] }
                  : {}),
              },
            },
          };
        }),

      applyProposals: (proposals) =>
        set((s) => {
          if (proposals.length === 0) return {};
          const objects = { ...s.objects };
          const fieldProvenance = { ...s.fieldProvenance };
          let tagPromotions = s.tagPromotions;
          const now = new Date().toISOString();
          let changed = false;

          for (const proposal of proposals) {
            const object = objects[proposal.objectId];
            if (!object) continue;

            // A hand-set value outranks any rule, forever. localUserTags is
            // the app's existing record of "Samuel picked this himself" —
            // reused here rather than inventing a second notion of manual.
            const userValues = s.localUserTags[proposal.objectId] ?? [];
            const current = object.fields[proposal.field];
            const currentList = Array.isArray(current) ? current : current ? [current] : [];
            if (currentList.some((v) => userValues.includes(v))) continue;

            // A value this pipeline wrote may be replaced by a later, better
            // run (that's what makes enrichment improvable); a value that
            // arrived some other way is left alone.
            const writtenBy = fieldProvenance[proposal.objectId]?.[proposal.field];
            if (currentList.length > 0 && !writtenBy) continue;

            objects[proposal.objectId] = {
              ...object,
              fields: { ...object.fields, [proposal.field]: proposal.value },
              updatedAt: now,
            };
            fieldProvenance[proposal.objectId] = {
              ...fieldProvenance[proposal.objectId],
              [proposal.field]: proposal.providerId,
            };
            if (proposal.fromTag) {
              tagPromotions = addPromotion(tagPromotions, proposal.objectId, {
                tag: proposal.fromTag,
                field: proposal.field,
                value: Array.isArray(proposal.value) ? proposal.value[0] : proposal.value,
              });
            }
            changed = true;
          }

          return changed ? { objects, fieldProvenance, tagPromotions } : {};
        }),

      clearFieldValues: (objectIds, fieldName) =>
        set((s) => {
          const objects = { ...s.objects };
          const fieldProvenance = { ...s.fieldProvenance };
          const now = new Date().toISOString();
          let changed = false;
          for (const id of objectIds) {
            const object = objects[id];
            if (!object || object.fields[fieldName] === undefined) continue;
            const { [fieldName]: _cleared, ...rest } = object.fields;
            objects[id] = { ...object, fields: rest, updatedAt: now };
            if (fieldProvenance[id]) {
              const { [fieldName]: _p, ...restProv } = fieldProvenance[id];
              if (Object.keys(restProv).length === 0) delete fieldProvenance[id];
              else fieldProvenance[id] = restProv;
            }
            changed = true;
          }
          if (!changed) return {};
          // Any tag promoted into this field comes back — otherwise it would
          // stay hidden from the tag bar with no value to justify it.
          return {
            objects,
            fieldProvenance,
            tagPromotions: revertPromotionsIntoField(s.tagPromotions, objectIds, fieldName),
          };
        }),

      renameCollection: (id, name) =>
        set((s) => {
          const existing = s.collections[id];
          if (!existing) return {};
          return { collections: { ...s.collections, [id]: { ...existing, name } } };
        }),

      updateCollectionMeta: (id, meta) =>
        set((s) => {
          const existing = s.collections[id];
          if (!existing) return {};
          return {
            collections: {
              ...s.collections,
              [id]: {
                ...existing,
                description: meta.description.trim() || undefined,
                heroImageObjectId: meta.heroImageObjectId ?? undefined,
              },
            },
          };
        }),

      deleteCollection: (id) =>
        set((s) => {
          const { [id]: _removed, ...rest } = s.collections;
          const objects = { ...s.objects };
          for (const objId of Object.keys(objects)) {
            if (objects[objId].manualCollectionIds.includes(id)) {
              objects[objId] = {
                ...objects[objId],
                manualCollectionIds: objects[objId].manualCollectionIds.filter(
                  (c) => c !== id
                ),
              };
            }
          }
          const selectedView =
            s.selectedView.kind === "collection" && s.selectedView.collectionId === id
              ? { kind: "all" as const }
              : s.selectedView;
          return {
            collections: rest,
            collectionOrder: s.collectionOrder.filter((c) => c !== id),
            objects,
            selectedView,
          };
        }),

      setSelectedView: (view) =>
        set({
          selectedView: view,
          facetTags: [],
          excludedTags: [],
          facetFieldFilter: null,
          colorFilter: null,
        }),
      openDetail: (id) => set({ detailObjectId: id }),
      closeDetail: () => set({ detailObjectId: null }),
      openCarousel: (id) => set({ carouselObjectId: id }),
      closeCarousel: () => set({ carouselObjectId: null }),

      classificationPanelOpen: false,
      openClassificationPanel: () => set({ classificationPanelOpen: true }),
      closeClassificationPanel: () => set({ classificationPanelOpen: false }),

      viewBackStack: [],
      pushViewSnapshot: (next, label, scrollTop) =>
        set((s) => ({
          viewBackStack: [
            ...s.viewBackStack,
            {
              view: s.selectedView,
              searchQuery: s.searchQuery,
              facetTags: s.facetTags,
              facetMode: s.facetMode,
              excludedTags: s.excludedTags,
              facetFieldFilter: s.facetFieldFilter,
              colorFilter: s.colorFilter,
              typeFilter: s.typeFilter,
              roleFilter: s.roleFilter,
              groupBy: s.groupBy,
              scrollTop,
              label,
            },
          ],
          selectedView: next,
        })),
      popViewSnapshot: () =>
        set((s) => {
          const top = s.viewBackStack[s.viewBackStack.length - 1];
          if (!top) return {};
          return {
            viewBackStack: s.viewBackStack.slice(0, -1),
            selectedView: top.view,
            searchQuery: top.searchQuery,
            facetTags: top.facetTags,
            facetMode: top.facetMode,
            excludedTags: top.excludedTags,
            facetFieldFilter: top.facetFieldFilter,
            colorFilter: top.colorFilter,
            typeFilter: top.typeFilter,
            roleFilter: top.roleFilter,
            groupBy: top.groupBy,
          };
        }),
      dismissViewBackStack: () => set({ viewBackStack: [] }),

      recordArenaPlacement: (objectId, placement) =>
        set((st) => {
          const obj = st.objects[objectId];
          if (!obj) return {};
          const existing = obj.arenaPlacements ?? [];
          if (existing.some((p) => p.blockId === placement.blockId)) return {};
          return {
            objects: {
              ...st.objects,
              [objectId]: { ...obj, arenaPlacements: [...existing, placement] },
            },
          };
        }),

      flashNotice: null,
      setFlashNotice: (notice) => set({ flashNotice: notice }),

      canvases: {},
      canvasOrder: [],
      openCanvasId: null,
      canvasSplitWidth: null,
      setCanvasSplitWidth: (px) => set({ canvasSplitWidth: px }),
      openCanvas: (id) => set({ openCanvasId: id }),
      createCanvas: (name, seedObjectIds) => {
        const id = makeId("canvas");
        const doc: CanvasDoc = {
          id,
          name: name.trim() || "Untitled canvas",
          createdAt: new Date().toISOString(),
          seedObjectIds: [...seedObjectIds],
        };
        set((st) => ({
          canvases: { ...st.canvases, [id]: doc },
          canvasOrder: [...st.canvasOrder, id],
        }));
        return id;
      },
      saveCanvasSnapshot: (id, snapshot) =>
        set((st) => {
          const doc = st.canvases[id];
          if (!doc) return {};
          return { canvases: { ...st.canvases, [id]: { ...doc, snapshot } } };
        }),
      setCanvasSemantic: (canvasId, frameId, semantic) =>
        set((st) => {
          const doc = st.canvases[canvasId];
          if (!doc) return {};
          const semantics = { ...(doc.semantics ?? {}) };
          if (semantic) semantics[frameId] = semantic;
          else delete semantics[frameId];
          return { canvases: { ...st.canvases, [canvasId]: { ...doc, semantics } } };
        }),
      renameCanvas: (id, name) =>
        set((st) => {
          const doc = st.canvases[id];
          if (!doc || !name.trim()) return {};
          return { canvases: { ...st.canvases, [id]: { ...doc, name: name.trim() } } };
        }),
      deleteCanvas: (id) =>
        set((st) => {
          const canvases = { ...st.canvases };
          delete canvases[id];
          return {
            canvases,
            canvasOrder: st.canvasOrder.filter((x) => x !== id),
            openCanvasId: st.openCanvasId === id ? null : st.openCanvasId,
            // objectRelations untouched — knowledge outlives the canvas.
          };
        }),

      writingDocs: {},
      writingDocOrder: [],
      openWritingTarget: null,
      openWriting: (target) => set({ openWritingTarget: target }),
      writingFontSize: 19,
      setWritingFontSize: (px) => set({ writingFontSize: Math.max(16, Math.min(26, px)) }),
      writingPageWidth: null,
      setWritingPageWidth: (px) =>
        set({ writingPageWidth: px === null ? null : Math.max(420, Math.min(1100, px)) }),
      createWritingDoc: (title) => {
        const id = makeId("doc");
        const now = new Date().toISOString();
        const doc: WritingDoc = {
          id,
          title: title?.trim() || "Untitled document",
          body: "",
          createdAt: now,
          updatedAt: now,
        };
        set((st) => ({
          writingDocs: { ...st.writingDocs, [id]: doc },
          writingDocOrder: [...st.writingDocOrder, id],
        }));
        return id;
      },
      updateWritingDoc: (id, patch) =>
        set((st) => {
          const doc = st.writingDocs[id];
          if (!doc) return {};
          return {
            writingDocs: {
              ...st.writingDocs,
              [id]: { ...doc, ...patch, updatedAt: new Date().toISOString() },
            },
          };
        }),
      deleteWritingDoc: (id) =>
        set((st) => {
          const writingDocs = { ...st.writingDocs };
          delete writingDocs[id];
          return {
            writingDocs,
            writingDocOrder: st.writingDocOrder.filter((x) => x !== id),
            openWritingTarget:
              st.openWritingTarget?.kind === "doc" && st.openWritingTarget.id === id
                ? null
                : st.openWritingTarget,
          };
        }),

      objectRelations: [],
      addObjectRelation: (rel) =>
        set((st) => {
          if (rel.sourceObjectId === rel.targetObjectId) return {};
          if (!st.objects[rel.sourceObjectId] || !st.objects[rel.targetObjectId]) return {};
          const exists = st.objectRelations.some(
            (r) =>
              r.sourceObjectId === rel.sourceObjectId &&
              r.targetObjectId === rel.targetObjectId &&
              r.relationType === rel.relationType
          );
          if (exists) return {};
          return {
            objectRelations: [
              ...st.objectRelations,
              { ...rel, id: makeId("rel"), createdAt: new Date().toISOString() },
            ],
          };
        }),
      removeObjectRelation: (id) =>
        set((st) => ({ objectRelations: st.objectRelations.filter((r) => r.id !== id) })),

      discoveryOpen: false,
      setDiscoveryOpen: (open) => set({ discoveryOpen: open }),

      discoverySession: null,
      setDiscoverySession: (session) => set({ discoverySession: session }),
      patchDiscoverySession: (patch) =>
        set((s) => (s.discoverySession ? { discoverySession: { ...s.discoverySession, ...patch } } : {})),

      importExternalObject: (input) => {
        const existingId = input.externalId ? `${input.provider}_${input.externalId}` : null;
        const s = get();
        if (existingId && s.objects[existingId]) {
          s.addToWorkbench([existingId]);
          return existingId;
        }
        const id = existingId ?? makeId("ext");
        const now = new Date().toISOString();
        const obj: DesignObject = {
          id,
          title: input.title || input.sourceUrl,
          imageUrl: input.imageUrl,
          tags: [],
          fields: {
            ...(input.sourceUrl ? { source_url: input.sourceUrl } : {}),
            provider: input.provider,
            ...(input.discoveryQuery ? { discovery_query: input.discoveryQuery } : {}),
          },
          manualCollectionIds: [],
          sourceUrl: input.sourceUrl || undefined,
          createdAt: now,
          updatedAt: now,
          source: input.provider === "arena" ? "arena" : "external",
          externalSource: {
            provider: input.provider,
            sourceUrl: input.sourceUrl,
            ...(input.externalId ? { externalId: input.externalId } : {}),
            ...(input.discoveryQuery ? { discoveryQuery: input.discoveryQuery } : {}),
            ...(input.discoveredFromObjectIds?.length
              ? { discoveredFromObjectIds: input.discoveredFromObjectIds }
              : {}),
          },
        };
        set((st) => ({ objects: { ...st.objects, [id]: obj } }));
        get().addToWorkbench([id]);
        return id;
      },

      workbenchIds: [],
      workbenchOpen: false,
      setWorkbenchOpen: (open) => set({ workbenchOpen: open }),
      addToWorkbench: (ids) =>
        set((s) => {
          const existing = new Set(s.workbenchIds);
          const fresh = ids.filter((id) => !existing.has(id) && s.objects[id]);
          if (fresh.length === 0) return {};
          return { workbenchIds: [...s.workbenchIds, ...fresh] };
        }),
      removeFromWorkbench: (id) =>
        set((s) => ({ workbenchIds: s.workbenchIds.filter((x) => x !== id) })),
      reorderWorkbench: (id, beforeId) =>
        set((s) => {
          if (id === beforeId) return {};
          const rest = s.workbenchIds.filter((x) => x !== id);
          if (beforeId === null) return { workbenchIds: [...rest, id] };
          const idx = rest.indexOf(beforeId);
          if (idx === -1) return {};
          rest.splice(idx, 0, id);
          return { workbenchIds: rest };
        }),
      clearWorkbench: () => set({ workbenchIds: [] }),

      setSearchQuery: (query) => set({ searchQuery: query }),
      toggleFacetTag: (tag) =>
        set((s) => ({
          facetTags: s.facetTags.includes(tag)
            ? s.facetTags.filter((t) => t !== tag)
            : [...s.facetTags, tag],
          // A tag can't be both an include and an exclude filter at once.
          excludedTags: s.excludedTags.filter((t) => t !== tag),
        })),
      setFacetMode: (mode) => set({ facetMode: mode }),
      clearFacetTags: () => set({ facetTags: [] }),
      toggleExcludeTag: (tag) =>
        set((s) => ({
          excludedTags: s.excludedTags.includes(tag)
            ? s.excludedTags.filter((t) => t !== tag)
            : [...s.excludedTags, tag],
          facetTags: s.facetTags.filter((t) => t !== tag),
        })),
      clearExcludedTags: () => set({ excludedTags: [] }),
      setFacetFieldFilter: (filter) => set({ facetFieldFilter: filter }),
      setColorFilter: (filter) => set({ colorFilter: filter }),
      setTypeFilter: (type) => set({ typeFilter: type }),
      setRoleFilter: (role) => set({ roleFilter: role }),
      setGroupBy: (field) => set({ groupBy: field }),
      setGridZoom: (zoom) => set({ gridZoom: Math.max(-2, Math.min(3, zoom)) }),
      setViewMode: (mode) => set({ viewMode: mode }),
      setDetailViewMode: (mode) => set({ detailViewMode: mode }),

      updateObject: (id, patch) =>
        set((s) => {
          const existing = s.objects[id];
          if (!existing) return {};
          return {
            objects: {
              ...s.objects,
              [id]: { ...existing, ...patch, updatedAt: new Date().toISOString() },
            },
          };
        }),

      // Also applies the collection's autoTags (issue #126), if any — same
      // treatment as a hand-typed tag (localUserTags + mymind push for a
      // synced object), computed once via get() here so the async push
      // fires exactly once per genuinely-new tag, not inside the set()
      // reducer (which may re-run).
      assignToManualCollection: (objectId, collectionId) => {
        const s = get();
        const existing = s.objects[objectId];
        if (!existing) return;
        const alreadyIn = existing.manualCollectionIds.includes(collectionId);
        const collection = s.collections[collectionId];
        const autoTags = collection?.type === "manual" ? collection.autoTags ?? [] : [];
        const newTags = autoTags.filter((t) => !existing.tags.includes(t));
        if (alreadyIn && newTags.length === 0) return;
        set((st) => {
          const cur = st.objects[objectId];
          if (!cur) return {};
          const userTags = st.localUserTags[objectId] ?? [];
          return {
            objects: {
              ...st.objects,
              [objectId]: {
                ...cur,
                manualCollectionIds: cur.manualCollectionIds.includes(collectionId)
                  ? cur.manualCollectionIds
                  : [...cur.manualCollectionIds, collectionId],
                tags: [...cur.tags, ...newTags.filter((t) => !cur.tags.includes(t))],
                updatedAt: new Date().toISOString(),
              },
            },
            localUserTags:
              newTags.length > 0
                ? { ...st.localUserTags, [objectId]: Array.from(new Set([...userTags, ...newTags])) }
                : st.localUserTags,
          };
        });
        if (existing.source === "mymind") {
          for (const tag of newTags) void addMymindTag(objectId, tag);
        }
      },

      removeFromManualCollection: (objectId, collectionId) =>
        set((s) => {
          const existing = s.objects[objectId];
          if (!existing) return {};
          return {
            objects: {
              ...s.objects,
              [objectId]: {
                ...existing,
                manualCollectionIds: existing.manualCollectionIds.filter(
                  (c) => c !== collectionId
                ),
                updatedAt: new Date().toISOString(),
              },
            },
          };
        }),

      moveTagToField: (objectId, tag, fieldName, value, mode) =>
        set((s) => {
          const existing = s.objects[objectId];
          if (!existing) return {};
          const removals = s.localTagRemovals[objectId] ?? [];
          const nextValue: string | string[] =
            mode === "append"
              ? (() => {
                  const current = existing.fields[fieldName];
                  const arr = Array.isArray(current) ? current : [];
                  return arr.includes(value) ? arr : [...arr, value];
                })()
              : value;
          // A drag-a-tag-onto-a-field gesture is exactly as much a direct
          // user action as typing the value in — record it the same way
          // addObjectTag would, so lib/tagOrigin.ts reads "user" for it.
          const userTags = s.localUserTags[objectId] ?? [];
          const localUserTags = userTags.includes(value)
            ? s.localUserTags
            : { ...s.localUserTags, [objectId]: [...userTags, value] };
          return {
            objects: {
              ...s.objects,
              [objectId]: {
                ...existing,
                tags: existing.tags.filter((t) => t !== tag),
                fields: { ...existing.fields, [fieldName]: nextValue },
                updatedAt: new Date().toISOString(),
              },
            },
            // The tag now lives in a facet field instead — a resync
            // shouldn't hand it back as a loose tag too.
            localTagRemovals: removals.includes(tag)
              ? s.localTagRemovals
              : { ...s.localTagRemovals, [objectId]: [...removals, tag] },
            localUserTags,
          };
        }),

      assignFieldValue: (objectIds, fieldName, value, mode) =>
        set((s) => {
          const objects = { ...s.objects };
          let localUserTags = s.localUserTags;
          let changed = false;
          for (const id of objectIds) {
            const existing = objects[id];
            if (!existing) continue;
            changed = true;
            if (value === "") {
              const { [fieldName]: _removed, ...rest } = existing.fields;
              objects[id] = { ...existing, fields: rest, updatedAt: new Date().toISOString() };
              continue;
            }
            const nextValue: string | string[] =
              mode === "append"
                ? (() => {
                    const current = existing.fields[fieldName];
                    const arr = Array.isArray(current) ? current : [];
                    return arr.includes(value) ? arr : [...arr, value];
                  })()
                : value;
            objects[id] = {
              ...existing,
              fields: { ...existing.fields, [fieldName]: nextValue },
              updatedAt: new Date().toISOString(),
            };
            // A bucket/panel drag-drop is a direct user classification —
            // same "user" provenance signal as a hand-typed tag (see
            // recordUserValue's doc comment).
            const userTags = localUserTags[id] ?? [];
            if (!userTags.includes(value)) {
              localUserTags = { ...localUserTags, [id]: [...userTags, value] };
            }
          }
          return changed ? { objects, localUserTags } : {};
        }),

      addFieldOption: (fieldName, option) =>
        set((s) => {
          const key = fieldName.toLowerCase();
          const trimmed = option.trim();
          if (!trimmed) return {};
          let changed = false;
          const roles = { ...s.roles };
          for (const [roleKey, def] of Object.entries(s.roles)) {
            const fieldIdx = def.fields.findIndex((f) => f.name.toLowerCase() === key);
            if (fieldIdx === -1) continue;
            const field = def.fields[fieldIdx];
            const options = field.options ?? [];
            if (options.some((o) => o.toLowerCase() === trimmed.toLowerCase())) continue;
            const fields = [...def.fields];
            fields[fieldIdx] = { ...field, options: [...options, trimmed] };
            roles[roleKey] = { ...def, fields };
            changed = true;
          }
          return changed ? { roles } : {};
        }),

      exportDataString: () => {
        const s = get();
        return JSON.stringify(
          {
            // Embeddings are excluded — they're the bulk of the payload
            // (~90% of it) and are fully recoverable by resyncing with
            // embeddings included, unlike everything else here (tags,
            // facets, collections, local descriptions), which only exists
            // in this app.
            objects: Object.values(s.objects).map(({ embedding: _embedding, ...rest }) => rest),
            collections: s.collectionOrder.map((id) => s.collections[id]),
            tagGroups: s.tagGroups,
            roles: s.roles,
          },
          null,
          2
        );
      },

      restoreFromBackup: (json) => {
        // Throws BackupValidationError on any structural problem — nothing
        // below runs, so a truncated/corrupted file never gets the chance
        // to wipe the store down to (near-)nothing after the fact.
        const parsed = parseBackup(json);
        const objects: Record<string, DesignObject> = {};
        for (const obj of parsed.objects) objects[obj.id] = obj;
        const collections: Record<string, Collection> = {};
        const collectionOrder: string[] = [];
        for (const c of parsed.collections) {
          collections[c.id] = c;
          collectionOrder.push(c.id);
        }
        set({
          objects,
          collections,
          collectionOrder,
          tagGroups: parsed.tagGroups,
          roles: parsed.roles,
          selectedView: { kind: "all" },
          detailObjectId: null,
        });
      },
      };
    },
    {
      name: "organizer-store",
      // Schema-versioning scaffold (issue #118) — zustand's persist already
      // has a version/migrate mechanism built in, so this needed no new
      // dependency. Dexie was the library the research pointed at, but its
      // actual value (per-record indexed tables) doesn't apply here: this
      // storage layer persists one JSON blob, not multiple tables, so a
      // table-oriented schema migrator wouldn't have anything to migrate —
      // it would only pay off after a much bigger restructuring (splitting
      // this blob into real IndexedDB object stores), which isn't warranted
      // while every object here is still test data (project's own no-
      // migration-without-real-data rule). `version` below is a no-op today
      // (nothing has changed shape) — it's the hook for later: the next
      // time PersistedState's shape actually changes (a renamed/restructured
      // field), bump this number and add a branch in `migrate` that
      // transforms the OLD shape into the new one, so already-persisted
      // local data survives the change instead of being silently dropped or
      // misread.
      version: 1,
      migrate: (persistedState) => persistedState as PersistedState,
      storage: createIdbStorage<PersistedState>(),
      // Transient UI state has no business surviving a reload, and more
      // importantly: persist's wrapped setState calls partialize+setItem on
      // every single set() — including every keystroke in the search box.
      // Keeping this list short keeps that per-call cost O(1) regardless of
      // how large `objects`/`collections` grow.
      partialize: (state) => ({
        objects: state.objects,
        collections: state.collections,
        collectionOrder: state.collectionOrder,
        tagGroups: state.tagGroups,
        roles: state.roles,
        lastBackupAt: state.lastBackupAt,
        viewMode: state.viewMode,
        detailViewMode: state.detailViewMode,
        deletedMymindIds: state.deletedMymindIds,
        localTagRemovals: state.localTagRemovals,
        workbenchIds: state.workbenchIds,
        canvases: state.canvases,
        canvasOrder: state.canvasOrder,
        objectRelations: state.objectRelations,
        discoverySession: state.discoverySession,
        canvasSplitWidth: state.canvasSplitWidth,
        writingDocs: state.writingDocs,
        writingDocOrder: state.writingDocOrder,
        writingFontSize: state.writingFontSize,
        writingPageWidth: state.writingPageWidth,
        localUserTags: state.localUserTags,
        fieldProvenance: state.fieldProvenance,
        tagPromotions: state.tagPromotions,
        sidebarCollapsed: state.sidebarCollapsed,
      }),
      // Embeddings are deliberately excluded from what idbStorage actually
      // writes (see its stripEmbeddings replacer) — merge them back in from
      // their own separate store once this rehydration finishes.
      onRehydrateStorage: () => () => {
        loadEmbeddings().then((map) => {
          if (Object.keys(map).length === 0 || !storeApi) return;
          storeApi.setState((s) => {
            const objects = { ...s.objects };
            for (const [id, embedding] of Object.entries(map)) {
              if (objects[id]) objects[id] = { ...objects[id], embedding };
            }
            return { objects };
          });
        });
        if (storeApi) applyCuratedCollectionsSeed(storeApi.getState);
      },
    }
  )
);

// ---------------------------------------------------------------------------
// Derived selectors
// ---------------------------------------------------------------------------

/** Objects created before the `source` field existed lack it — for those,
 * a mymind_id field is proof of a mymind sync; everything else is sample. */
export function isSampleObject(obj: DesignObject): boolean {
  if (obj.source) return obj.source === "sample";
  return !obj.fields?.mymind_id;
}

/** What getVisibleObjects actually reads — narrower than the full State so
 * callers can pass a shallow-selected subset (see App.tsx) instead of
 * subscribing to the whole store just to call this function. */
export type VisibilityState = Pick<
  State,
  "objects" | "collections" | "selectedView" | "tagGroups" | "objectRelations"
>;

/** THE array for "every object", stable per objects-map version. Fresh
 * `Object.values(...)` arrays at every call site each carried their own
 * identity, so the similarity engine's per-array corpus cache missed on
 * every panel open and retokenized the whole library (perf maintenance,
 * 2026-07-20). One shared slot: same map in → same array out. */
let allObjectsCache: { ref: Record<string, DesignObject>; list: DesignObject[] } | null = null;
export function allObjectsOf(objects: Record<string, DesignObject>): DesignObject[] {
  if (allObjectsCache?.ref === objects) return allObjectsCache.list;
  const list = Object.values(objects);
  allObjectsCache = { ref: objects, list };
  return list;
}

export function getVisibleObjects(state: VisibilityState): DesignObject[] {
  const all = allObjectsOf(state.objects);
  const view = state.selectedView;

  if (view.kind === "all") return sortByRecency(all);

  if (view.kind === "unclassified") {
    return sortByRecency(
      all.filter((obj) => {
        if (obj.manualCollectionIds.length > 0) return false;
        const anySmartMatch = Object.values(state.collections).some(
          (c) => c.type === "smart" && matchesSmartCollection(c, obj, state.tagGroups, state.objects)
        );
        return !anySmartMatch;
      })
    );
  }

  if (view.kind === "similar") {
    // Deliberately NOT recency-sorted — similarity rank IS the order here.
    // Issue #23: local hybrid score (tags/palette/facets/keywords), not
    // mymind's embedding — that gated this on a field most objects never
    // have (opt-in, rarely fetched), returning empty most of the time.
    // Works for any object regardless of source (mymind/Are.na/personal).
    const target = state.objects[view.objectId];
    if (!target) return [];
    const candidates = all.filter((o) => o.id !== target.id);
    // Split similarity (#136): the view carries which KIND of likeness the
    // user asked for — visual form, semantic content, or the blend —
    // with manual relationships boosting either ranking.
    const ranked = rankBySimilarityMode(target, candidates, all, {
      mode: view.mode ?? "blend",
      limit: 60,
      relations: state.objectRelations,
    });
    const byId = new Map(all.map((o) => [o.id, o]));
    // The reference object itself leads the list (issue #81) — Grid's own
    // masonry placement (lib/masonry.ts) always seats the first item in
    // column 0, so this alone puts it at the very top-left, no separate
    // layout logic needed.
    return [target, ...ranked.map((r) => byId.get(r.id)).filter((o): o is DesignObject => !!o)];
  }

  const collection = state.collections[view.collectionId];
  if (!collection) return [];
  if (collection.type === "manual") {
    return sortByRecency(all.filter((obj) => obj.manualCollectionIds.includes(collection.id)));
  }
  return sortByRecency(
    all.filter((obj) => matchesSmartCollection(collection, obj, state.tagGroups, state.objects))
  );
}

export function countForCollection(state: State, collection: Collection): number {
  const all = allObjectsOf(state.objects);
  if (collection.type === "manual") {
    return all.filter((obj) => obj.manualCollectionIds.includes(collection.id)).length;
  }
  return all.filter((obj) => matchesSmartCollection(collection, obj, state.tagGroups, state.objects))
    .length;
}
