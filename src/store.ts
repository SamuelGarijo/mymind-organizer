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
} from "./types";
import { makeId } from "./lib/id";
import { matchesSmartCollection, norm } from "./lib/ruleEngine";
import type { FacetMode } from "./lib/quickFilter";
import { createIdbStorage } from "./lib/idbStorage";
import { loadEmbeddings, saveEmbeddings } from "./lib/embeddingsStorage";
import { applyCuratedCollectionsSeed } from "./lib/curatedCollectionsSeed";
import { rankBySimilarity } from "./lib/similarity";
import { sortByRecency } from "./lib/recency";
import { MYMIND_OWNED_FIELD_KEYS } from "./lib/mymindSync";
import { parseBackup } from "./lib/backupValidation";
import { CURATED_ROLE_FIELDS } from "./lib/curatedRoleFields";

export type ViewMode = "grid" | "table";

type State = {
  objects: Record<string, DesignObject>;
  collections: Record<string, Collection>;
  collectionOrder: string[];
  selectedView: ViewSelection;
  detailObjectId: string | null;

  /** Tag name -> group label (e.g. "style"). Local-only, optional, never
   * sourced from mymind — the user assigns these themselves. */
  tagGroups: TagGroups;

  /** Quick-filter layer: narrows whatever the current view already shows.
   * Works the same in All/Unclassified/smart/manual views. */
  searchQuery: string;
  facetTags: string[];
  facetMode: FacetMode;
  /** mymind's entityType (fields.entity_type), e.g. "Image"/"Article" — "" means
   * no filter. A separate control from the free-text search box. */
  typeFilter: string;

  /** Masonry grid vs. virtualized table — same filtered/sorted dataset. */
  viewMode: ViewMode;

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
  /** Adds a tag the user typed by hand — local-only, never pushed to mymind
   * (the one write endpoint we're authorized to use is the facet-field
   * push in DetailPanel, not this). Also clears any prior local removal of
   * the same tag, since re-adding it supersedes that. */
  addObjectTag: (objectId: string, tag: string) => void;
  /** Removes a tag locally. mymind has no removal endpoint, so this only
   * ever affects our own copy — and records the removal so a later sync
   * doesn't bring the tag straight back. */
  removeObjectTag: (objectId: string, tag: string) => void;
  setTagGroup: (tagName: string, group: string | null) => void;
  addSmartCollection: (name: string, rule: FilterGroup) => string;
  updateSmartCollection: (id: string, name: string, rule: FilterGroup) => void;
  addManualCollection: (name: string, facetSchema?: FacetField[]) => string;
  updateManualCollection: (id: string, patch: { name?: string }) => void;

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
  /** Replaces a role's field package. Retroactive by construction: every
   * consumer looks fields up through `roles`, so objects with this role
   * pick the change up everywhere immediately. */
  updateRoleFields: (roleName: string, fields: FacetField[]) => void;
  renameCollection: (id: string, name: string) => void;
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

  setSearchQuery: (query: string) => void;
  toggleFacetTag: (tag: string) => void;
  setFacetMode: (mode: FacetMode) => void;
  clearFacetTags: () => void;
  setTypeFilter: (type: string) => void;
  setViewMode: (mode: ViewMode) => void;

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
  | "deletedMymindIds"
  | "localTagRemovals"
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
 * field's options — same effect as dragging the tag onto the field by
 * hand (moveTagToField below), just triggered by the role applying
 * instead of the gesture (issue #104, closed 2026-07-11). Skipped
 * per-field when more than one of the object's tags matches — ambiguous,
 * left for manual resolution rather than guessed wrong.
 *
 * Shared by setObjectRole (one object) and bulkAssignRoles (many at
 * once) so both paths get identical behavior for free.
 */
function applyRoleToObject(
  obj: DesignObject,
  roleName: string,
  roles: Record<string, RoleDefinition>
): { object: DesignObject; roles: Record<string, RoleDefinition>; movedTags: string[] } {
  const trimmed = roleName.trim();
  const key = norm(trimmed);
  const existingDef = roles[key];
  const nextRoles = existingDef
    ? roles
    : { ...roles, [key]: { name: trimmed, fields: CURATED_ROLE_FIELDS[key] ?? [] } };
  const def = nextRoles[key];

  let tags = obj.tags;
  const fields = { ...obj.fields };
  const movedTags: string[] = [];
  for (const field of def.fields) {
    if (field.type === "date" || fields[field.name] || !field.options?.length) continue;
    const matches = tags.filter((t) => field.options!.some((opt) => norm(opt) === norm(t)));
    if (field.type === "select") {
      // Exactly one match or skip — an object with two candidate tags for a
      // single-value field is ambiguous, left for manual resolution.
      if (matches.length !== 1) continue;
      const [tag] = matches;
      fields[field.name] = field.options.find((opt) => norm(opt) === norm(tag))!;
      tags = tags.filter((t) => t !== tag);
      movedTags.push(tag);
    } else {
      // multi-select: no ambiguity concept — an object can legitimately
      // carry more than one value here, so every matching tag moves in.
      if (matches.length === 0) continue;
      fields[field.name] = matches.map(
        (tag) => field.options!.find((opt) => norm(opt) === norm(tag))!
      );
      tags = tags.filter((t) => !matches.includes(t));
      movedTags.push(...matches);
    }
  }

  return { object: { ...obj, role: def.name, tags, fields }, roles: nextRoles, movedTags };
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

      tagGroups: {},

      searchQuery: "",
      facetTags: [],
      facetMode: "AND",
      typeFilter: "",
      viewMode: "grid",

      deletedMymindIds: [],
      localTagRemovals: {},

      lastBackupAt: undefined,
      setLastBackupAt: (iso) => set({ lastBackupAt: iso }),

      sidebarCollapsed: false,
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
          };
        }),

      removeObjectTag: (objectId, tag) =>
        set((s) => {
          const existing = s.objects[objectId];
          if (!existing) return {};
          const removals = s.localTagRemovals[objectId] ?? [];
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

      addSmartCollection: (name, rule) => {
        const id = makeId("smart");
        const collection: SmartCollection = {
          id,
          type: "smart",
          name,
          rule,
          createdAt: new Date().toISOString(),
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

      addManualCollection: (name, facetSchema) => {
        const id = makeId("manual");
        const collection: ManualCollection = {
          id,
          type: "manual",
          name,
          createdAt: new Date().toISOString(),
          ...(facetSchema && facetSchema.length > 0 ? { facetSchema } : {}),
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
          const { object, roles, movedTags } = applyRoleToObject(obj, roleName, s.roles);
          const update: Partial<State> = {
            objects: { ...s.objects, [objectId]: object },
            roles,
          };
          if (movedTags.length > 0) {
            const removals = s.localTagRemovals[objectId] ?? [];
            update.localTagRemovals = {
              ...s.localTagRemovals,
              [objectId]: Array.from(new Set([...removals, ...movedTags])),
            };
          }
          return update;
        }),

      bulkAssignRoles: (assignments) =>
        set((s) => {
          const objects = { ...s.objects };
          let roles = s.roles;
          const localTagRemovals = { ...s.localTagRemovals };
          for (const { objectId, role } of assignments) {
            const obj = objects[objectId];
            if (!obj) continue;
            const applied = applyRoleToObject(obj, role, roles);
            objects[objectId] = applied.object;
            roles = applied.roles;
            if (applied.movedTags.length > 0) {
              const removals = localTagRemovals[objectId] ?? [];
              localTagRemovals[objectId] = Array.from(
                new Set([...removals, ...applied.movedTags])
              );
            }
          }
          return { objects, roles, localTagRemovals };
        }),

      updateRoleFields: (roleName, fields) =>
        set((s) => {
          const key = norm(roleName);
          const existing = s.roles[key];
          const def: RoleDefinition = existing
            ? { ...existing, fields }
            : { name: roleName.trim(), fields };
          return { roles: { ...s.roles, [key]: def } };
        }),

      renameCollection: (id, name) =>
        set((s) => {
          const existing = s.collections[id];
          if (!existing) return {};
          return { collections: { ...s.collections, [id]: { ...existing, name } } };
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

      setSelectedView: (view) => set({ selectedView: view, facetTags: [] }),
      openDetail: (id) => set({ detailObjectId: id }),
      closeDetail: () => set({ detailObjectId: null }),

      setSearchQuery: (query) => set({ searchQuery: query }),
      toggleFacetTag: (tag) =>
        set((s) => ({
          facetTags: s.facetTags.includes(tag)
            ? s.facetTags.filter((t) => t !== tag)
            : [...s.facetTags, tag],
        })),
      setFacetMode: (mode) => set({ facetMode: mode }),
      clearFacetTags: () => set({ facetTags: [] }),
      setTypeFilter: (type) => set({ typeFilter: type }),
      setViewMode: (mode) => set({ viewMode: mode }),

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

      assignToManualCollection: (objectId, collectionId) =>
        set((s) => {
          const existing = s.objects[objectId];
          if (!existing) return {};
          if (existing.manualCollectionIds.includes(collectionId)) return {};
          return {
            objects: {
              ...s.objects,
              [objectId]: {
                ...existing,
                manualCollectionIds: [...existing.manualCollectionIds, collectionId],
                updatedAt: new Date().toISOString(),
              },
            },
          };
        }),

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
          };
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
        deletedMymindIds: state.deletedMymindIds,
        localTagRemovals: state.localTagRemovals,
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
export type VisibilityState = Pick<State, "objects" | "collections" | "selectedView" | "tagGroups">;

export function getVisibleObjects(state: VisibilityState): DesignObject[] {
  const all = Object.values(state.objects);
  const view = state.selectedView;

  if (view.kind === "all") return sortByRecency(all);

  if (view.kind === "unclassified") {
    return sortByRecency(
      all.filter((obj) => {
        if (obj.manualCollectionIds.length > 0) return false;
        const anySmartMatch = Object.values(state.collections).some(
          (c) => c.type === "smart" && matchesSmartCollection(c, obj, state.tagGroups)
        );
        return !anySmartMatch;
      })
    );
  }

  if (view.kind === "similar") {
    // Deliberately NOT recency-sorted — similarity rank IS the order here.
    const target = state.objects[view.objectId];
    if (!target?.embedding) return [];
    // mymind-sourced only, per spec — no cross-source embedding comparison
    // this phase, and obviously excludes the object itself.
    const candidates = all.filter(
      (o) => o.id !== target.id && o.source === "mymind" && o.embedding
    );
    const ranked = rankBySimilarity(
      target.embedding,
      candidates.map((o) => ({ id: o.id, embedding: o.embedding! })),
      60
    );
    const byId = new Map(all.map((o) => [o.id, o]));
    return ranked.map((r) => byId.get(r.id)).filter((o): o is DesignObject => !!o);
  }

  const collection = state.collections[view.collectionId];
  if (!collection) return [];
  if (collection.type === "manual") {
    return sortByRecency(all.filter((obj) => obj.manualCollectionIds.includes(collection.id)));
  }
  return sortByRecency(all.filter((obj) => matchesSmartCollection(collection, obj, state.tagGroups)));
}

export function countForCollection(state: State, collection: Collection): number {
  const all = Object.values(state.objects);
  if (collection.type === "manual") {
    return all.filter((obj) => obj.manualCollectionIds.includes(collection.id)).length;
  }
  return all.filter((obj) => matchesSmartCollection(collection, obj, state.tagGroups)).length;
}
