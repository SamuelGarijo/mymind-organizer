import { useEffect, useMemo, useRef, useState } from "react";
import { AnimatePresence, motion } from "motion/react";
import { useShallow } from "zustand/react/shallow";
import { allObjectsOf, getVisibleObjects, useStore, type VisibilityState } from "./store";
import { useDebouncedValue } from "./lib/useDebouncedValue";
import { Sidebar } from "./components/Sidebar";
import { Grid } from "./components/Grid";
import { Table } from "./components/Table";
import { DetailPanel } from "./components/DetailPanel";
import { DetailCarousel } from "./components/DetailCarousel";
import { applyTheme, THEME_LABELS, watchSystemTheme } from "./lib/theme";
import { AddSomethingModal } from "./components/AddSomethingModal";
import { SelectionBar } from "./components/SelectionBar";
import { SmartCollectionModal } from "./components/SmartCollectionModal";
import { ManualCollectionModal } from "./components/ManualCollectionModal";
import { TopBar } from "./components/TopBar";
import { CollectionLedger } from "./components/CollectionLedger";
import { ClassifyPanel, StackedClassifyPanel } from "./components/ClassifyPanel";
import { Workbench } from "./components/Workbench";
import { Membrane } from "./components/Membrane";
import { MembraneTabs } from "./components/MembraneTabs";
import { CanvasView } from "./components/CanvasView";
import { DiscoveryStrip } from "./components/DiscoveryStrip";
import { WritingWorkspace } from "./components/WritingWorkspace";
import { ArrowLeft, X as XIcon } from "@phosphor-icons/react";
import { ArenaExportModal } from "./components/ArenaExportModal";
import { fetchArenaAccount, type ArenaAccount } from "./lib/arenaExport";
import { DRAG_MIME, readDraggedIds } from "./lib/objectDrag";
import { distinctRoleKeys, resolveActiveRole } from "./lib/primaryFacets";
import { realKindKeys } from "./lib/kinds";
import { resolveCollectionFields } from "./lib/fieldCatalog";
import {
  applyExcludedTags,
  applyFacetFieldFilter,
  applyFacetTags,
  applyRoleFilter,
  applyTypeFilter,
  computeObjectTypes,
  computeRoleFrequency,
  computeTopTags,
} from "./lib/quickFilter";
import { applyColorFilter } from "./lib/colorSearch";
import { buildSearchIndex, searchObjects } from "./lib/search";
import { useThrottledDerived } from "./lib/useThrottledDerived";
import { describeMymindError, fetchAllMymindIds, syncFull, syncIncremental } from "./lib/mymindSync";
import { getStoredBackupHandle, writeBackup } from "./lib/autoBackup";
import { parseBackup } from "./lib/backupValidation";
import { norm } from "./lib/ruleEngine";
import { surfaceVariants } from "./lib/chrome";
import { computeTagFrequency } from "./lib/tagDistinctiveness";
import { CredentialsModal } from "./components/CredentialsModal";
import { ConfirmDialog } from "./components/ConfirmDialog";
import { OrganizeView } from "./components/OrganizeView";
import { AddPropertyPopover } from "./components/AddPropertyPopover";
import { suggestRole } from "./lib/roleSuggestion";
import type { DesignObject, FacetField, RoleDefinition } from "./types";

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
      tagPromotions: s.tagPromotions,
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
      workbenchOpen: s.workbenchOpen,
      discoveryOpen: s.discoveryOpen,
      setDiscoveryOpen: s.setDiscoveryOpen,
      openCanvasId: s.openCanvasId,
      openWritingTarget: s.openWritingTarget,
      canvasSplitWidth: s.canvasSplitWidth,
      setCanvasSplitWidth: s.setCanvasSplitWidth,
      workbenchCount: s.workbenchIds.length,
      setWorkbenchOpen: s.setWorkbenchOpen,
      setOrganizeBy: s.setOrganizeBy,
      objectRelations: s.objectRelations,
      viewBackStack: s.viewBackStack,
      flashNotice: s.flashNotice,
      setFlashNotice: s.setFlashNotice,
      popViewSnapshot: s.popViewSnapshot,
      dismissViewBackStack: s.dismissViewBackStack,
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
    [state.objects, state.collections, state.selectedView, state.tagGroups, state.objectRelations]
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

  // Fuse indexing (~8000 objects) is real work — rebuild immediately when
  // the FILTERS defining the pool change (results must be right), but a
  // content edit that merely refreshes the same pool's identity (a note
  // autosave, a description commit) rebuilds at most every 30s — that
  // rebuild-per-pause was part of the felt "app got slower" while writing.
  const searchIndex = useThrottledDerived(
    roleFiltered,
    buildSearchIndex,
    `${JSON.stringify(state.selectedView)}|${state.typeFilter}|${state.roleFilter}`
  );
  const searchFiltered = useMemo(() => {
    const results = searchObjects(searchIndex, debouncedSearchQuery, roleFiltered);
    // The throttled index holds object references from build time — remap
    // hits to the LIVE objects so a just-edited note never renders stale.
    // (Empty query short-circuits to the pool itself; nothing to remap.)
    return results === roleFiltered
      ? results
      : results.map((o) => state.objects[o.id] ?? o);
  }, [searchIndex, debouncedSearchQuery, roleFiltered, state.objects]);

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

  const topTags = useMemo(
    () => computeTopTags(topTagsSource, 30, state.tagPromotions),
    [topTagsSource, state.tagPromotions]
  );

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
    () => computeTagFrequency(allObjectsOf(state.objects)),
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
  // Only real kinds are eligible to be the active entity — junk tag-roles
  // (sign, facade, hungary) never get auto-picked for "All objects", which
  // is what produced "Classifying SIGN by Style" (Samuel, 2026-07-22).
  const realKinds = useMemo(
    () => realKindKeys(state.roles, state.collections),
    [state.roles, state.collections]
  );
  const activeRole = useMemo(
    () => resolveActiveRole(baseObjects, state.roles, state.roleFilter, realKinds),
    [baseObjects, state.roles, state.roleFilter, realKinds]
  );

  const [modal, setModal] = useState<Modal>(null);
  const [arenaExportId, setArenaExportId] = useState<string | null>(null);
  // The sacred space itself as a drop target (issue #132 follow-up): while
  // a collection is open, dropping an object anywhere on the content area
  // files it into THAT collection — no detour to the sidebar. Smart
  // collections explain instead of silently mutating their rule (N24).
  const [gridDropOver, setGridDropOver] = useState(false);
  // Canvas membrane width tracks the window so the left slit (the sacred
  // space strip you drag things from, follow-up #7) stays constant.
  const [winW, setWinW] = useState(() => window.innerWidth);
  useEffect(() => {
    const onResize = () => setWinW(window.innerWidth);
    window.addEventListener("resize", onResize);
    return () => window.removeEventListener("resize", onResize);
  }, []);
  const [arenaExportObjectId, setArenaExportObjectId] = useState<string | null>(null);
  const [fullResync, setFullResync] = useState(false);
  const [syncState, setSyncState] = useState<SyncStatus>({ status: "idle" });
  // "+ property" lives on the property strip (tabs row) — see below.
  const [addingProperty, setAddingProperty] = useState(false);
  // The app-voiced replacement for window.confirm — any component requests
  // one via the store; this is the single render site (see ConfirmDialog).
  const confirm = useStore((s) => s.pendingConfirm);
  const setConfirm = useStore((s) => s.requestConfirm);
  const [prefsOpen, setPrefsOpen] = useState(false);
  /** "+ ADD Something". `null` = closed; an array (possibly empty) = open,
   * holding whatever was dropped on the window. */
  const [addFiles, setAddFiles] = useState<File[] | null>(null);
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
  // Interaction notices (e.g. a rejected drop's explanation) fade on their
  // own — feedback, not a dialog.
  useEffect(() => {
    if (!state.flashNotice) return;
    const t = setTimeout(() => state.setFlashNotice(null), 5000);
    return () => clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [state.flashNotice]);

  const [credentialsModal, setCredentialsModal] = useState<{ dismissible: boolean } | null>(null);
  const [restoreNotice, setRestoreNotice] = useState(false);
  const restoreInputRef = useRef<HTMLInputElement>(null);
  const autoSyncedOnMount = useRef(false);
  const [arenaConfigured, setArenaConfigured] = useState(false);
  // Mirrored into the store (not local state) so the classifier's two
  // touchpoints can announce themselves as needing a key rather than
  // vanishing — an invisible feature is an undiscoverable one.
  const sidebarPinned = useStore((s) => !s.sidebarCollapsed);
  const geminiConfigured = useStore((s) => s.geminiConfigured);
  const setGeminiConfigured = useStore((s) => s.setGeminiConfigured);
  const [geminiKeyDraft, setGeminiKeyDraft] = useState("");
  const [geminiSaving, setGeminiSaving] = useState(false);
  const [geminiError, setGeminiError] = useState<string | null>(null);
  const [arenaAccount, setArenaAccount] = useState<ArenaAccount | null>(null);
  const [arenaTokenDraft, setArenaTokenDraft] = useState("");
  const [arenaSaving, setArenaSaving] = useState(false);
  const [arenaError, setArenaError] = useState<string | null>(null);

  // First run: no MYMIND_KID/MYMIND_SECRET in .env yet means every mymind
  // call would just fail one by one with a confusing error — ask for the
  // key up front instead. A fetch failure here (proxy not running yet)
  // is left alone; that already surfaces via the normal sync error banner.
  // Same call also seeds the Are.na connected-state indicator below.
  useEffect(() => {
    fetch("/api/health")
      .then((r) => r.json())
      .then((data: { credentialsConfigured: boolean; arenaConfigured: boolean; geminiConfigured?: boolean }) => {
        setGeminiConfigured(Boolean(data.geminiConfigured));
        if (!data.credentialsConfigured) setCredentialsModal({ dismissible: false });
        setArenaConfigured(data.arenaConfigured);
        if (data.arenaConfigured) fetchArenaAccount().then(setArenaAccount);
      })
      .catch(() => {});
  }, []);

  async function saveArenaToken() {
    const token = arenaTokenDraft.trim();
    if (!token) return;
    setArenaSaving(true);
    setArenaError(null);
    try {
      const res = await fetch("/api/setup/arena-token", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ token }),
      });
      if (!res.ok) {
        const body = await res.json().catch(() => null);
        throw new Error(body?.detail || `Server responded ${res.status}`);
      }
      setArenaTokenDraft("");
      setArenaConfigured(true);
      fetchArenaAccount().then(setArenaAccount);
    } catch (err) {
      setArenaError((err as Error).message);
    } finally {
      setArenaSaving(false);
    }
  }

  async function disconnectArena() {
    try {
      await fetch("/api/setup/arena-disconnect", { method: "POST" });
    } finally {
      setArenaConfigured(false);
      setArenaAccount(null);
    }
  }

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

  // Keeps the document in step with the choice, and — only while the choice
  // is "system" — with the OS flipping at sunset. An explicit light or dark
  // must never be overridden by the clock.
  const theme = useStore((s) => s.theme);
  useEffect(() => {
    applyTheme(theme);
    return watchSystemTheme(theme, () => applyTheme(theme));
  }, [theme]);

  // Esc drops a selection. Selecting is the only gesture in the app that
  // leaves state behind with no visible way out other than clicking empty
  // space, and clearing it is harmless — nothing to undo.
  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (e.key !== "Escape") return;
      if (useStore.getState().selectedObjectIds.size === 0) return;
      useStore.getState().setSelection(new Set(), null);
    }
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, []);

  // Dropping files from the desktop anywhere in the window opens the door
  // holding them (Samuel, 2026-07-21). Guarded on the "Files" dataTransfer
  // type so it never fires for the app's OWN drags — cards onto folders,
  // values, piles and channels all carry DRAG_MIME and no files, and
  // hijacking those would break every existing gesture at once.
  useEffect(() => {
    function carriesFiles(e: DragEvent) {
      return Array.from(e.dataTransfer?.types ?? []).includes("Files");
    }
    function onDragOver(e: DragEvent) {
      if (!carriesFiles(e)) return;
      // Without this the browser navigates away to the dropped file, which
      // is a spectacular way to lose an unsaved session.
      e.preventDefault();
    }
    function onDrop(e: DragEvent) {
      if (!carriesFiles(e)) return;
      e.preventDefault();
      const files = Array.from(e.dataTransfer?.files ?? []);
      if (files.length > 0) setAddFiles(files);
    }
    window.addEventListener("dragover", onDragOver);
    window.addEventListener("drop", onDrop);
    return () => {
      window.removeEventListener("dragover", onDragOver);
      window.removeEventListener("drop", onDrop);
    };
  }, []);

  // ⌘J toggles the Workbench — the bench and the classify panel share the
  // right edge, so opening one closes the other (one compartment at a
  // time; no duplicated right-side systems).
  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "j") {
        e.preventDefault();
        const st = useStore.getState();
        // ⌘J closes whichever tenant currently holds the compartment —
        // Classify included, since the tab row advertises "Close (⌘J)".
        // Without the classify branch the shortcut opened the bench
        // *behind* an open Classify and read as doing nothing.
        if (st.openCanvasId) {
          st.openCanvas(null);
        } else if (st.classificationPanelOpen) {
          st.closeClassificationPanel();
        } else if (st.workbenchOpen) {
          st.setWorkbenchOpen(false);
        } else {
          st.closeClassificationPanel();
          st.setWorkbenchOpen(true);
        }
      }
    }
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, []);

  // ⌘Z / ⇧⌘Z over the archive itself (Samuel, 2026-07-21). Never while a
  // text field has focus — there the browser's own undo is the right one,
  // and stealing it would be worse than not having this at all.
  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (!(e.metaKey || e.ctrlKey) || e.key.toLowerCase() !== "z") return;
      const target = e.target as HTMLElement | null;
      if (target?.closest("input, textarea, [contenteditable='true']")) return;
      e.preventDefault();
      const st = useStore.getState();
      if (e.shiftKey) st.redo();
      else st.undo();
    }
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, []);

  const view = state.selectedView;
  // Channel-style framing for the current collection, if any (issue #87) —
  // description/hero image are collection metadata, not tied to smart vs.
  // manual, so this reads the same way for either type.
  const currentCollection =
    view.kind === "collection" ? state.collections[view.collectionId] : undefined;
  const heroObject = currentCollection?.heroImageObjectId
    ? state.objects[currentCollection.heroImageObjectId]
    : undefined;

  // The entity nav (§3, 2026-07-22): the kinds this collection holds, real
  // ones only (junk tag-roles filtered via realKinds), plus any the
  // collection DECLARES but hasn't classified into yet (shown at 0, so a
  // fresh collection announces what it's about). Counts scoped to members.
  const entityKinds = useMemo(() => {
    const counts = new Map<string, { name: string; count: number }>();
    for (const key of currentCollection?.entityTypes ?? []) {
      const k = norm(key);
      if (!counts.has(k)) counts.set(k, { name: state.roles[k]?.name ?? key, count: 0 });
    }
    for (const o of baseObjects) {
      if (!o.role) continue;
      const k = norm(o.role);
      if (!realKinds.has(k)) continue;
      const e = counts.get(k) ?? { name: state.roles[k]?.name ?? o.role, count: 0 };
      e.count++;
      counts.set(k, e);
    }
    return Array.from(counts.values()).sort((a, b) => b.count - a.count);
  }, [baseObjects, realKinds, state.roles, currentCollection]);

  // "All objects" in a MULTI-kind collection: the real kinds actually
  // present, each classified on its own (StackedClassifyPanel), never one
  // kind's taxonomy forced across everything (Samuel, 2026-07-22). Only
  // populated when NO single entity is active (activeRole undefined) — with
  // one kind resolveActiveRole picks it, so this stays empty.
  const stackedKinds = useMemo(() => {
    if (!currentCollection || activeRole) return [] as RoleDefinition[];
    const present = new Map<string, RoleDefinition>();
    for (const o of baseObjects) {
      if (!o.role) continue;
      const k = norm(o.role);
      if (!realKinds.has(k)) continue;
      const def = state.roles[k];
      if (def && !present.has(k)) present.set(k, def);
    }
    return Array.from(present.values());
  }, [currentCollection, activeRole, baseObjects, realKinds, state.roles]);

  // --- Classify derivations -----------------------------------------------
  // ONE space, not two (Samuel, 2026-07-21): Classify is a drawer that
  // opens beside whatever you are already looking at — never a different
  // view. So it coexists with the "Organize by" landing page, and when
  // that page is active the drawer classifies by THAT property: reading a
  // collection by Font Style and reaching its unclassified chapter, the
  // thing you want open beside you is the Font Style drawers (Serif,
  // Sans…), ready to receive what you drag out of the pile.
  const organizeBy = useStore((s) => s.organizeBy);
  const primaryFacetNames = activeRole?.primaryFacets ?? [];
  // §9: the "Organize by" lens — which properties this collection can be
  // read by (the active entity type's select/multi-select fields). The By-X
  // sub-row AND the Classify drawer's field tabs derive from this one list,
  // so they never disagree about what a collection shows. It respects the
  // collection's own field VIEW, not the role's full set — hiding a property
  // in a collection hides its lens too (resolveCollectionFields, §3). Outside
  // a collection, all role fields.
  const organizeFields = useMemo(() => {
    if (!activeRole) return [];
    const shown = currentCollection
      ? resolveCollectionFields(currentCollection, activeRole)
      : activeRole.fields;
    return shown.filter((f) => f.type === "select" || f.type === "multi-select");
  }, [activeRole, currentCollection]);
  // Classify tabs = the collection's shown classifiable fields; outside a
  // collection, the role's pinned facets (unchanged behaviour).
  const classifiableFieldNames = currentCollection
    ? organizeFields.map((f) => f.name)
    : primaryFacetNames;
  const organizeDrivenField =
    organizeBy && activeRole?.fields.some((f) => norm(f.name) === norm(organizeBy))
      ? organizeBy
      : null;
  const effectiveClassifyField =
    organizeDrivenField ??
    (classifyField && classifiableFieldNames.some((n) => norm(n) === norm(classifyField))
      ? classifyField
      : classifiableFieldNames[0] ?? null);
  const classifyOpen = state.classificationPanelOpen && !!activeRole;
  // The multi-kind "All objects" case: same open flag, but no single role —
  // the drawer stacks a block per kind instead (StackedClassifyPanel).
  const stackedClassifyOpen =
    state.classificationPanelOpen && !activeRole && stackedKinds.length > 1;
  const anyClassifyOpen = classifyOpen || stackedClassifyOpen;
  // While a category is explicitly selected in the panel (§1, 2026-07-21),
  // the grid shows THAT subset — visibleObjects already carries the
  // facetFieldFilter, so the reservoir's own "no value yet" narrowing must
  // step aside or the two would intersect to nothing. The reservoir view is
  // the DEFAULT (nothing selected), not a mode the user is locked into.
  const classifyValueSelected =
    classifyOpen && state.facetFieldFilter?.field === effectiveClassifyField;
  const reservoirObjects = useMemo(() => {
    if (!classifyOpen || !activeRole || !effectiveClassifyField) return [];
    return visibleObjects.filter((o) => {
      if (!o.role || norm(o.role) !== norm(activeRole.name)) return false;
      if (classifyValueSelected) return true;
      const raw = o.fields[effectiveClassifyField];
      const values = Array.isArray(raw) ? raw : raw ? [raw] : [];
      return values.length === 0;
    });
  }, [classifyOpen, activeRole, effectiveClassifyField, visibleObjects, classifyValueSelected]);
  const roleObjects = useMemo(() => {
    if (!activeRole) return [];
    return baseObjects.filter((o) => o.role && norm(o.role) === norm(activeRole.name));
  }, [baseObjects, activeRole]);
  // Search/filters still compose: the editorial page organizes whatever the
  // query has narrowed to. (organizeFields is defined up with the classify
  // derivations, since the drawer tabs share it.)
  const organizeField = organizeBy
    ? organizeFields.find((f) => norm(f.name) === norm(organizeBy)) ?? null
    : null;
  const organizeObjects = useMemo(() => {
    if (!activeRole || !organizeField) return [];
    return visibleObjects.filter((o) => o.role && norm(o.role) === norm(activeRole.name));
  }, [visibleObjects, activeRole, organizeField]);
  const collectionIds = useMemo(() => new Set(baseObjects.map((o) => o.id)), [baseObjects]);
  // Shared store-level list (same identity across App/DetailPanel/
  // Workbench/WritingWorkspace) — the similarity corpus cache keys on it.
  const allObjectsList = allObjectsOf(state.objects);

  // The folders panel is the collection's own architecture, so entering a
  // world that's already set up opens it by default (Samuel's call) — and
  // leaving, or entering one with nothing pinned yet, closes it. Closing it
  // by hand (✦ / ×) sticks until the next view change; this only fires on
  // viewKey transitions, deliberately reading the freshly-computed
  // primaryFacetNames of the view just entered.
  useEffect(() => {
    if (
      view.kind === "collection" &&
      (primaryFacetNames.length > 0 || stackedKinds.length > 1) &&
      !useStore.getState().workbenchOpen
    ) {
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
      state.setFlashNotice("Nothing to assign — everything has a type or matches no rule.");
      return;
    }
    const summary = Array.from(counts.entries())
      .sort((a, b) => b[1] - a[1])
      .map(([role, count]) => `${role}: ${count}`)
      .join("\n");
    // The one bulk action big enough to still warrant a pause — but in the
    // app's own voice, never window.confirm (Samuel, 2026-07-20).
    setConfirm({
      title: `Assign an entity type to ${assignments.length.toLocaleString()} objects?`,
      body: summary,
      action: "Assign",
      onConfirm: () => useStore.getState().bulkAssignRoles(assignments),
    });
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
    // Workspace setup is a DEFAULT, not a dialog: assign, announce via
    // flash notice, open the panel. Every assignment stays editable from
    // any item's detail panel — that reversibility is the real safety, not
    // a confirm popup (Samuel, 2026-07-20).
    const ids = baseObjects.map((o) => o.id);
    useStore.getState().setupWorkspaceFor(ids);
    if (distinctRoleKeys(
      ids
        .map((id) => useStore.getState().objects[id])
        .filter((o): o is DesignObject => Boolean(o))
    ).size === 0) {
      // Nothing to classify — leave the bench exactly as it was. Closing it
      // speculatively before this check emptied the membrane of BOTH
      // tenants and left the compartment showing nothing.
      state.setFlashNotice(
        "Couldn't suggest a type for anything here — assign one from an item's detail panel, then try again."
      );
      return;
    }
    // Only now does classify actually take the compartment. The "Organize
    // by" lens is deliberately left alone: reading a collection by a
    // property and opening its drawers is ONE gesture in one space, not
    // two competing views (Samuel, 2026-07-21).
    state.setWorkbenchOpen(false);
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
        state.setFlashNotice("Couldn't read that backup file: " + (err as Error).message);
        return;
      }

      const currentCount = Object.keys(state.objects).length;
      const objectCount = parsed.objects.length;
      const collectionCount = parsed.collections.length;
      setConfirm({
        title: "Restore this backup?",
        body:
          `${objectCount.toLocaleString()} object${objectCount === 1 ? "" : "s"}, ${collectionCount} collection${collectionCount === 1 ? "" : "s"}.` +
          (currentCount > 0
            ? `\nReplaces everything currently here (${currentCount.toLocaleString()} items) — can't be undone. mymind itself is never touched.`
            : ""),
        action: "Restore",
        onConfirm: () => {
          try {
            useStore.getState().restoreFromBackup(text);
          } catch (err) {
            useStore.getState().setFlashNotice("Couldn't restore that backup: " + (err as Error).message);
            return;
          }
          // A reload (rather than trusting every mounted component to
          // notice the store swap) is what actually fixed the "collections
          // don't show up" symptom this was built for — simplest guarantee
          // that every view re-reads the restored store from scratch.
          sessionStorage.setItem(RESTORE_NOTICE_KEY, "1");
          window.location.reload();
        },
      });
    });
  }

  // The preferences trigger + popover (issue #128) — state/handlers all
  // stay right here (sync/backup/credentials are already owned by this
  // component), handed to Sidebar as CONTENT ONLY — Sidebar renders it as
  // an inline expanding section inside itself (never a floating popover:
  // the old element-in-two-places approach rendered the same popover from
  // both the capsule and the overlay at once — the double-popup bug).
  const prefsBody = (
    <div className="text-[12px]">
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
            Entity types
          </div>
          <button
            onClick={() => {
              handleAutoAssignRoles();
              setPrefsOpen(false);
            }}
            className="w-full text-left px-2.5 py-1.5 rounded-lg border border-line hover:bg-line/40 mb-1.5"
            title="Suggests an entity type for every object that doesn't have one yet, from its mymind type and tags — shows the impact before applying anything"
          >
            Auto-assign entity types
          </button>

          <div className="text-[11px] uppercase tracking-wide text-muted mt-3 mb-1.5">
            Appearance
          </div>
          <div className="flex gap-1">
            {(["light", "dark", "system"] as const).map((choice) => (
              <button
                key={choice}
                onClick={() => useStore.getState().setTheme(choice)}
                className={[
                  "flex-1 px-2.5 py-1.5 rounded border font-mono text-[12px] transition-colors",
                  theme === choice
                    ? "border-accent/50 bg-accent/5 text-ink"
                    : "border-line text-muted hover:text-ink hover:bg-line/40",
                ].join(" ")}
                title={
                  choice === "system"
                    ? "Follows your operating system, including when it changes at sunset"
                    : `Always ${choice}`
                }
              >
                {THEME_LABELS[choice]}
              </button>
            ))}
          </div>

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

          <div className="text-[11px] uppercase tracking-wide text-muted mt-3 mb-1.5">Are.na</div>
          {arenaConfigured ? (
            <div className="text-[11px] text-ok bg-ok/10 border border-ok/30 rounded px-2.5 py-1.5 mb-1.5 flex items-center justify-between gap-2">
              <span className="truncate">
                Connected
                {arenaAccount ? (
                  <>
                    {" as "}
                    <span className="font-bold">@{arenaAccount.slug}</span>
                  </>
                ) : (
                  ""
                )}
              </span>
              <button
                onClick={disconnectArena}
                className="shrink-0 text-ok/70 hover:text-ok underline decoration-dotted"
                title="Remove the Are.na token from this machine"
              >
                disconnect
              </button>
            </div>
          ) : (
            <p className="text-[11px] text-muted mb-1.5">
              Create a personal access token at are.na/settings/personal-access-tokens (with{" "}
              <code>write</code> scope) to export collections as channels from any collection's ⋯
              menu.
            </p>
          )}
          <div className="flex gap-1">
            <input
              value={arenaTokenDraft}
              onChange={(e) => setArenaTokenDraft(e.target.value)}
              onKeyDown={(e) => e.key === "Enter" && saveArenaToken()}
              placeholder="Personal access token"
              type="password"
              className="flex-1 min-w-0 rounded border border-line px-2.5 py-1.5 text-[12px] outline-none focus:border-accent"
            />
            <button
              onClick={saveArenaToken}
              disabled={!arenaTokenDraft.trim() || arenaSaving}
              className="shrink-0 px-2.5 py-1.5 rounded border border-line hover:bg-line/40 disabled:opacity-40"
            >
              {arenaSaving ? "…" : "Save"}
            </button>
          </div>
          {arenaError && <p className="text-[11px] text-danger mt-1">{arenaError}</p>}

          <div className="text-[11px] uppercase tracking-wide text-muted mt-3 mb-1.5">
            Classifier
          </div>
          {geminiConfigured ? (
            <div className="text-[11px] text-ok bg-ok/10 border border-ok/30 rounded px-2.5 py-1.5 mb-1.5 flex items-center justify-between gap-2">
              <span className="truncate">Gemini key saved</span>
              <button
                onClick={async () => {
                  await fetch("/api/setup/gemini-disconnect", { method: "POST" });
                  setGeminiConfigured(false);
                }}
                className="shrink-0 text-ok/70 hover:text-ok underline decoration-dotted"
                title="Remove the Gemini key from this machine"
              >
                disconnect
              </button>
            </div>
          ) : (
            <p className="text-[11px] text-muted mb-1.5">
              Your own Gemini key, for the judgements counting can't make. It never runs on its
              own — only from the two ✦ offers below. Separate from mymind entirely; the key
              stays on this machine.
            </p>
          )}
          <div className="flex gap-1">
            <input
              value={geminiKeyDraft}
              onChange={(e) => setGeminiKeyDraft(e.target.value)}
              placeholder="Gemini API key"
              type="password"
              className="flex-1 min-w-0 rounded border border-line px-2.5 py-1.5 text-[12px] outline-none focus:border-accent"
            />
            <button
              onClick={async () => {
                const key = geminiKeyDraft.trim();
                if (!key) return;
                setGeminiSaving(true);
                setGeminiError(null);
                try {
                  const res = await fetch("/api/setup/gemini-key", {
                    method: "POST",
                    headers: { "Content-Type": "application/json" },
                    body: JSON.stringify({ key }),
                  });
                  if (!res.ok) throw new Error("Could not save the key.");
                  setGeminiConfigured(true);
                  setGeminiKeyDraft("");
                } catch (err) {
                  setGeminiError((err as Error).message);
                } finally {
                  setGeminiSaving(false);
                }
              }}
              disabled={!geminiKeyDraft.trim() || geminiSaving}
              className="shrink-0 px-2.5 py-1.5 rounded border border-line hover:bg-line/40 disabled:opacity-40"
            >
              {geminiSaving ? "…" : "Save"}
            </button>
          </div>
          {geminiError && <p className="text-[11px] text-danger mt-1">{geminiError}</p>}
          {/* Where, in plain words. The feature was invisible not because it
              was hidden but because nothing ever said it existed. */}
          <ul className="text-[11px] text-muted mt-2 space-y-1.5">
            <li>
              <span className="text-ink">✦ ask what else is worth knowing</span> — when you
              create or edit a collection and call it a kind of thing. One request per
              collection. Reads only the words your items already carry and answers with
              properties worth having. It cannot invent vocabulary.
            </li>
            <li>
              <span className="text-ink">✦ ask about N</span> — hover a property column in a
              collection. Looks at the items nothing could work out for itself, one by one, and
              picks from that property's own categories. Costs a request per 25 items, capped at
              100 per round. Confident answers apply, the rest wait for you; ⌘Z undoes the lot.
            </li>
          </ul>
    </div>
  );

  return (
    <div className="h-screen w-screen flex overflow-hidden">
      <Sidebar
        onNewSmart={(parentId) => setModal({ kind: "smart", parentId })}
        onNewManual={(parentId) => setModal({ kind: "manual", parentId })}
        onEditSmart={(collectionId) => setModal({ kind: "smart", collectionId })}
        onEditManual={(collectionId) => setModal({ kind: "manual", collectionId })}
        onExportArena={(collectionId) => setArenaExportId(collectionId)}
        onAddSomething={() => setAddFiles([])}
        prefsOpen={prefsOpen}
        onTogglePrefs={() => setPrefsOpen((v) => !v)}
        prefsBody={prefsBody}
      />

      <main className="flex-1 flex flex-col min-w-0 relative">
        {/* The single resident band (design-philosophy N1) — and it recedes
            entirely in writing mode: search is the archive's instrument,
            not the page's, and a floating bar over the text competes with
            the sentence you're writing (Samuel, 2026-07-20). */}
        {!state.openWritingTarget && (
        <TopBar
          topTags={topTags}
          objectTypes={objectTypes}
          roleTypes={roleTypes}
          facetColumns={facetColumns}
          fieldFilterPool={excludeFiltered}
          colorFilter={state.colorFilter}
          setColorFilter={state.setColorFilter}
        />
        )}

        <div
          className="flex-1 overflow-hidden relative"
          onDragOver={(e) => {
            if (view.kind !== "collection" || !currentCollection) return;
            if (!e.dataTransfer.types.includes(DRAG_MIME)) return;
            e.preventDefault();
            setGridDropOver(true);
          }}
          onDragLeave={(e) => {
            if (!(e.currentTarget as HTMLElement).contains(e.relatedTarget as Node)) {
              setGridDropOver(false);
            }
          }}
          onDrop={(e) => {
            setGridDropOver(false);
            if (view.kind !== "collection" || !currentCollection) return;
            const ids = readDraggedIds(e);
            if (ids.length === 0) return;
            e.preventDefault();
            const st = useStore.getState();
            if (currentCollection.type === "manual") {
              for (const id of ids) st.assignToManualCollection(id, currentCollection.id);
              st.setFlashNotice(
                `Added ${ids.length} item${ids.length === 1 ? "" : "s"} to "${currentCollection.name}"`
              );
            } else {
              st.setFlashNotice(
                `"${currentCollection.name}" fills itself by rule — edit its rule (⋯ → Edit), or drop into a manual collection.`
              );
            }
          }}
        >
          {gridDropOver && currentCollection && (
            <div
              className={[
                "absolute inset-2 z-10 pointer-events-none rounded ring-2 ring-inset",
                currentCollection.type === "manual" ? "ring-accent/50" : "ring-amber-400/70",
              ].join(" ")}
            />
          )}
          {state.openWritingTarget ? (
            <WritingWorkspace />
          ) : state.viewMode === "table" ? (
            <div className="h-full p-5 pt-16">
              {/* Classify narrows the table exactly as it narrows the grid.
                  Before the two render paths merged, classify preempted
                  table view entirely; keeping the reservoir here is what
                  makes the compartment mean the same thing in both. */}
              <Table
                objects={classifyOpen ? reservoirObjects : visibleObjects}
                facetColumns={facetColumns}
                tagFrequency={tagFrequency}
                onOpen={state.openDetail}
                emptyLabel={
                  classifyOpen && effectiveClassifyField
                    ? `Everything here already has a ${effectiveClassifyField} — switch property or close the panel.`
                    : emptyLabel
                }
                viewKey={
                  classifyOpen ? `${viewKey}:classify:${effectiveClassifyField ?? ""}` : viewKey
                }
                groupBy={state.groupBy}
              />
            </div>
          ) : (
            <div className="h-full overflow-y-auto px-5 pt-16 pb-5" data-content-scroll>
              {/* §9 (2026-07-21) + property strip (same day's follow-up):
                  ONE row answers both "how can I read this collection?"
                  (All objects / By <property> tabs) and "what properties
                  does it already have?" — the tabs ARE the property list,
                  and "+ property" sits at the strip's far right, Notion-
                  fashion but in this app's quiet register. Content, not
                  chrome — it scrolls away with the page. */}
              {view.kind === "collection" && (
                <div className="pb-4 font-mono text-[11px]">
                  {/* Entity nav — the kinds this collection is about, real
                      ones only. "All objects" is a first-class answer, not a
                      forced entity. Clicking a kind narrows to it and reveals
                      its field sub-row below (§3, 2026-07-22). */}
                  <div className="flex items-center gap-3 flex-wrap">
                    <button
                      onClick={() => setRoleFilter("")}
                      className={
                        state.roleFilter === ""
                          ? "text-ink underline decoration-dotted underline-offset-4"
                          : "text-muted hover:text-ink"
                      }
                    >
                      All objects <span className="opacity-50">{baseObjects.length}</span>
                    </button>
                    {entityKinds.map((k) => {
                      const active =
                        state.roleFilter !== "" && norm(state.roleFilter) === norm(k.name);
                      return (
                        <button
                          key={k.name}
                          onClick={() => setRoleFilter(active ? "" : k.name)}
                          className={
                            active
                              ? "text-ink underline decoration-dotted underline-offset-4"
                              : "text-muted hover:text-ink"
                          }
                        >
                          {k.name.toLowerCase()} <span className="opacity-50">{k.count}</span>
                        </button>
                      );
                    })}
                  </div>

                  {/* Field sub-row — ONLY with a single entity active. The
                      By-X lenses, then "+ Property" after a separator
                      (Samuel, 2026-07-22: it moves out of the top-right into
                      this row). Never shown across a multi-object "All
                      objects" — that's the no-forced-grouping rule. */}
                  {activeRole && (
                    <div className="mt-2 flex items-center gap-3">
                      {organizeFields.map((f) => (
                        <button
                          key={f.name}
                          onClick={() =>
                            state.setOrganizeBy(organizeField?.name === f.name ? null : f.name)
                          }
                          className={
                            organizeField?.name === f.name
                              ? "text-ink underline decoration-dotted underline-offset-4"
                              : "text-muted hover:text-ink"
                          }
                          title={`Read ${activeRole.name} by ${f.name} — one chapter per value`}
                        >
                          By {f.name}
                        </button>
                      ))}
                      {organizeFields.length > 0 && <span className="text-line/70">|</span>}
                      <div className="relative">
                        <button
                          onClick={() => setAddingProperty((v) => !v)}
                          className={
                            addingProperty ? "text-ink" : "text-accent/85 hover:text-accent"
                          }
                          title={`Add a property to ${activeRole.name}`}
                        >
                          + Property
                        </button>
                        {addingProperty && (
                          <div className="absolute left-0 top-6 z-[60] w-[340px]">
                            <AddPropertyPopover
                              roleName={activeRole.name}
                              objects={roleObjects}
                              onClose={() => setAddingProperty(false)}
                            />
                          </div>
                        )}
                      </div>
                    </div>
                  )}
                </div>
              )}
              {organizeField && activeRole ? (
                <>
                  {/* The organized page carries its own navigation — the
                      property strip above plus "Here you can find" here —
                      so the editorial read is self-contained and stays
                      legible as something publishable, not a view that
                      only makes sense inside the app's chrome. Property
                      columns are suppressed: this page IS one property. */}
                  {view.kind === "collection" && currentCollection && (
                    <CollectionLedger
                      collection={currentCollection}
                      heroObject={heroObject}
                      objects={baseObjects}
                      roles={state.roles}
                      roleFilter={state.roleFilter}
                      localUserTags={state.localUserTags}
                      showProperties={false}
                    />
                  )}
                  <OrganizeView
                    objects={organizeObjects}
                    field={organizeField}
                    roleName={activeRole.name}
                    tagFrequency={tagFrequency}
                    onOpen={state.openDetail}
                    zoom={state.gridZoom}
                  />
                </>
              ) : (
                <>
                  {/* The collection's workspace header is CONTENT, not
                      chrome — it scrolls away with the grid (are.na
                      channel-header move; Principle 8 + N1). */}
                  {view.kind === "collection" && currentCollection && (
                    <CollectionLedger
                      collection={currentCollection}
                      heroObject={heroObject}
                      objects={baseObjects}
                      roles={state.roles}
                      roleFilter={state.roleFilter}
                      localUserTags={state.localUserTags}
                      suppressField={classifyOpen && !organizeField ? effectiveClassifyField : null}
                    />
                  )}
                  <Grid
                    // Only the plain grid becomes the reservoir. On the
                    // organized page the unclassified pile is already a
                    // chapter of its own, so opening the drawer must leave
                    // the page exactly as it was.
                    objects={classifyOpen && !organizeField ? reservoirObjects : visibleObjects}
                    facetColumns={facetColumns}
                    tagFrequency={tagFrequency}
                    viewKey={
                      classifyOpen && !organizeField
                        ? `${viewKey}:classify:${effectiveClassifyField ?? ""}`
                        : viewKey
                    }
                    onOpen={state.openDetail}
                    emptyLabel={
                      classifyOpen && !organizeField && effectiveClassifyField
                        ? `Everything here already has a ${effectiveClassifyField} — switch property or close the panel.`
                        : emptyLabel
                    }
                    zoom={state.gridZoom}
                    groupBy={state.groupBy}
                    minColumnWidth={state.openCanvasId ? 170 : undefined}
                    hideTags={!!state.openCanvasId}
                  />
                </>
              )}
            </div>
          )}
        </div>

        {/* Bottom membrane — Discovery (issue #134): explores BENEATH the
            current collection instead of navigating away. Foundation
            tenant: internal similar-outside; external sources come later. */}
        {view.kind === "collection" && (
          <Membrane
            edge="bottom"
            open={state.discoveryOpen}
            onToggle={() => state.setDiscoveryOpen(!state.discoveryOpen)}
            size={224}
            seamLabel="Discover — expand this collection's research outward"
            seamHint="discover"
            id="discovery-membrane"
          >
            {state.discoveryOpen && currentCollection && (
              <DiscoveryStrip
                collectionId={currentCollection.id}
                collectionName={currentCollection.name}
                members={baseObjects}
                memberIds={collectionIds}
                allObjects={allObjectsList}
                onOpen={state.openDetail}
              />
            )}
          </Membrane>
        )}
      </main>

      {/* Right membrane — the Workbench compartment (issue #134), which
          EVOLVES into the infinite canvas (#133 follow-up #7): a canvas is
          the bench expanded, opening right-to-left over the workspace
          while a slit of the sacred space stays visible on the left as
          the place to drag things from. Never a takeover of the archive
          view. */}
      {/* One compartment, three tenants (canvas > classify > workbench):
          Classify shares the same membrane as the Workbench (§6,
          2026-07-21) — same inward opening, same inner shadow, same
          yielding of space. One spatial language, never a floating panel
          over the work. */}
      <Membrane
        edge="right"
        open={state.workbenchOpen || !!state.openCanvasId || anyClassifyOpen}
        onToggle={() => {
          if (state.openCanvasId) {
            useStore.getState().openCanvas(null);
          } else if (anyClassifyOpen) {
            state.closeClassificationPanel();
          } else if (state.workbenchOpen) {
            state.setWorkbenchOpen(false);
          } else {
            state.closeClassificationPanel();
            state.setWorkbenchOpen(true);
          }
        }}
        size={
          state.openCanvasId
            ? Math.min(
                winW - 220,
                Math.max(480, state.canvasSplitWidth ?? winW - 300)
              )
            : anyClassifyOpen
              ? 400
              : 360
        }
        resizable={!!state.openCanvasId}
        onResizeTo={(px) => state.setCanvasSplitWidth(Math.min(winW - 220, Math.max(480, px)))}
        seamLabel={
          state.openCanvasId
            ? "Close the canvas (layout is saved)"
            : anyClassifyOpen
              ? "Close classification"
              : "Workbench — a temporary worktable (⌘J)"
        }
        id="workbench-membrane"
      >
        {state.openCanvasId ? (
          <CanvasView key={state.openCanvasId} canvasId={state.openCanvasId} />
        ) : (
          <div className="h-full flex flex-col">
            <MembraneTabs
              active={anyClassifyOpen ? "classify" : "bench"}
              benchCount={state.workbenchCount}
              canClassify={view.kind === "collection"}
              onSelect={(tab) => {
                // A tab SELECTS; it never toggles. handleClassifyClick is a
                // toggle (it also serves ⌘-less entry from elsewhere), so
                // re-clicking the active Classify tab would otherwise close
                // the compartment and silently fall back to Bench.
                if (tab === "classify") {
                  if (anyClassifyOpen) return;
                  state.setWorkbenchOpen(false);
                  handleClassifyClick();
                } else {
                  if (state.workbenchOpen && !anyClassifyOpen) return;
                  state.closeClassificationPanel();
                  state.setWorkbenchOpen(true);
                }
              }}
              onClose={() => {
                state.closeClassificationPanel();
                state.setWorkbenchOpen(false);
              }}
            />
            <div className="flex-1 min-h-0">
              {classifyOpen && activeRole ? (
                <ClassifyPanel
                  roleObjects={roleObjects}
                  collectionIds={collectionIds}
                  allObjects={allObjectsList}
                  activeRole={activeRole}
                  fieldName={effectiveClassifyField ?? ""}
                  fieldOptions={
                    currentCollection ? classifiableFieldNames : undefined
                  }
                  onFieldChange={(name) => {
                    setClassifyField(name);
                    // One space: if the page is being read by a property,
                    // switching the drawer switches the reading too — the
                    // chapters and the drawers always describe the same
                    // thing.
                    if (organizeField) state.setOrganizeBy(name);
                  }}
                  onFilterValue={(value) =>
                    useStore
                      .getState()
                      .setFacetFieldFilter(
                        value === null ? null : { field: effectiveClassifyField ?? "", value }
                      )
                  }
                  activeFilterValue={
                    state.facetFieldFilter?.field === effectiveClassifyField
                      ? state.facetFieldFilter.value
                      : null
                  }
                  onOpen={state.openDetail}
                />
              ) : stackedClassifyOpen ? (
                <StackedClassifyPanel
                  kinds={stackedKinds}
                  members={baseObjects}
                  collection={currentCollection}
                  onOpen={state.openDetail}
                />
              ) : (
                <Workbench onOpenDetail={state.openDetail} />
              )}
            </div>
          </div>
        )}
      </Membrane>

      {/* Status toasts — floating, never a band that pushes content (N3).
          Success self-dismisses; errors and the backup warning persist. */}
      {/* Exploration back-stack (non-destructive Same-vibe navigation,
          #135): bottom-left so it never collides with the Adaptive Chrome
          capsule (top-left) or the toasts (bottom-right). */}
      <AnimatePresence>
        {state.viewBackStack.length > 0 && (
          <motion.div
            key="view-back"
            custom={{ x: 0, y: 12 }}
            variants={surfaceVariants}
            initial="hidden"
            animate="visible"
            exit="exit"
            // Clears the pinned sidebar instead of sitting on top of its
            // footer (issue #140 §2). Raising the z-index alone only decided
            // WHICH of two things wins an overlap neither should have — the
            // pill is 16px from the left edge and the sidebar occupies
            // 8…264px, so pinned they were always in the same place.
            style={{ left: sidebarPinned ? 272 : 16 }}
            className="fixed bottom-4 z-[60] flex items-center gap-1 rounded border border-line/70 bg-panel shadow-cardHover pl-1 pr-1 py-1 font-mono text-[11px]"
          >
            <button
              onClick={() => {
                const top = state.viewBackStack[state.viewBackStack.length - 1];
                state.popViewSnapshot();
                requestAnimationFrame(() => {
                  const el = document.querySelector("[data-content-scroll]") as HTMLElement | null;
                  if (el) el.scrollTop = top.scrollTop;
                });
              }}
              className="flex items-center gap-1.5 px-2 py-1 rounded hover:bg-line/40 text-ink/80 hover:text-ink"
              title="Return to exactly where you were — view, filters and scroll position"
            >
              <ArrowLeft size={12} />
              Back to {state.viewBackStack[state.viewBackStack.length - 1].label}
            </button>
            <button
              onClick={() => state.dismissViewBackStack()}
              className="w-6 h-6 flex items-center justify-center rounded text-muted hover:text-ink hover:bg-line/40"
              aria-label="Dismiss — stay on this exploratory view"
              title="Dismiss (stay here)"
            >
              <XIcon size={11} />
            </button>
          </motion.div>
        )}
      </AnimatePresence>


      {confirm && (
        <ConfirmDialog
          title={confirm.title}
          body={confirm.body}
          action={confirm.action}
          onConfirm={confirm.onConfirm}
          onClose={() => useStore.getState().clearConfirm()}
        />
      )}

      {/* Only while something is selected — summoned by intent, gone when
          the selection clears (Samuel, 2026-07-22). */}
      <SelectionBar collection={currentCollection} />

      {/* z-[60], not z-40 (issue #140): the toast stack and the back-stack
          pill sat at the same level as the DetailPanel and EARLIER in DOM
          order, so its scrim dimmed them and swallowed their clicks. A
          notice you can't read and a Back you can't press are worse than
          none. 60 clears the panel (40) and the modals (50) both — status
          and navigation are not content chrome. */}
      <div className="fixed bottom-4 right-4 z-[60] flex flex-col items-end gap-2 max-w-sm">
        <AnimatePresence initial={false}>
        {state.flashNotice && (
          <motion.div key="flash" layout custom={{ x: 0, y: 12 }} variants={surfaceVariants} initial="hidden" animate="visible" exit="exit" className="rounded border border-line bg-panel shadow-cardHover px-3.5 py-2.5 font-mono text-[12px] text-ink/80">
            {state.flashNotice}
          </motion.div>
        )}
        {restoreNotice && (
          <motion.div key="restore" layout custom={{ x: 0, y: 12 }} variants={surfaceVariants} initial="hidden" animate="visible" exit="exit" className="rounded-lg border border-ok/30 bg-ok/10 shadow-cardHover px-3.5 py-2.5 text-[12px] text-ok flex items-start justify-between gap-3">
            <span>Your data is back and ready to use!</span>
            <button
              onClick={() => setRestoreNotice(false)}
              className="text-ok/60 hover:text-ok shrink-0"
              aria-label="Dismiss"
            >
              ×
            </button>
          </motion.div>
        )}
        {syncState.status === "error" && (
          <motion.div key="sync-error" layout custom={{ x: 0, y: 12 }} variants={surfaceVariants} initial="hidden" animate="visible" exit="exit" className="rounded-lg border border-danger/30 bg-danger/10 shadow-cardHover px-3.5 py-2.5 text-[12px] text-red-800 flex items-start justify-between gap-3">
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
          <motion.div key="sync-done" layout custom={{ x: 0, y: 12 }} variants={surfaceVariants} initial="hidden" animate="visible" exit="exit" className="rounded-lg border border-ok/30 bg-ok/10 shadow-cardHover px-3.5 py-2.5 text-[12px] text-ok flex items-start justify-between gap-3">
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
              className="text-ok/60 hover:text-ok shrink-0"
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
          onPublishArena={(id) => setArenaExportObjectId(id)}
        />
      )}
      {state.carouselObjectId && (
        <DetailCarousel
          objects={visibleObjects}
          currentId={state.carouselObjectId}
          onClose={state.closeCarousel}
        />
      )}
      {addFiles !== null && (
        <AddSomethingModal initialFiles={addFiles} onClose={() => setAddFiles(null)} />
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

      {arenaExportId && (
        <ArenaExportModal
          defaultTitle={state.collections[arenaExportId]?.name ?? "Untitled"}
          defaultDescription={state.collections[arenaExportId]?.description}
          objects={getVisibleObjects({
            objects: state.objects,
            collections: state.collections,
            selectedView: { kind: "collection", collectionId: arenaExportId },
            tagGroups: state.tagGroups,
            objectRelations: state.objectRelations,
          })}
          onClose={() => setArenaExportId(null)}
        />
      )}

      {arenaExportObjectId && state.objects[arenaExportObjectId] && (
        <ArenaExportModal
          defaultTitle={state.objects[arenaExportObjectId].title}
          objects={[state.objects[arenaExportObjectId]]}
          onClose={() => setArenaExportObjectId(null)}
        />
      )}
    </div>
  );
}
