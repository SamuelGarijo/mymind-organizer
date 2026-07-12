import { useEffect, useMemo, useRef, useState } from "react";
import { useShallow } from "zustand/react/shallow";
import { getVisibleObjects, useStore, type VisibilityState } from "./store";
import { useDebouncedValue } from "./lib/useDebouncedValue";
import { Sidebar } from "./components/Sidebar";
import { Grid } from "./components/Grid";
import { Table } from "./components/Table";
import { DetailPanel } from "./components/DetailPanel";
import { SmartCollectionModal } from "./components/SmartCollectionModal";
import { ManualCollectionModal } from "./components/ManualCollectionModal";
import { FilterBar } from "./components/FilterBar";
import {
  applyExcludedTags,
  applyFacetFieldFilter,
  applyFacetTags,
  applyTypeFilter,
  computeObjectTypes,
  computeTopTags,
} from "./lib/quickFilter";
import { buildSearchIndex, searchObjects } from "./lib/search";
import { describeMymindError, fetchAllMymindIds, syncFull, syncIncremental } from "./lib/mymindSync";
import { getStoredBackupHandle, writeBackup } from "./lib/autoBackup";
import { parseBackup } from "./lib/backupValidation";
import { norm } from "./lib/ruleEngine";
import { computeTagFrequency } from "./lib/tagDistinctiveness";
import { CredentialsModal } from "./components/CredentialsModal";
import { suggestRole } from "./lib/roleSuggestion";
import type { FacetField } from "./types";

// Set right before a restore-triggered reload, read once on the next
// mount — sessionStorage (not state) is the only thing that survives the
// reload itself.
const RESTORE_NOTICE_KEY = "organizer_restore_notice";

type Modal =
  | { kind: "smart"; collectionId?: string }
  | { kind: "manual"; collectionId?: string }
  | null;

type SyncStatus =
  | { status: "idle" }
  | { status: "loading" }
  | { status: "error"; message: string }
  | {
      status: "done";
      count: number;
      truncated: boolean;
      scannedFullLibrary: boolean;
      backupSuspect?: boolean;
      /** How many locally-mirrored objects were removed because mymind no
       * longer has them (see reconcileMymindDeletions). Undefined (not 0)
       * when the check itself was skipped or failed — distinct from "ran
       * and found nothing to remove". */
      removedCount?: number;
    };

function viewTitle(state: VisibilityState): string {
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
  // A shallow-selected subset, not the whole store — with a bare useStore()
  // this component (and everything it renders) re-ran on every single store
  // change, including changes nothing here reads (e.g. lastBackupAt ticking
  // mid-sync while you're typing). useShallow only re-renders when one of
  // these specific values actually changes.
  const state = useStore(
    useShallow((s) => ({
      objects: s.objects,
      collections: s.collections,
      selectedView: s.selectedView,
      tagGroups: s.tagGroups,
      roles: s.roles,
      typeFilter: s.typeFilter,
      searchQuery: s.searchQuery,
      facetTags: s.facetTags,
      facetMode: s.facetMode,
      excludedTags: s.excludedTags,
      facetFieldFilter: s.facetFieldFilter,
      viewMode: s.viewMode,
      detailObjectId: s.detailObjectId,
      syncMymindObjects: s.syncMymindObjects,
      reconcileMymindDeletions: s.reconcileMymindDeletions,
      exportDataString: s.exportDataString,
      setLastBackupAt: s.setLastBackupAt,
      restoreFromBackup: s.restoreFromBackup,
      openDetail: s.openDetail,
      closeDetail: s.closeDetail,
      setViewMode: s.setViewMode,
      bulkAssignRoles: s.bulkAssignRoles,
    }))
  );

  // Fuse.search() over up to ~8k objects is a synchronous ~250-400ms call —
  // debouncing means a burst of keystrokes runs it once after you pause,
  // not once per keystroke. The input itself is unaffected: FilterBar reads
  // searchQuery directly from the store, independent of this.
  const debouncedSearchQuery = useDebouncedValue(state.searchQuery, 150);

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
    () => searchObjects(searchIndex, debouncedSearchQuery, typeFiltered),
    [searchIndex, debouncedSearchQuery, typeFiltered]
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

  const facetFiltered = useMemo(
    () => applyFacetTags(searchFiltered, state.facetTags, state.facetMode),
    [searchFiltered, state.facetTags, state.facetMode]
  );
  const excludeFiltered = useMemo(
    () => applyExcludedTags(facetFiltered, state.excludedTags),
    [facetFiltered, state.excludedTags]
  );
  const visibleObjects = useMemo(
    () => applyFacetFieldFilter(excludeFiltered, state.facetFieldFilter),
    [excludeFiltered, state.facetFieldFilter]
  );

  // Library-wide, not view-scoped — "distinctive" means rare across
  // everything, and this must stay a stable reference across renders where
  // objects haven't changed, or every Card/TableRow would re-render for
  // nothing (see Card.tsx).
  const tagFrequency = useMemo(
    () => computeTagFrequency(Object.values(state.objects)),
    [state.objects]
  );

  // Fields travel with each object's item type now (issue #84), not with
  // the collection — so the table's columns are the union of the field
  // packages for every role present in the current view. Works in any
  // view, "All items" included; deduped case-insensitively since two roles
  // can legitimately share a field (e.g. Author on both Book and Photo).
  const facetColumns: FacetField[] = useMemo(() => {
    const seen = new Set<string>();
    const columns: FacetField[] = [];
    for (const obj of baseObjects) {
      if (!obj.role) continue;
      const def = state.roles[norm(obj.role)];
      if (!def) continue;
      for (const field of def.fields) {
        const key = field.name.toLowerCase();
        if (!seen.has(key)) {
          seen.add(key);
          columns.push(field);
        }
      }
    }
    return columns;
  }, [baseObjects, state.roles]);

  // Identifies the logical view (not the filtered results) — Grid resets
  // its progressive-reveal render count only when THIS changes, not on
  // every keystroke of a search/facet filter (which changes `objects`'
  // identity constantly without actually switching views).
  const viewKey = JSON.stringify(state.selectedView);

  const [modal, setModal] = useState<Modal>(null);
  const [fullResync, setFullResync] = useState(false);
  const [syncState, setSyncState] = useState<SyncStatus>({ status: "idle" });
  const [prefsOpen, setPrefsOpen] = useState(false);
  const [credentialsModal, setCredentialsModal] = useState<{ dismissible: boolean } | null>(null);
  const [restoreNotice, setRestoreNotice] = useState(false);
  const restoreInputRef = useRef<HTMLInputElement>(null);
  const prefsRef = useRef<HTMLDivElement>(null);
  const autoSyncedOnMount = useRef(false);

  // First run: no MYMIND_KID/MYMIND_SECRET in .env yet means every mymind
  // call would just fail one by one with a confusing error — ask for the
  // key up front instead. A fetch failure here (proxy not running yet)
  // is left alone; that already surfaces via the normal sync error banner.
  useEffect(() => {
    fetch("/api/health")
      .then((r) => r.json())
      .then((data: { credentialsConfigured: boolean }) => {
        if (!data.credentialsConfigured) setCredentialsModal({ dismissible: false });
      })
      .catch(() => {});
  }, []);

  // Read once on mount: the restore flow sets this flag then reloads the
  // page (see handleRestoreFile) since a full page reload is the simplest
  // way to guarantee every view re-reads the freshly-restored IndexedDB
  // store, rather than trusting every component downstream to notice.
  useEffect(() => {
    if (sessionStorage.getItem(RESTORE_NOTICE_KEY)) {
      sessionStorage.removeItem(RESTORE_NOTICE_KEY);
      setRestoreNotice(true);
    }
  }, []);

  // Closes the Preferences menu on an outside click — sync/backup controls
  // are used occasionally, not constantly (issue #74), so this is a plain
  // dropdown rather than a modal that blocks the rest of the view.
  useEffect(() => {
    if (!prefsOpen) return;
    function onPointerDown(e: MouseEvent) {
      if (prefsRef.current && !prefsRef.current.contains(e.target as Node)) {
        setPrefsOpen(false);
      }
    }
    document.addEventListener("mousedown", onPointerDown);
    return () => document.removeEventListener("mousedown", onPointerDown);
  }, [prefsOpen]);

  const view = state.selectedView;
  // Channel-style framing for the current collection, if any (issue #87) —
  // description/hero image are collection metadata, not tied to smart vs.
  // manual, so this reads the same way for either type.
  const currentCollection =
    view.kind === "collection" ? state.collections[view.collectionId] : undefined;
  const heroObject = currentCollection?.heroImageObjectId
    ? state.objects[currentCollection.heroImageObjectId]
    : undefined;
  // Matches the debounced value the results are actually computed from, so
  // this message never flashes out of sync with what's on screen.
  const isQuickFiltering =
    debouncedSearchQuery.trim() !== "" ||
    state.facetTags.length > 0 ||
    state.excludedTags.length > 0 ||
    state.facetFieldFilter !== null;
  const emptyLabel = isQuickFiltering
    ? "Nothing matches your search/tag filters in this view."
    : view.kind === "unclassified"
    ? "Nothing unclassified — everything is either sorted into a folder or matched by a smart collection."
    : view.kind === "similar"
    ? "No embeddings available to compare — sync from mymind first."
    : view.kind === "all"
    ? "No items yet. Sync from mymind to get started."
    : "No items in this collection yet.";

  async function runSync(opts: { full: boolean }) {
    setSyncState({ status: "loading" });
    try {
      // Embeddings are requested on every sync, not gated behind a checkbox
      // — "Similar to this" is expected to just work after any sync, not
      // only when the user remembered to opt in. Larger payload per sync is
      // an accepted tradeoff for that (see idbStorage/embeddingsStorage for
      // how the resulting data is kept off the hot persistence path).
      // Reads the store directly rather than the `state` snapshot closed
      // over by this render: on the mount-triggered sync below, IndexedDB
      // rehydration can still be in flight when this fires, and a stale
      // (pre-hydration, empty) `state.objects` would make the incremental
      // boundary-scan match nothing and silently degrade into a full-
      // library scan on every single launch — exactly the bug this fixes.
      const result = opts.full
        ? await syncFull({ includeEmbeddings: true })
        : await syncIncremental({ includeEmbeddings: true }, useStore.getState().objects);
      state.syncMymindObjects(result.objects);

      // Detect objects deleted in mymind so the local mirror doesn't keep
      // showing them forever (issue #29) — every sync reconciles, not just
      // Full resync, per Samuel's call: this should just happen on refresh/
      // launch/plain "Sync from mymind", no extra opt-in needed. A full
      // resync already fetched everything, so its own result IS the
      // present-id set for free; incremental sync deliberately only fetches
      // what's new/changed, so this needs one extra lightweight request.
      // Skipped (removedCount left undefined) on any failure or a
      // `truncated` id set — a partial list would misidentify objects
      // mymind just didn't get around to listing as deleted (the exact
      // false-positive risk issue #29 flagged), so this only ever acts on a
      // response confirmed complete.
      let removedCount: number | undefined;
      try {
        const deletionCheck = opts.full
          ? { presentIds: new Set(result.objects.map((o) => o.id)), truncated: result.truncated }
          : await fetchAllMymindIds({});
        if (!deletionCheck.truncated) {
          removedCount = state.reconcileMymindDeletions(deletionCheck.presentIds);
        }
      } catch {
        // Best-effort — the main sync already succeeded, so a hiccup here
        // just means deletions aren't reconciled this round, not a failure
        // worth surfacing as a sync error.
      }

      setSyncState({
        status: "done",
        count: result.newOrChangedCount,
        truncated: result.truncated,
        scannedFullLibrary: result.scannedFullLibrary,
        removedCount,
      });

      // Auto-backup: only if the user has already opted in by choosing a
      // folder (see Sidebar). Runs on every successful sync, found-nothing
      // included, per spec — silent, never blocks or errors the sync itself.
      const handle = await getStoredBackupHandle();
      if (handle) {
        const backup = await writeBackup(handle, state.exportDataString());
        if (backup.ok) state.setLastBackupAt(new Date().toISOString());
        if (backup.suspect) {
          setSyncState((s) => (s.status === "done" ? { ...s, backupSuspect: true } : s));
        }
      }
    } catch (err) {
      setSyncState({ status: "error", message: describeMymindError(err) });
    }
  }

  function handleSync() {
    void runSync({ full: fullResync });
  }

  // On app open, quietly try an incremental sync against the whole library
  // so the Organizer never silently drifts stale. Failures (e.g. proxy not
  // running yet) just surface the normal error banner rather than anything
  // more intrusive.
  //
  // Waits for the persisted store to actually finish loading from IndexedDB
  // first — firing immediately on mount risked running before rehydration
  // completed, handing syncIncremental an empty local cache to diff
  // against. With nothing to match, its boundary-scan found nothing and
  // silently fell back to a full-library scan on every single launch.
  //
  // Polls `hasHydrated()` directly rather than the persist middleware's own
  // `onFinishHydration` subscription — that event is fired once, from the
  // single hydration pass kicked off when the store module first
  // evaluates, and in practice proved unreliable to catch here (observed,
  // in this exact dev setup, never firing for a listener registered after
  // that pass was already in flight). Polling the plain boolean sidesteps
  // that subscription-timing question entirely.
  //
  // Deliberately no cleanup function: this only ever needs to fire once,
  // ever (guarded by the ref below, never reset). A cleanup here would be
  // actively harmful under StrictMode's dev-only mount→cleanup→remount
  // dance — it would cancel the first pass's pending poll while the ref it
  // already flipped stops the second pass from starting its own, so the
  // sync would silently never fire at all (found the hard way while
  // building this).
  useEffect(() => {
    if (autoSyncedOnMount.current) return;
    autoSyncedOnMount.current = true;

    function tryStart() {
      if (useStore.persist.hasHydrated()) {
        void runSync({ full: false });
      } else {
        setTimeout(tryStart, 50);
      }
    }
    tryStart();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Issue #104: computes a suggestion for every object without a role,
  // shows the impact grouped by role (never applies blind — thousands of
  // objects could be affected), then writes them all in one atomic update
  // via bulkAssignRoles. Objects that already have a role, or that match
  // no rule at all, are left untouched either way.
  function handleAutoAssignRoles() {
    const assignments: { objectId: string; role: string }[] = [];
    const counts = new Map<string, number>();
    for (const obj of Object.values(state.objects)) {
      if (obj.role) continue;
      const suggestion = suggestRole(obj);
      if (!suggestion) continue;
      assignments.push({ objectId: obj.id, role: suggestion });
      counts.set(suggestion, (counts.get(suggestion) ?? 0) + 1);
    }
    if (assignments.length === 0) {
      alert("Nothing to assign — every object either already has a type or matches no rule.");
      return;
    }
    const summary = Array.from(counts.entries())
      .sort((a, b) => b[1] - a[1])
      .map(([role, count]) => `${role}: ${count}`)
      .join("\n");
    const ok = window.confirm(
      `This will assign an item type to ${assignments.length.toLocaleString()} object` +
        `${assignments.length === 1 ? "" : "s"}:\n\n${summary}\n\n` +
        "Always editable afterward from any item's detail panel. Continue?"
    );
    if (!ok) return;
    state.bulkAssignRoles(assignments);
  }

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
    file.text().then((text) => {
      // Validated up front (not just inside restoreFromBackup) so a bad
      // file is rejected with a specific reason before the confirm dialog
      // even appears, and so the dialog can show the backup's real
      // contents instead of a generic warning.
      let parsed: ReturnType<typeof parseBackup>;
      try {
        parsed = parseBackup(text);
      } catch (err) {
        alert("Couldn't read that backup file: " + (err as Error).message);
        return;
      }

      const currentCount = Object.keys(state.objects).length;
      const objectCount = parsed.objects.length;
      const collectionCount = parsed.collections.length;
      const summary =
        `This backup contains ${objectCount.toLocaleString()} object${objectCount === 1 ? "" : "s"}` +
        ` and ${collectionCount} collection${collectionCount === 1 ? "" : "s"}.`;
      const ok = window.confirm(
        `${summary}\n\n` +
          (currentCount > 0
            ? `Restore it? It replaces everything currently in the Organizer (${currentCount.toLocaleString()} items) — this can't be undone. mymind itself is never touched.`
            : "Restore it into the Organizer?")
      );
      if (!ok) return;

      try {
        state.restoreFromBackup(text);
      } catch (err) {
        alert("Couldn't restore that backup: " + (err as Error).message);
        return;
      }

      // A reload (rather than trusting every mounted component to notice
      // the store swap) is what actually fixed the "collections don't
      // show up" symptom this was built for — simplest guarantee that
      // every view re-reads the restored store from scratch.
      sessionStorage.setItem(RESTORE_NOTICE_KEY, "1");
      window.location.reload();
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
            <div className="relative" ref={prefsRef}>
              <button
                onClick={() => setPrefsOpen((v) => !v)}
                className={[
                  "text-[13px] w-8 h-8 flex items-center justify-center rounded-lg border border-line hover:bg-line/40",
                  prefsOpen ? "bg-line/40" : "",
                ].join(" ")}
                title="Organizer preferences — sync and backup"
                aria-label="Organizer preferences"
              >
                ⚙
              </button>
              {prefsOpen && (
                <div className="absolute right-0 top-full mt-1.5 w-64 rounded-lg border border-line bg-panel shadow-cardHover p-3 z-20 text-[12px]">
                  <div className="text-[11px] uppercase tracking-wide text-muted mb-1.5">Sync</div>
                  <label
                    className="flex items-center gap-1.5 text-muted mb-2"
                    title="Ignore what's already synced and refetch everything"
                  >
                    <input
                      type="checkbox"
                      checked={fullResync}
                      onChange={(e) => setFullResync(e.target.checked)}
                    />
                    Full resync
                  </label>
                  <button
                    onClick={() => {
                      handleSync();
                      setPrefsOpen(false);
                    }}
                    disabled={syncState.status === "loading"}
                    className="w-full text-left px-2.5 py-1.5 rounded-lg border border-line hover:bg-line/40 disabled:opacity-50"
                  >
                    {syncState.status === "loading" ? "Syncing…" : "Sync from mymind"}
                  </button>

                  <div className="text-[11px] uppercase tracking-wide text-muted mt-3 mb-1.5">
                    Backup
                  </div>
                  <button
                    onClick={() => {
                      handleExport();
                      setPrefsOpen(false);
                    }}
                    className="w-full text-left px-2.5 py-1.5 rounded-lg border border-line hover:bg-line/40 mb-1.5"
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
                    onClick={() => {
                      restoreInputRef.current?.click();
                      setPrefsOpen(false);
                    }}
                    className="w-full text-left px-2.5 py-1.5 rounded-lg border border-line hover:bg-line/40"
                    title="Replaces everything with a previously exported backup"
                  >
                    Restore backup
                  </button>

                  <div className="text-[11px] uppercase tracking-wide text-muted mt-3 mb-1.5">
                    Item types
                  </div>
                  <button
                    onClick={() => {
                      handleAutoAssignRoles();
                      setPrefsOpen(false);
                    }}
                    className="w-full text-left px-2.5 py-1.5 rounded-lg border border-line hover:bg-line/40"
                    title="Suggests an item type for every object that doesn't have one yet, from its mymind type and tags — shows the impact before applying anything"
                  >
                    Auto-assign roles
                  </button>

                  <div className="text-[11px] uppercase tracking-wide text-muted mt-3 mb-1.5">
                    Connection
                  </div>
                  <button
                    onClick={() => {
                      setCredentialsModal({ dismissible: true });
                      setPrefsOpen(false);
                    }}
                    className="w-full text-left px-2.5 py-1.5 rounded-lg border border-line hover:bg-line/40"
                    title="View or replace the mymind API key this app connects with"
                  >
                    mymind API credentials
                  </button>
                </div>
              )}
            </div>
          </div>
        </header>

        {currentCollection && (currentCollection.description || heroObject?.imageUrl) && (
          <div className="shrink-0 border-b border-line bg-panel px-5 py-3 flex items-start gap-3">
            {heroObject?.imageUrl && (
              <img
                src={heroObject.imageUrl}
                alt=""
                className="w-16 h-16 rounded-lg object-cover shrink-0"
              />
            )}
            {currentCollection.description && (
              <p className="text-[13px] text-ink/80 leading-relaxed">
                {currentCollection.description}
              </p>
            )}
          </div>
        )}

        {restoreNotice && (
          <div className="px-5 py-2 bg-emerald-50 border-b border-emerald-200 text-[12px] text-emerald-800 flex items-center justify-between gap-3">
            <span>Your data is back and ready to use!</span>
            <button
              onClick={() => setRestoreNotice(false)}
              className="text-emerald-800/60 hover:text-emerald-800 shrink-0"
              aria-label="Dismiss"
            >
              ×
            </button>
          </div>
        )}
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
                " mymind capped this response at its per-request limit — there may be more than shown."}
              {!!syncState.removedCount &&
                ` Removed ${syncState.removedCount} deleted in mymind.`}
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
        {syncState.status === "done" && syncState.backupSuspect && (
          <div className="px-5 py-2 bg-amber-50 border-b border-amber-200 text-[12px] text-amber-900">
            ⚠ This sync's backup was written as <code>-SUSPECT.json</code> instead of rotating in
            normally — it has 20%+ fewer objects than the last good backup. That can happen
            legitimately (e.g. right after deleting a lot locally), but it's also what a corrupted
            local store looks like — check the file before trusting it, and use an older backup to
            roll back if needed.
          </div>
        )}

        <FilterBar
          topTags={topTags}
          objectTypes={objectTypes}
          facetColumns={facetColumns}
          fieldFilterPool={excludeFiltered}
        />

        <div className="flex-1 overflow-hidden">
          {state.viewMode === "table" ? (
            <div className="h-full p-5">
              <Table
                objects={visibleObjects}
                facetColumns={facetColumns}
                tagFrequency={tagFrequency}
                onOpen={state.openDetail}
                emptyLabel={emptyLabel}
                viewKey={viewKey}
              />
            </div>
          ) : (
            <div className="h-full overflow-y-auto p-5">
              <Grid
                objects={visibleObjects}
                facetColumns={facetColumns}
                tagFrequency={tagFrequency}
                viewKey={viewKey}
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

      {credentialsModal && (
        <CredentialsModal
          dismissible={credentialsModal.dismissible}
          onClose={() => setCredentialsModal(null)}
          onSaved={() => void runSync({ full: false })}
        />
      )}
    </div>
  );
}
