import { useEffect, useMemo, useRef, useState } from "react";
import { getVisibleObjects, useStore } from "./store";
import { Sidebar } from "./components/Sidebar";
import { Grid } from "./components/Grid";
import { Table } from "./components/Table";
import { DetailPanel } from "./components/DetailPanel";
import { SmartCollectionModal } from "./components/SmartCollectionModal";
import { ManualCollectionModal } from "./components/ManualCollectionModal";
import { FilterBar } from "./components/FilterBar";
import { applyFacetTags, applyTypeFilter, computeObjectTypes, computeTopTags } from "./lib/quickFilter";
import { buildSearchIndex, searchObjects } from "./lib/search";
import { describeMymindError, syncFull, syncIncremental } from "./lib/mymindSync";
import { getStoredBackupHandle, writeBackup } from "./lib/autoBackup";
import { normalizeFacetSchema } from "./lib/facetSchema";
import { computeTagFrequency } from "./lib/tagDistinctiveness";
import type { FacetField } from "./types";

type Modal =
  | { kind: "smart"; collectionId?: string }
  | { kind: "manual"; collectionId?: string }
  | null;

type SyncStatus =
  | { status: "idle" }
  | { status: "loading" }
  | { status: "error"; message: string }
  | { status: "done"; count: number; truncated: boolean; scannedFullLibrary: boolean };

function viewTitle(state: ReturnType<typeof useStore.getState>): string {
  const view = state.selectedView;
  if (view.kind === "all") return "All items";
  if (view.kind === "unclassified") return "Unclassified";
  if (view.kind === "similar") {
    const target = state.objects[view.objectId];
    return target ? `Similar to: ${target.title}` : "Similar to…";
  }
  return state.collections[view.collectionId]?.name ?? "Collection";
}

export default function App() {
  const state = useStore();
  // Depend on the slices the view filter actually reads, not the whole
  // store object — otherwise every keystroke in the search box (which also
  // lives in the store) re-filters the entire library for nothing.
  const baseObjects = useMemo(
    () => getVisibleObjects(state),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [state.objects, state.collections, state.selectedView, state.tagGroups]
  );

  // Type options always reflect the current view before type-filtering
  // itself, so picking one option doesn't hide the others.
  const objectTypes = useMemo(() => computeObjectTypes(baseObjects), [baseObjects]);

  const typeFiltered = useMemo(
    () => applyTypeFilter(baseObjects, state.typeFilter),
    [baseObjects, state.typeFilter]
  );

  // Fuse indexing (~8000 objects) is real work — rebuild only when the
  // candidate pool changes, not on every keystroke. Search always narrows
  // the pool first, regardless of facet mode.
  const searchIndex = useMemo(() => buildSearchIndex(typeFiltered), [typeFiltered]);
  const searchFiltered = useMemo(
    () => searchObjects(searchIndex, state.searchQuery, typeFiltered),
    [searchIndex, state.searchQuery, typeFiltered]
  );

  // The facet bar's own tag list is asymmetric on purpose: in "all" (AND)
  // mode it drills down — options reflect only what's left after already-
  // selected tags narrow the set, so it always mirrors what's actually on
  // screen. In "any" (OR) mode, narrowing by the current selection would
  // hide the very tags you'd want to add to the union, so it stays computed
  // from the broader search-filtered pool instead.
  const topTagsSource = useMemo(
    () =>
      state.facetMode === "AND"
        ? applyFacetTags(searchFiltered, state.facetTags, "AND")
        : searchFiltered,
    [searchFiltered, state.facetTags, state.facetMode]
  );
  const topTags = useMemo(() => computeTopTags(topTagsSource), [topTagsSource]);

  const visibleObjects = useMemo(
    () => applyFacetTags(searchFiltered, state.facetTags, state.facetMode),
    [searchFiltered, state.facetTags, state.facetMode]
  );

  // Library-wide, not view-scoped — "distinctive" means rare across
  // everything, and this must stay a stable reference across renders where
  // objects haven't changed, or every Card/TableRow would re-render for
  // nothing (see Card.tsx).
  const tagFrequency = useMemo(
    () => computeTagFrequency(Object.values(state.objects)),
    [state.objects]
  );

  // Facet columns only make sense inside a single manual collection with a
  // defined schema — an object can belong to several collections with
  // different (or no) schemas, so "All items" has nothing consistent to show.
  const facetColumns: FacetField[] = useMemo(() => {
    if (state.selectedView.kind !== "collection") return [];
    const collection = state.collections[state.selectedView.collectionId];
    if (!collection || collection.type !== "manual") return [];
    return normalizeFacetSchema(collection);
  }, [state.selectedView, state.collections]);

  const [modal, setModal] = useState<Modal>(null);
  const [spaceId, setSpaceId] = useState("");
  const [includeEmbeddings, setIncludeEmbeddings] = useState(false);
  const [fullResync, setFullResync] = useState(false);
  const [syncState, setSyncState] = useState<SyncStatus>({ status: "idle" });
  const restoreInputRef = useRef<HTMLInputElement>(null);
  const autoSyncedOnMount = useRef(false);

  const view = state.selectedView;
  const isQuickFiltering = state.searchQuery.trim() !== "" || state.facetTags.length > 0;
  const emptyLabel = isQuickFiltering
    ? "Nothing matches your search/tag filters in this view."
    : view.kind === "unclassified"
    ? "Nothing unclassified — everything is either sorted into a folder or matched by a smart collection."
    : view.kind === "similar"
    ? "No embeddings available to compare — sync with 'Include embeddings' checked first."
    : view.kind === "all"
    ? "No items yet. Sync from mymind to get started."
    : "No items in this collection yet.";

  async function runSync(opts: { spaceId?: string; includeEmbeddings: boolean; full: boolean }) {
    setSyncState({ status: "loading" });
    try {
      const result = opts.full
        ? await syncFull({ spaceId: opts.spaceId, includeEmbeddings: opts.includeEmbeddings })
        : await syncIncremental(
            { spaceId: opts.spaceId, includeEmbeddings: opts.includeEmbeddings },
            state.objects
          );
      state.syncMymindObjects(result.objects);
      setSyncState({
        status: "done",
        count: result.newOrChangedCount,
        truncated: result.truncated,
        scannedFullLibrary: result.scannedFullLibrary,
      });

      // Auto-backup: only if the user has already opted in by choosing a
      // file (see Sidebar). Runs on every successful sync, found-nothing
      // included, per spec — silent, never blocks or errors the sync itself.
      const handle = await getStoredBackupHandle();
      if (handle) {
        const ok = await writeBackup(handle, state.exportDataString());
        if (ok) state.setLastBackupAt(new Date().toISOString());
      }
    } catch (err) {
      setSyncState({ status: "error", message: describeMymindError(err) });
    }
  }

  function handleSync() {
    void runSync({ spaceId: spaceId.trim() || undefined, includeEmbeddings, full: fullResync });
  }

  // On app open, quietly try an incremental sync against the whole library
  // (no Space ID scoping) so the Organizer never silently drifts stale.
  // Failures (e.g. proxy not running yet) just surface the normal error
  // banner rather than anything more intrusive.
  useEffect(() => {
    if (autoSyncedOnMount.current) return;
    autoSyncedOnMount.current = true;
    void runSync({ spaceId: undefined, includeEmbeddings: false, full: false });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  function handleExport() {
    const json = state.exportDataString();
    const blob = new Blob([json], { type: "application/json" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `organizer-backup-${new Date().toISOString().slice(0, 10)}.json`;
    a.click();
    URL.revokeObjectURL(url);
  }

  function handleRestoreFile(file: File) {
    const currentCount = Object.keys(state.objects).length;
    const ok = window.confirm(
      currentCount > 0
        ? `Restore this backup? It replaces everything currently in the Organizer (${currentCount} items) — this can't be undone. mymind itself is never touched.`
        : "Restore this backup into the Organizer?"
    );
    if (!ok) return;
    file.text().then((text) => {
      try {
        state.restoreFromBackup(text);
      } catch (err) {
        alert("Couldn't read that backup file: " + (err as Error).message);
      }
    });
  }

  return (
    <div className="h-screen w-screen flex overflow-hidden">
      <Sidebar
        onNewSmart={() => setModal({ kind: "smart" })}
        onNewManual={() => setModal({ kind: "manual" })}
        onEditSmart={(collectionId) => setModal({ kind: "smart", collectionId })}
        onEditManual={(collectionId) => setModal({ kind: "manual", collectionId })}
      />

      <main className="flex-1 flex flex-col min-w-0">
        <header className="h-14 shrink-0 border-b border-line bg-panel flex items-center justify-between px-5 gap-3">
          <div className="flex items-baseline gap-2 min-w-0">
            <h1 className="text-sm font-semibold truncate">{viewTitle(state)}</h1>
            <span className="text-[12px] text-muted shrink-0">
              {visibleObjects.length} item{visibleObjects.length === 1 ? "" : "s"}
            </span>
          </div>
          <div className="flex items-center gap-2 shrink-0">
            <div className="inline-flex rounded-lg border border-line overflow-hidden text-[12px]">
              {(["grid", "table"] as const).map((mode) => (
                <button
                  key={mode}
                  onClick={() => state.setViewMode(mode)}
                  className={[
                    "px-2.5 py-1.5 capitalize",
                    state.viewMode === mode ? "bg-ink text-white" : "bg-panel hover:bg-line/40",
                  ].join(" ")}
                  title={mode === "grid" ? "Masonry grid" : "Table with columns"}
                >
                  {mode}
                </button>
              ))}
            </div>
            <input
              value={spaceId}
              onChange={(e) => setSpaceId(e.target.value)}
              placeholder="Space ID (optional)"
              title="Leave empty to sync your whole mymind library"
              className="w-36 rounded-lg border border-line px-2.5 py-1.5 text-[12px] outline-none focus:border-accent"
            />
            <label className="flex items-center gap-1 text-[11px] text-muted" title="Fetches enough data to compute 'Similar to this' locally — larger sync payload">
              <input
                type="checkbox"
                checked={includeEmbeddings}
                onChange={(e) => setIncludeEmbeddings(e.target.checked)}
              />
              Embeddings
            </label>
            <label className="flex items-center gap-1 text-[11px] text-muted" title="Ignore what's already synced and refetch everything">
              <input
                type="checkbox"
                checked={fullResync}
                onChange={(e) => setFullResync(e.target.checked)}
              />
              Full resync
            </label>
            <button
              onClick={handleSync}
              disabled={syncState.status === "loading"}
              className="text-[12px] px-3 py-1.5 rounded-lg border border-line hover:bg-line/40 disabled:opacity-50"
            >
              {syncState.status === "loading" ? "Syncing…" : "Sync from mymind"}
            </button>
            <button
              onClick={handleExport}
              className="text-[12px] px-3 py-1.5 rounded-lg border border-line hover:bg-line/40"
              title="Downloads objects, collections, and tag groups as a backup file"
            >
              Export backup
            </button>
            <input
              ref={restoreInputRef}
              type="file"
              accept="application/json"
              className="hidden"
              onChange={(e) => {
                const file = e.target.files?.[0];
                if (file) handleRestoreFile(file);
                e.target.value = "";
              }}
            />
            <button
              onClick={() => restoreInputRef.current?.click()}
              className="text-[12px] px-3 py-1.5 rounded-lg border border-line hover:bg-line/40"
              title="Replaces everything with a previously exported backup"
            >
              Restore backup
            </button>
          </div>
        </header>

        {syncState.status === "error" && (
          <div className="px-5 py-2 bg-red-50 border-b border-red-200 text-[12px] text-red-800 flex items-center justify-between gap-3">
            <span>{syncState.message}</span>
            <button
              onClick={() => setSyncState({ status: "idle" })}
              className="text-red-800/60 hover:text-red-800 shrink-0"
              aria-label="Dismiss"
            >
              ×
            </button>
          </div>
        )}
        {syncState.status === "done" && (
          <div className="px-5 py-2 bg-emerald-50 border-b border-emerald-200 text-[12px] text-emerald-800 flex items-center justify-between gap-3">
            <span>
              {syncState.count === 0
                ? "Already up to date — no new or changed items."
                : `Synced ${syncState.count} new/changed object${
                    syncState.count === 1 ? "" : "s"
                  } from mymind.`}
              {syncState.truncated &&
                " mymind capped this response — there may be more; narrow by Space ID to see the rest."}
            </span>
            <button
              onClick={() => setSyncState({ status: "idle" })}
              className="text-emerald-800/60 hover:text-emerald-800 shrink-0"
              aria-label="Dismiss"
            >
              ×
            </button>
          </div>
        )}

        <FilterBar topTags={topTags} objectTypes={objectTypes} />

        <div className="flex-1 overflow-hidden">
          {state.viewMode === "table" ? (
            <div className="h-full p-5">
              <Table
                objects={visibleObjects}
                facetColumns={facetColumns}
                tagFrequency={tagFrequency}
                onOpen={state.openDetail}
                emptyLabel={emptyLabel}
              />
            </div>
          ) : (
            <div className="h-full overflow-y-auto p-5">
              <Grid
                objects={visibleObjects}
                tagFrequency={tagFrequency}
                onOpen={state.openDetail}
                emptyLabel={emptyLabel}
              />
            </div>
          )}
        </div>
      </main>

      {state.detailObjectId && (
        <DetailPanel objectId={state.detailObjectId} onClose={state.closeDetail} />
      )}

      {modal?.kind === "smart" && (
        <SmartCollectionModal
          collectionId={modal.collectionId}
          onClose={() => setModal(null)}
        />
      )}
      {modal?.kind === "manual" && (
        <ManualCollectionModal
          collectionId={modal.collectionId}
          onClose={() => setModal(null)}
        />
      )}
    </div>
  );
}
