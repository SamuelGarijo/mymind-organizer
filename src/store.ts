import { create } from "zustand";
import { createJSONStorage, persist } from "zustand/middleware";
import type {
  Collection,
  DesignObject,
  FacetField,
  FilterGroup,
  ManualCollection,
  SmartCollection,
  TagGroups,
  ViewSelection,
} from "./types";
import { makeId } from "./lib/id";
import { matchesSmartCollection, norm } from "./lib/ruleEngine";
import type { FacetMode } from "./lib/quickFilter";
import { idbStorage } from "./lib/idbStorage";
import { rankBySimilarity } from "./lib/similarity";
import { sortByRecency } from "./lib/recency";
import { MYMIND_OWNED_FIELD_KEYS } from "./lib/mymindSync";

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
   * re-syncs — local curation and first-seen time are ours, everything else
   * (title/tags/fields/tagFlags) is refreshed from mymind on every sync.
   * Never touches tagGroups. */
  syncMymindObjects: (objs: DesignObject[]) => void;
  /** Removes locally imported sample objects only — never anything synced
   * from mymind, and never calls mymind's API. Returns how many were removed. */
  deleteSampleObjects: () => number;
  setTagGroup: (tagName: string, group: string | null) => void;
  addSmartCollection: (name: string, rule: FilterGroup) => string;
  updateSmartCollection: (id: string, name: string, rule: FilterGroup) => void;
  addManualCollection: (name: string, facetSchema?: FacetField[]) => string;
  updateManualCollection: (
    id: string,
    patch: { name?: string; facetSchema?: FacetField[] }
  ) => void;
  renameCollection: (id: string, name: string) => void;
  deleteCollection: (id: string) => void;

  /** Timestamp of the last successful auto-backup write, shown in the
   * sidebar. Undefined until auto-backup has been configured and run once. */
  lastBackupAt?: string;
  setLastBackupAt: (iso: string) => void;

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
  /** Atomically moves a plain tag onto a facet field: sets `fields[fieldName]`
   * to `value` and removes `tag` from the object's tags. Used by the
   * DetailPanel drag interaction — one store update, not two, so there's no
   * risk of a half-applied state if a caller reads it back mid-way. */
  moveTagToField: (objectId: string, tag: string, fieldName: string, value: string) => void;

  exportDataString: () => string;
  /** Full restore from a backup produced by exportDataString — replaces
   * objects/collections/tagGroups wholesale. Used for disaster recovery,
   * not everyday import. */
  restoreFromBackup: (json: string) => void;
};

export const useStore = create<State>()(
  persist(
    (set, get) => ({
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

      lastBackupAt: undefined,
      setLastBackupAt: (iso) => set({ lastBackupAt: iso }),

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
          for (const obj of objs) {
            const existing = next[obj.id];
            next[obj.id] = existing
              ? {
                  ...obj,
                  manualCollectionIds: existing.manualCollectionIds,
                  createdAt: existing.createdAt,
                  // Embeddings are opt-in per sync (large payload) — a sync
                  // that didn't request them shouldn't erase one fetched
                  // earlier.
                  embedding: obj.embedding ?? existing.embedding,
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
              : obj;
          }
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
            ...(patch.facetSchema !== undefined ? { facetSchema: patch.facetSchema } : {}),
          };
          return { collections: { ...s.collections, [id]: updated } };
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

      moveTagToField: (objectId, tag, fieldName, value) =>
        set((s) => {
          const existing = s.objects[objectId];
          if (!existing) return {};
          return {
            objects: {
              ...s.objects,
              [objectId]: {
                ...existing,
                tags: existing.tags.filter((t) => t !== tag),
                fields: { ...existing.fields, [fieldName]: value },
                updatedAt: new Date().toISOString(),
              },
            },
          };
        }),

      exportDataString: () => {
        const s = get();
        return JSON.stringify(
          {
            objects: Object.values(s.objects),
            collections: s.collectionOrder.map((id) => s.collections[id]),
            tagGroups: s.tagGroups,
          },
          null,
          2
        );
      },

      restoreFromBackup: (json) => {
        const parsed = JSON.parse(json) as {
          objects?: DesignObject[];
          collections?: Collection[];
          tagGroups?: TagGroups;
        };
        const objects: Record<string, DesignObject> = {};
        for (const obj of parsed.objects ?? []) objects[obj.id] = obj;
        const collections: Record<string, Collection> = {};
        const collectionOrder: string[] = [];
        for (const c of parsed.collections ?? []) {
          collections[c.id] = c;
          collectionOrder.push(c.id);
        }
        set({
          objects,
          collections,
          collectionOrder,
          tagGroups: parsed.tagGroups ?? {},
          selectedView: { kind: "all" },
          detailObjectId: null,
        });
      },
    }),
    { name: "organizer-store", storage: createJSONStorage(() => idbStorage) }
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

export function getVisibleObjects(state: State): DesignObject[] {
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
