import { useEffect, useMemo, useRef, useState } from "react";
import { AnimatePresence, motion } from "motion/react";
import { useShallow } from "zustand/react/shallow";
import { getVisibleObjects, useStore, type VisibilityState } from "./store";
import { useDebouncedValue } from "./lib/useDebouncedValue";
import { Sidebar } from "./components/Sidebar";
import { Grid } from "./components/Grid";
import { Table } from "./components/Table";
import { DetailPanel } from "./components/DetailPanel";
import { DetailCarousel } from "./components/DetailCarousel";
import { SmartCollectionModal } from "./components/SmartCollectionModal";
import { ManualCollectionModal } from "./components/ManualCollectionModal";
import { TopBar } from "./components/TopBar";
import { CollectionLedger, PileChips, RoleStrip } from "./components/CollectionLedger";
import { ClassifyPanel } from "./components/ClassifyPanel";
import { distinctRoleKeys, resolveActiveRole } from "./lib/primaryFacets";
import {
  applyExcludedTags,
  applyFacetFieldFilter,
  applyFacetTags,
  applyRoleFilter,
  applyTypeFilter,
  computeCuratedPiles,
  computeObjectTypes,
  computeRoleFrequency,
  computeTopTags,
} from "./lib/quickFilter";
import { applyColorFilter } from "./lib/colorSearch";
import { buildSearchIndex, searchObjects } from "./lib/search";
import { describeMymindError, fetchAllMymindIds, syncFull, syncIncremental } from "./lib/mymindSync";
import { getStoredBackupHandle, writeBackup } from "./lib/autoBackup";
import { parseBackup } from "./lib/backupValidation";
import { norm } from "./lib/ruleEngine";
import { surfaceVariants } from "./lib/chrome";
import { computeTagFrequency } from "./lib/tagDistinctiveness";
import { CredentialsModal } from "./components/CredentialsModal";
import { suggestRole } from "./lib/roleSuggestion";
import type { DesignObject, FacetField } from "./types";

// Set right before a restore-triggered reload, read once on the next
// mount — sessionStorage (not state) is the only thing that survives the
// reload itself.
const RESTORE_NOTICE_KEY = "organizer_restore_notice";

type Modal =
  // parentId (issue #126) only matters on a fresh create (no collectionId) —
  // nests the new collection under a manual collection.
  | { kind: "smart"; collectionId?: string; parentId?: string }
  | { kind: "manual"; collectionId?: string; parentId?: string }
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
      localUserTags: s.localUserTags,
      typeFilter: s.typeFilter,
      roleFilter: s.roleFilter,
      groupBy: s.groupBy,
      colorFilter: s.colorFilter,
      setColorFilter: s.setColorFilter,
      gridZoom: s.gridZoom,
      setGridZoom: s.setGridZoom,
      searchQuery: s.searchQuery,
      facetTags: s.facetTags,
      facetMode: s.facetMode,
      excludedTags: s.excludedTags,
      facetFieldFilter: s.facetFieldFilter,
      viewMode: s.viewMode,
      detailViewMode: s.detailViewMode,
      detailObjectId: s.detailObjectId,
      carouselObjectId: s.carouselObjectId,
      classificationPanelOpen: s.classificationPanelOpen,
      openClassificationPanel: s.openClassificationPanel,
      closeClassificationPanel: s.closeClassificationPanel,
      syncMymindObjects: s.syncMymindObjects,
      reconcileMymindDeletions: s.reconcileMymindDeletions,
      exportDataString: s.exportDataString,
      setLastBackupAt: s.setLastBackupAt,
      restoreFromBackup: s.restoreFromBackup,
      openDetail: s.openDetail,
      closeDetail: s.closeDetail,
      openCarousel: s.openCarousel,
      closeCarousel: s.closeCarousel,
      setViewMode: s.setViewMode,
      setDetailViewMode: s.setDetailViewMode,
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

  // Cascading facet options (the "getFacetedUniqueValues" idea from the
  // TanStack Table research, #119): each dropdown reflects every OTHER
  // active filter (role/tags/exclude/field) but never itself, so picking
  // Type=Article then opening Item type only offers item types that
  // actually exist among Articles — not an option that would return zero
  // results. Deliberately doesn't also fold in the free-text search (that
  // would mean rebuilding a second Fuse index per keystroke just for two
  // dropdowns — not worth the cost for a value that changes that often).
  const objectTypesPool = useMemo(() => {
    let pool = applyRoleFilter(baseObjects, state.roleFilter);
    pool = applyFacetTags(pool, state.facetTags, state.facetMode);
    pool = applyExcludedTags(pool, state.excludedTags);
    return applyFacetFieldFilter(pool, state.facetFieldFilter);
  }, [baseObjects, state.roleFilter, state.facetTags, state.facetMode, state.excludedTags, state.facetFieldFilter]);
  const objectTypes = useMemo(() => computeObjectTypes(objectTypesPool), [objectTypesPool]);

  const roleTypesPool = useMemo(() => {
    let pool = applyTypeFilter(baseObjects, state.typeFilter);
    pool = applyFacetTags(pool, state.facetTags, state.facetMode);
    pool = applyExcludedTags(pool, state.excludedTags);
    return applyFacetFieldFilter(pool, state.facetFieldFilter);
  }, [baseObjects, state.typeFilter, state.facetTags, state.facetMode, state.excludedTags, state.facetFieldFilter]);
  const roleTypes = useMemo(() => computeRoleFrequency(roleTypesPool), [roleTypesPool]);

  const typeFiltered = useMemo(
    () => applyTypeFilter(baseObjects, state.typeFilter),
    [baseObjects, state.typeFilter]
  );
  const roleFiltered = useMemo(
    () => applyRoleFilter(typeFiltered, state.roleFilter),
    [typeFiltered, state.roleFilter]
  );

  // Fuse indexing (~8000 objects) is real work — rebuild only when the
  // candidate pool changes, not on every keystroke. Search always narrows
  // the pool first, regardless of facet mode.
  const searchIndex = useMemo(() => buildSearchIndex(roleFiltered), [roleFiltered]);
  const searchFiltered = useMemo(
    () => searchObjects(searchIndex, debouncedSearchQuery, roleFiltered),
    [searchIndex, debouncedSearchQuery, roleFiltered]
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

  // Curated Piles (user-created tags only) — deliberately computed from
  // baseObjects, not the further-narrowed topTagsSource: piles are a stable
  // set of buttons for this view/collection, not a self-narrowing facet
  // browser, so clicking one filters the grid without other piles
  // disappearing from the bar itself.
  const curatedPiles = useMemo(
    () => computeCuratedPiles(baseObjects, state.localUserTags),
    [baseObjects, state.localUserTags]
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
  const fieldFiltered = useMemo(
    () => applyFacetFieldFilter(excludeFiltered, state.facetFieldFilter),
    [excludeFiltered, state.facetFieldFilter]
  );
  const visibleObjects = useMemo(
    () => applyColorFilter(fieldFiltered, state.colorFilter),
    [fieldFiltered, state.colorFilter]
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

  // Collection-workspace feature: which role is "active" for the top bar
  // and classification panel, resolved against the collection's full
  // membership (baseObjects), not the further quick-filter-narrowed
  // visibleObjects — the workspace's own structure shouldn't reshuffle as
  // someone types a search. See lib/primaryFacets.ts for the resolution
  // rules themselves.
  const activeRole = useMemo(
    () => resolveActiveRole(baseObjects, state.roles, state.roleFilter),
    [baseObjects, state.roles, state.roleFilter]
  );

  const [modal, setModal] = useState<Modal>(null);
  const [fullResync, setFullResync] = useState(false);
  const [syncState, setSyncState] = useState<SyncStatus>({ status: "idle" });
  const [prefsOpen, setPrefsOpen] = useState(false);
  // Which of the active role's primary facets the classify panel is folding
  // by — lives here (not in the panel) because the main grid's reservoir
  // ("things with no value for THIS facet yet") depends on it too.
  const [classifyField, setClassifyField] = useState<string | null>(null);

  // A stale roleFilter surviving a collection switch could silently show
  // "0 objects match" for a role the new collection doesn't have — reset it
  // whenever the logical view changes (moved here from the old
  // PrimaryFacetsBar when the ledger became scroll content). The grouping
  // lens is view-local presentation state on the same footing.
  const setRoleFilter = useStore((s) => s.setRoleFilter);
  const setGroupBy = useStore((s) => s.setGroupBy);
  useEffect(() => {
    setRoleFilter("");
    setGroupBy(null);
  }, [viewKey, setRoleFilter, setGroupBy]);

  // Success toasts self-dismiss — a floating "already up to date" that
  // lingered forever would just be chrome noise with extra steps. Errors
  // stay until dismissed.
  useEffect(() => {
    if (syncState.status !== "done" || syncState.backupSuspect) return;
    const t = setTimeout(() => setSyncState({ status: "idle" }), 6000);
    return () => clearTimeout(t);
  }, [syncState]);
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

  // --- Classify-mode derivations (the floating-panel inversion, N8) -------
  // The panel folds by one primary facet at a time; the main grid becomes
  // the reservoir — this collection's role-carrying things that have no
  // value for that facet yet. Quick filters/search still apply (they narrow
  // visibleObjects upstream), so you can search within the unclassified.
  const primaryFacetNames = activeRole?.primaryFacets ?? [];
  const effectiveClassifyField =
    classifyField && primaryFacetNames.includes(classifyField)
      ? classifyField
      : primaryFacetNames[0] ?? null;
  const classifyOpen = state.classificationPanelOpen && !!activeRole;
  const reservoirObjects = useMemo(() => {
    if (!classifyOpen || !activeRole || !effectiveClassifyField) return [];
    return visibleObjects.filter((o) => {
      if (!o.role || norm(o.role) !== norm(activeRole.name)) return false;
      const raw = o.fields[effectiveClassifyField];
      const values = Array.isArray(raw) ? raw : raw ? [raw] : [];
      return values.length === 0;
    });
  }, [classifyOpen, activeRole, effectiveClassifyField, visibleObjects]);
  const roleObjects = useMemo(() => {
    if (!activeRole) return [];
    return baseObjects.filter((o) => o.role && norm(o.role) === norm(activeRole.name));
  }, [baseObjects, activeRole]);
  const collectionIds = useMemo(() => new Set(baseObjects.map((o) => o.id)), [baseObjects]);
  // Stable reference per objects-map identity — the similarity corpus cache
  // keys on it (lib/hybridSimilarity.ts).
  const allObjectsList = useMemo(() => Object.values(state.objects), [state.objects]);

  // The folders panel is the collection's own architecture, so entering a
  // world that's already set up opens it by default (Samuel's call) — and
  // leaving, or entering one with nothing pinned yet, closes it. Closing it
  // by hand (✦ / ×) sticks until the next view change; this only fires on
  // viewKey transitions, deliberately reading the freshly-computed
  // primaryFacetNames of the view just entered.
  useEffect(() => {
    if (view.kind === "collection" && primaryFacetNames.length > 0) {
      state.openClassificationPanel();
    } else {
      state.closeClassificationPanel();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [viewKey]);
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

  // Single entry point for the top bar's "Classify" button — owns the "is
  // this collection set up yet" decision so PrimaryFacetsBar/Board never
  // have to. Scoped to this collection's own objects (baseObjects), unlike
  // handleAutoAssignRoles above which sweeps the whole library. Suggests +
  // assigns a type where none exists (same suggestRole engine, same
  // confirm-before-writing pattern), then pins a starter set of primary
  // facets for any role present here that has fields but nothing pinned
  // yet — a freshly-created role already got a curated field package for
  // free via applyRoleToObject, so this just makes it visible in the
  // workspace immediately instead of requiring a second manual pin step.
  function handleClassifyClick() {
    if (state.classificationPanelOpen) {
      state.closeClassificationPanel();
      return;
    }
    const ids = baseObjects.map((o) => o.id);
    if (distinctRoleKeys(baseObjects).size === 0) {
      const assignments: { objectId: string; role: string }[] = [];
      const counts = new Map<string, number>();
      for (const obj of baseObjects) {
        const suggestion = suggestRole(obj);
        if (!suggestion) continue;
        assignments.push({ objectId: obj.id, role: suggestion });
        counts.set(suggestion, (counts.get(suggestion) ?? 0) + 1);
      }
      if (assignments.length === 0) {
        alert(
          "Couldn't suggest a type for anything in this collection — assign one by hand from an item's detail panel, then try Classify again."
        );
        return;
      }
      const summary = Array.from(counts.entries())
        .sort((a, b) => b[1] - a[1])
        .map(([role, count]) => `${role}: ${count}`)
        .join("\n");
      const ok = window.confirm(
        `Set up this collection as a workspace? This assigns a type to ${assignments.length.toLocaleString()} object${
          assignments.length === 1 ? "" : "s"
        }:\n\n${summary}\n\nAlways editable afterward from any item's detail panel. Continue?`
      );
      if (!ok) return;
      state.bulkAssignRoles(assignments);
    }

    const fresh = useStore.getState();
    const freshObjects = ids
      .map((id) => fresh.objects[id])
      .filter((o): o is DesignObject => Boolean(o));
    for (const key of distinctRoleKeys(freshObjects)) {
      const def = fresh.roles[key];
      if (!def || def.fields.length === 0) continue;
      if (def.primaryFacets && def.primaryFacets.length > 0) continue;
      fresh.updateRoleFields(
        def.name,
        def.fields,
        def.fields.slice(0, 3).map((f) => f.name)
      );
    }

    state.openClassificationPanel();
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

  // The preferences trigger + popover (issue #128) — state/handlers all
  // stay right here (sync/backup/credentials are already owned by this
  // component), just handed to Sidebar as a ready-built node so it can
  // place the icon wherever its condensed control column wants it,
  // without either component needing to know the other's internals.
  const prefsControl = (
    <div className="relative" ref={prefsRef}>
      <button
        onClick={() => setPrefsOpen((v) => !v)}
        className={[
          "w-7 h-7 flex items-center justify-center rounded-md text-[13px] transition-colors",
          prefsOpen ? "bg-line/60 text-ink" : "text-muted hover:text-ink hover:bg-line/40",
        ].join(" ")}
        title="Organizer preferences — sync and backup"
        aria-label="Organizer preferences"
      >
        ⚙
      </button>
      <AnimatePresence>
      {prefsOpen && (
        <motion.div
          custom={{ x: -8, y: 0 }}
          variants={surfaceVariants}
          initial="hidden"
          animate="visible"
          exit="exit"
          className="absolute left-full top-0 ml-2 w-64 max-h-[calc(100vh-2rem)] overflow-y-auto rounded-xl border border-line/70 bg-panel shadow-cardHover p-3 z-50 text-[12px]">
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
            Detail view
          </div>
          <p className="text-[11px] text-muted mb-1.5">
            Also switchable from the detail panel itself (⌘L).
          </p>
          <div className="flex gap-1 mb-2">
            {(["side", "centered"] as const).map((mode) => (
              <button
                key={mode}
                onClick={() => state.setDetailViewMode(mode)}
                className={[
                  "flex-1 capitalize px-2 py-1.5 rounded-lg border border-line text-[11px]",
                  state.detailViewMode === mode ? "bg-ink text-white" : "hover:bg-line/40",
                ].join(" ")}
                title={
                  mode === "side"
                    ? "Docked to the right, current default"
                    : "Same details, centered and larger"
                }
              >
                {mode}
              </button>
            ))}
          </div>

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
        </motion.div>
      )}
      </AnimatePresence>
    </div>
  );

  return (
    <div className="h-screen w-screen flex overflow-hidden">
      <Sidebar
        onNewSmart={(parentId) => setModal({ kind: "smart", parentId })}
        onNewManual={(parentId) => setModal({ kind: "manual", parentId })}
        onEditSmart={(collectionId) => setModal({ kind: "smart", collectionId })}
        onEditManual={(collectionId) => setModal({ kind: "manual", collectionId })}
        prefsControl={prefsControl}
      />

      <main className="flex-1 flex flex-col min-w-0">
        {/* The single resident band (design-philosophy N1). */}
        <TopBar
          title={viewTitle(state)}
          count={visibleObjects.length}
          isCollection={view.kind === "collection"}
          boardOpen={state.classificationPanelOpen}
          onClassifyClick={handleClassifyClick}
          topTags={topTags}
          objectTypes={objectTypes}
          roleTypes={roleTypes}
          facetColumns={facetColumns}
          fieldFilterPool={excludeFiltered}
          colorFilter={state.colorFilter}
          setColorFilter={state.setColorFilter}
        />

        <div className="flex-1 overflow-hidden">
          {classifyOpen && activeRole ? (
            <div className="h-full flex flex-col">
              {/* Role picker stays reachable while classifying — contextual
                  chrome tied to the intent (N21). */}
              <RoleStrip objects={baseObjects} roles={state.roles} roleFilter={state.roleFilter} />
              {/* The reservoir IS the main space (N8): the not-yet-folded
                  things keep the sacred area; folders float beside them. */}
              <div className="flex-1 overflow-y-auto pl-5 pr-[26rem] pt-3 pb-5">
                <Grid
                  objects={reservoirObjects}
                  facetColumns={facetColumns}
                  tagFrequency={tagFrequency}
                  viewKey={viewKey + ":classify:" + (effectiveClassifyField ?? "")}
                  onOpen={state.openDetail}
                  emptyLabel={
                    effectiveClassifyField
                      ? `Everything here already has a ${effectiveClassifyField} — switch facet or close the panel.`
                      : "Pin a primary facet to start folding this collection."
                  }
                  zoom={state.gridZoom}
                />
              </div>
            </div>
          ) : state.viewMode === "table" ? (
            <div className="h-full p-5">
              <Table
                objects={visibleObjects}
                facetColumns={facetColumns}
                tagFrequency={tagFrequency}
                onOpen={state.openDetail}
                emptyLabel={emptyLabel}
                viewKey={viewKey}
                groupBy={state.groupBy}
              />
            </div>
          ) : (
            <div className="h-full overflow-y-auto px-5 pt-4 pb-5">
              {/* The collection's workspace header is CONTENT, not chrome —
                  it scrolls away with the grid (are.na channel-header move;
                  design-philosophy Principle 8 + N1). */}
              {view.kind === "collection" && currentCollection && (
                <CollectionLedger
                  collection={currentCollection}
                  heroObject={heroObject}
                  objects={baseObjects}
                  roles={state.roles}
                  roleFilter={state.roleFilter}
                  localUserTags={state.localUserTags}
                  piles={curatedPiles}
                />
              )}
              {view.kind !== "collection" && curatedPiles.length > 0 && (
                <div className="pb-5">
                  <PileChips piles={curatedPiles} />
                </div>
              )}
              <Grid
                objects={visibleObjects}
                facetColumns={facetColumns}
                tagFrequency={tagFrequency}
                viewKey={viewKey}
                onOpen={state.openDetail}
                emptyLabel={emptyLabel}
                zoom={state.gridZoom}
                groupBy={state.groupBy}
              />
            </div>
          )}
        </div>
      </main>

      <AnimatePresence>
      {classifyOpen && activeRole && (
        <ClassifyPanel
          roleObjects={roleObjects}
          collectionIds={collectionIds}
          allObjects={allObjectsList}
          activeRole={activeRole}
          fieldName={effectiveClassifyField ?? ""}
          reservoirCount={reservoirObjects.length}
          onFieldChange={setClassifyField}
          onClose={state.closeClassificationPanel}
          onOpen={state.openDetail}
        />
      )}
      </AnimatePresence>

      {/* Status toasts — floating, never a band that pushes content (N3).
          Success self-dismisses; errors and the backup warning persist. */}
      <div className="fixed bottom-4 right-4 z-40 flex flex-col items-end gap-2 max-w-sm">
        <AnimatePresence initial={false}>
        {restoreNotice && (
          <motion.div key="restore" layout custom={{ x: 0, y: 12 }} variants={surfaceVariants} initial="hidden" animate="visible" exit="exit" className="rounded-lg border border-emerald-200 bg-emerald-50 shadow-cardHover px-3.5 py-2.5 text-[12px] text-emerald-800 flex items-start justify-between gap-3">
            <span>Your data is back and ready to use!</span>
            <button
              onClick={() => setRestoreNotice(false)}
              className="text-emerald-800/60 hover:text-emerald-800 shrink-0"
              aria-label="Dismiss"
            >
              ×
            </button>
          </motion.div>
        )}
        {syncState.status === "error" && (
          <motion.div key="sync-error" layout custom={{ x: 0, y: 12 }} variants={surfaceVariants} initial="hidden" animate="visible" exit="exit" className="rounded-lg border border-red-200 bg-red-50 shadow-cardHover px-3.5 py-2.5 text-[12px] text-red-800 flex items-start justify-between gap-3">
            <span>{syncState.message}</span>
            <button
              onClick={() => setSyncState({ status: "idle" })}
              className="text-red-800/60 hover:text-red-800 shrink-0"
              aria-label="Dismiss"
            >
              ×
            </button>
          </motion.div>
        )}
        {syncState.status === "done" && (
          <motion.div key="sync-done" layout custom={{ x: 0, y: 12 }} variants={surfaceVariants} initial="hidden" animate="visible" exit="exit" className="rounded-lg border border-emerald-200 bg-emerald-50 shadow-cardHover px-3.5 py-2.5 text-[12px] text-emerald-800 flex items-start justify-between gap-3">
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
          </motion.div>
        )}
        {syncState.status === "done" && syncState.backupSuspect && (
          <motion.div key="backup-suspect" layout custom={{ x: 0, y: 12 }} variants={surfaceVariants} initial="hidden" animate="visible" exit="exit" className="rounded-lg border border-amber-200 bg-amber-50 shadow-cardHover px-3.5 py-2.5 text-[12px] text-amber-900">
            ⚠ This sync's backup was written as <code>-SUSPECT.json</code> instead of rotating in
            normally — it has 20%+ fewer objects than the last good backup. That can happen
            legitimately (e.g. right after deleting a lot locally), but it's also what a corrupted
            local store looks like — check the file before trusting it, and use an older backup to
            roll back if needed.
          </motion.div>
        )}
        </AnimatePresence>
      </div>

      {state.detailObjectId && (
        <DetailPanel
          objectId={state.detailObjectId}
          onClose={state.closeDetail}
          layout={state.detailViewMode}
          onLayoutChange={state.setDetailViewMode}
          contextObjects={baseObjects}
          onOpenCarousel={state.openCarousel}
          carouselOpen={!!state.carouselObjectId}
        />
      )}
      {state.carouselObjectId && (
        <DetailCarousel
          objects={visibleObjects}
          currentId={state.carouselObjectId}
          onClose={state.closeCarousel}
        />
      )}
      {modal?.kind === "smart" && (
        <SmartCollectionModal
          collectionId={modal.collectionId}
          parentId={modal.parentId}
          onClose={() => setModal(null)}
        />
      )}
      {modal?.kind === "manual" && (
        <ManualCollectionModal
          collectionId={modal.collectionId}
          parentId={modal.parentId}
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
