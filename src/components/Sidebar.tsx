import { useEffect, useMemo, useState } from "react";
import { useShallow } from "zustand/react/shallow";
import { useStore, isSampleObject } from "../store";
import { matchesSmartCollection } from "../lib/ruleEngine";
import { chooseBackupFile, getStoredBackupHandle, isAutoBackupSupported } from "../lib/autoBackup";
import { makeId } from "../lib/id";
import type { Collection, FilterGroup, ManualCollection, ViewSelection } from "../types";

function timeSince(iso?: string): string {
  if (!iso) return "never";
  const ms = Date.now() - new Date(iso).getTime();
  const mins = Math.floor(ms / 60000);
  if (mins < 1) return "just now";
  if (mins < 60) return `${mins}m ago`;
  const hours = Math.floor(mins / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.floor(hours / 24);
  return `${days}d ago`;
}

const DRAG_MIME = "application/x-organizer-object-id";

function SmartIcon() {
  return (
    <svg viewBox="0 0 16 16" width="14" height="14" fill="none" className="shrink-0">
      <path
        d="M9 1 3 9h4l-1 6 6-8H8l1-6Z"
        fill="currentColor"
        className="text-accent"
      />
    </svg>
  );
}

function FolderIcon() {
  return (
    <svg viewBox="0 0 16 16" width="14" height="14" fill="none" className="shrink-0">
      <path
        d="M1.5 3.5A1 1 0 0 1 2.5 2.5h3l1.2 1.5H13.5a1 1 0 0 1 1 1V12a1 1 0 0 1-1 1h-11a1 1 0 0 1-1-1v-8.5Z"
        fill="currentColor"
        className="text-muted"
      />
    </svg>
  );
}

/** Shows the sidebar's CURRENT state (shaded left panel = visible), not the
 * action the click performs — same convention as most apps' sidebar-toggle
 * icon (VSCode, Notion, etc.). */
function SidebarToggleIcon({ collapsed }: { collapsed: boolean }) {
  return (
    <svg viewBox="0 0 16 16" width="14" height="14" fill="none" className="shrink-0">
      <rect x="1.5" y="2.5" width="13" height="11" rx="1.5" stroke="currentColor" strokeWidth="1.2" />
      <line x1="6" y1="2.5" x2="6" y2="13.5" stroke="currentColor" strokeWidth="1.2" />
      {!collapsed && <rect x="2.4" y="3.4" width="3" height="9.2" fill="currentColor" opacity="0.5" />}
    </svg>
  );
}

function NavRow({
  active,
  onClick,
  icon,
  label,
  count,
  onDrop,
  onDelete,
  onEdit,
  onAddNestedManual,
  onAddNestedSmart,
  disabled,
}: {
  active: boolean;
  onClick: () => void;
  icon?: React.ReactNode;
  label: string;
  count?: number;
  onDrop?: (objectId: string) => void;
  onDelete?: () => void;
  onEdit?: () => void;
  /** Nesting (issue #126) — only ever offered on a manual collection row,
   * since only manual collections can hold children. Two separate handlers
   * (rather than one "add nested" gesture) because a manual collection can
   * hold either type of child. */
  onAddNestedManual?: () => void;
  onAddNestedSmart?: () => void;
  disabled?: boolean;
}) {
  const [dragOver, setDragOver] = useState(false);
  const isDropTarget = !!onDrop;

  return (
    <div
      onClick={onClick}
      onDragOver={(e) => {
        if (!isDropTarget) return;
        e.preventDefault();
        setDragOver(true);
      }}
      onDragLeave={() => setDragOver(false)}
      onDrop={(e) => {
        if (!isDropTarget) return;
        e.preventDefault();
        setDragOver(false);
        const raw = e.dataTransfer.getData(DRAG_MIME);
        if (!raw) return;
        // Payload is always a JSON array of ids (issue #103) — one id for a
        // lone card, the whole selection for a multi-select drag.
        const ids: string[] = JSON.parse(raw);
        for (const id of ids) onDrop(id);
      }}
      className={[
        "group flex items-center gap-2 rounded-lg px-2.5 py-1.5 text-[13px] cursor-pointer select-none",
        active ? "bg-ink text-white" : "text-ink/80 hover:bg-line/60",
        dragOver ? "ring-2 ring-accent ring-offset-1 ring-offset-panel" : "",
        disabled ? "opacity-40 pointer-events-none" : "",
      ].join(" ")}
      title={isDropTarget ? "Drop an item here to add it to this collection" : undefined}
    >
      {icon}
      <span className="flex-1 truncate">{label}</span>
      {typeof count === "number" && (
        <span className={active ? "text-white/60" : "text-muted"}>{count}</span>
      )}
      {onEdit && (
        <button
          onClick={(e) => {
            e.stopPropagation();
            onEdit();
          }}
          className={[
            "hidden group-hover:inline-flex px-1",
            active ? "text-white/70 hover:text-white" : "text-muted hover:text-ink",
          ].join(" ")}
          aria-label={`Edit ${label}`}
          title="Edit"
        >
          ✎
        </button>
      )}
      {onDelete && (
        <button
          onClick={(e) => {
            e.stopPropagation();
            onDelete();
          }}
          className={[
            "hidden group-hover:inline-flex px-1",
            active ? "text-white/70 hover:text-white" : "text-muted hover:text-ink",
          ].join(" ")}
          aria-label={`Delete ${label}`}
        >
          ×
        </button>
      )}
      {onAddNestedManual && (
        <button
          onClick={(e) => {
            e.stopPropagation();
            onAddNestedManual();
          }}
          className={[
            "hidden group-hover:inline-flex px-1",
            active ? "text-white/70 hover:text-white" : "text-muted hover:text-ink",
          ].join(" ")}
          aria-label={`New nested manual collection in ${label}`}
          title="New nested manual collection"
        >
          📁+
        </button>
      )}
      {onAddNestedSmart && (
        <button
          onClick={(e) => {
            e.stopPropagation();
            onAddNestedSmart();
          }}
          className={[
            "hidden group-hover:inline-flex px-1",
            active ? "text-white/70 hover:text-white" : "text-muted hover:text-ink",
          ].join(" ")}
          aria-label={`New nested smart collection in ${label}`}
          title="New nested smart collection"
        >
          ⚡+
        </button>
      )}
    </div>
  );
}

/** Drop target for "make a new collection out of this" — splits into two
 * independent halves on hover so the same gesture (drag onto empty sidebar
 * space) can mean either "just file it away" (manual) or "I noticed a
 * pattern, show me more like it" (smart, seeded with a same-vibe rule the
 * next screen lets you edit or replace entirely). */
function CreateDropZone({
  onDropManual,
  onDropSmart,
}: {
  onDropManual: (objectId: string) => void;
  onDropSmart: (objectId: string) => void;
}) {
  const [hoverSide, setHoverSide] = useState<"manual" | "smart" | null>(null);

  function handleDrop(side: "manual" | "smart", e: React.DragEvent) {
    e.preventDefault();
    setHoverSide(null);
    const raw = e.dataTransfer.getData(DRAG_MIME);
    if (!raw) return;
    const ids: string[] = JSON.parse(raw);
    for (const id of ids) (side === "manual" ? onDropManual : onDropSmart)(id);
  }

  const halfClass = (side: "manual" | "smart") =>
    [
      "flex-1 text-center py-2 transition-colors",
      hoverSide === side ? "bg-accent/10 text-ink" : "text-muted/70",
    ].join(" ");

  return (
    <div className="mt-1.5 flex rounded-lg border border-dashed border-line overflow-hidden text-[11px]">
      <div
        onDragOver={(e) => {
          e.preventDefault();
          setHoverSide("manual");
        }}
        onDragLeave={() => setHoverSide((s) => (s === "manual" ? null : s))}
        onDrop={(e) => handleDrop("manual", e)}
        className={[halfClass("manual"), "border-r border-dashed border-line"].join(" ")}
        title="Drop here to file it into a brand-new manual collection"
      >
        {hoverSide === "manual" ? "Drop → new folder" : "Manual"}
      </div>
      <div
        onDragOver={(e) => {
          e.preventDefault();
          setHoverSide("smart");
        }}
        onDragLeave={() => setHoverSide((s) => (s === "smart" ? null : s))}
        onDrop={(e) => handleDrop("smart", e)}
        className={halfClass("smart")}
        title="Drop here to create a smart collection seeded with 'similar to this' — every parameter, including that rule itself, stays editable after"
      >
        {hoverSide === "smart" ? "Drop → same vibe" : "Smart"}
      </div>
    </div>
  );
}

export function Sidebar({
  onNewSmart,
  onNewManual,
  onEditSmart,
  onEditManual,
}: {
  /** `parentId` (issue #126) nests the new collection under a manual
   * collection — omitted for a top-level create. */
  onNewSmart: (parentId?: string) => void;
  onNewManual: (parentId?: string) => void;
  onEditSmart: (collectionId: string) => void;
  onEditManual: (collectionId: string) => void;
}) {
  // Shallow-selected — Sidebar has nothing to do with search/facet/type
  // filters or which detail panel is open, so it shouldn't re-render (and
  // re-run its per-object counts memo's dependency check) on every keystroke
  // elsewhere in the app.
  const state = useStore(
    useShallow((s) => ({
      collections: s.collections,
      collectionOrder: s.collectionOrder,
      selectedView: s.selectedView,
      setSelectedView: s.setSelectedView,
      objects: s.objects,
      tagGroups: s.tagGroups,
      lastBackupAt: s.lastBackupAt,
      deleteSampleObjects: s.deleteSampleObjects,
      deleteCollection: s.deleteCollection,
      assignToManualCollection: s.assignToManualCollection,
      addManualCollection: s.addManualCollection,
      addSmartCollection: s.addSmartCollection,
      sidebarCollapsed: s.sidebarCollapsed,
      setSidebarCollapsed: s.setSidebarCollapsed,
      dragRevealSidebar: s.dragRevealSidebar,
    }))
  );
  const { collections, collectionOrder, selectedView, setSelectedView } = state;

  const [backupConfigured, setBackupConfigured] = useState(false);
  useEffect(() => {
    getStoredBackupHandle().then((handle) => setBackupConfigured(!!handle));
  }, []);

  async function handleSetBackupFile() {
    const handle = await chooseBackupFile();
    if (handle) setBackupConfigured(true);
  }

  const allCollections = useMemo(
    () => collectionOrder.map((id) => collections[id]).filter((c): c is Collection => !!c),
    [collections, collectionOrder]
  );
  const smart = useMemo(
    () => allCollections.filter((c): c is Extract<Collection, { type: "smart" }> => c.type === "smart" && !c.parentId),
    [allCollections]
  );
  const manual = useMemo(
    () =>
      allCollections.filter(
        (c): c is Extract<Collection, { type: "manual" }> => c.type === "manual" && !c.parentId
      ),
    [allCollections]
  );
  // Nesting (issue #126) — only a manual collection can hold children, of
  // either type; no depth limit, so this is just "whoever points at me",
  // walked recursively by renderNode below rather than precomputed as a
  // full tree structure (collections are few enough that re-filtering per
  // node is cheap, and it avoids keeping a second data shape in sync).
  const childrenOf = (parentId: string) => allCollections.filter((c) => c.parentId === parentId);

  // One pass over the library for all counts (every collection, nested or
  // not — a nested collection's count is still just its own direct
  // members/matches, never an aggregate of its children's), recomputed only
  // when objects or collections actually change. With ~8000 objects,
  // per-row full scans on every render were a real cost.
  const counts = useMemo(() => {
    const map = new Map<string, number>();
    const smartAll = allCollections.filter((c): c is Extract<Collection, { type: "smart" }> => c.type === "smart");
    const objects = Object.values(state.objects);
    for (const c of allCollections) map.set(c.id, 0);
    for (const obj of objects) {
      for (const c of smartAll) {
        if (matchesSmartCollection(c, obj, state.tagGroups, state.objects)) {
          map.set(c.id, (map.get(c.id) ?? 0) + 1);
        }
      }
      for (const id of obj.manualCollectionIds) {
        if (map.has(id)) map.set(id, (map.get(id) ?? 0) + 1);
      }
    }
    return map;
  }, [state.objects, allCollections, state.tagGroups]);

  const sampleCount = useMemo(
    () => Object.values(state.objects).filter(isSampleObject).length,
    [state.objects]
  );

  const isView = (v: ViewSelection) => JSON.stringify(v) === JSON.stringify(selectedView);
  const totalCount = Object.keys(state.objects).length;

  function handleClearSamples() {
    const ok = window.confirm(
      `Remove ${sampleCount} sample item${sampleCount === 1 ? "" : "s"} from the Organizer?\n\n` +
        "Only locally imported test data is removed — objects synced from mymind " +
        "are untouched, and nothing is ever deleted in mymind itself."
    );
    if (ok) state.deleteSampleObjects();
  }

  function handleDropCreateManual(objectId: string) {
    const id = state.addManualCollection("New collection");
    state.assignToManualCollection(objectId, id);
  }

  // Seeds a smart collection with a "similar to this" rule (default 40%
  // threshold) and opens it straight in the full editor — every parameter,
  // including that rule itself, stays reversible from there (remove it,
  // loosen/tighten the threshold, add a tag/facet condition alongside it).
  function handleDropCreateSmart(objectId: string) {
    const seed = state.objects[objectId];
    if (!seed) return;
    const rule: FilterGroup = {
      kind: "group",
      id: makeId("group"),
      combinator: "AND",
      children: [{ kind: "similarity", id: makeId("cond"), objectId, minScore: 0.4 }],
    };
    const id = state.addSmartCollection(`Similar to ${seed.title}`, rule);
    onEditSmart(id);
  }

  // Recursive tree render (issue #126) — a manual collection's children
  // (either type, no depth limit) render indented directly beneath it.
  // Re-filters allCollections per node rather than precomputing a tree
  // shape — collections are few enough that this is cheap, and it avoids a
  // second data structure that could drift from `collections` itself.
  function renderManualNode(c: ManualCollection, depth: number): React.ReactNode {
    const children = childrenOf(c.id);
    return (
      <div key={c.id}>
        <div style={{ paddingLeft: depth * 14 }}>
          <NavRow
            active={isView({ kind: "collection", collectionId: c.id })}
            onClick={() => setSelectedView({ kind: "collection", collectionId: c.id })}
            icon={<FolderIcon />}
            label={c.name}
            count={counts.get(c.id) ?? 0}
            onDrop={(objectId) => state.assignToManualCollection(objectId, c.id)}
            onEdit={() => onEditManual(c.id)}
            onDelete={() => state.deleteCollection(c.id)}
            onAddNestedManual={() => onNewManual(c.id)}
            onAddNestedSmart={() => onNewSmart(c.id)}
          />
        </div>
        {children.map((child) =>
          child.type === "manual" ? (
            renderManualNode(child, depth + 1)
          ) : (
            <div key={child.id} style={{ paddingLeft: (depth + 1) * 14 }}>
              <NavRow
                active={isView({ kind: "collection", collectionId: child.id })}
                onClick={() => setSelectedView({ kind: "collection", collectionId: child.id })}
                icon={<SmartIcon />}
                label={child.name}
                count={counts.get(child.id) ?? 0}
                onEdit={() => onEditSmart(child.id)}
                onDelete={() => state.deleteCollection(child.id)}
              />
            </div>
          )
        )}
      </div>
    );
  }

  if (state.sidebarCollapsed && !state.dragRevealSidebar) {
    return (
      <aside className="w-9 shrink-0 border-r border-line bg-panel h-full flex flex-col items-center pt-5">
        <button
          onClick={() => state.setSidebarCollapsed(false)}
          className="text-muted hover:text-ink p-1.5 rounded-lg hover:bg-line/40"
          aria-label="Show sidebar"
          title="Show sidebar"
        >
          <SidebarToggleIcon collapsed />
        </button>
      </aside>
    );
  }

  return (
    <aside className="w-64 shrink-0 border-r border-line bg-panel h-full flex flex-col">
      <div className="px-4 pt-5 pb-3 flex items-start justify-between gap-2">
        <div className="min-w-0">
          <div className="text-[13px] font-semibold tracking-tight">The Organizer</div>
          <div className="text-[11px] text-muted mt-0.5">Design reference archive</div>
        </div>
        <button
          onClick={() => state.setSidebarCollapsed(true)}
          className="text-muted hover:text-ink p-1 rounded-lg hover:bg-line/40 shrink-0"
          aria-label="Hide sidebar"
          title="Hide sidebar"
        >
          <SidebarToggleIcon collapsed={false} />
        </button>
      </div>

      <div className="px-3 space-y-0.5">
        <NavRow
          active={isView({ kind: "all" })}
          onClick={() => setSelectedView({ kind: "all" })}
          label="All items"
          count={totalCount}
        />
        <NavRow
          active={isView({ kind: "unclassified" })}
          onClick={() => setSelectedView({ kind: "unclassified" })}
          label="Unclassified"
        />
      </div>

      <div className="mt-5 px-3">
        <div className="flex items-center justify-between px-2 mb-1">
          <span className="text-[11px] font-medium uppercase tracking-wide text-muted">
            Smart collections
          </span>
          <button
            onClick={() => onNewSmart()}
            className="text-muted hover:text-ink text-[15px] leading-none px-1"
            aria-label="New smart collection"
            title="New smart collection"
          >
            +
          </button>
        </div>
        <div className="space-y-0.5">
          {smart.length === 0 && (
            <div className="px-2 py-1 text-[12px] text-muted/70">
              None yet — saved searches appear here.
            </div>
          )}
          {smart.map((c) => (
            <NavRow
              key={c.id}
              active={isView({ kind: "collection", collectionId: c.id })}
              onClick={() => setSelectedView({ kind: "collection", collectionId: c.id })}
              icon={<SmartIcon />}
              label={c.name}
              count={counts.get(c.id) ?? 0}
              onEdit={() => onEditSmart(c.id)}
              onDelete={() => state.deleteCollection(c.id)}
            />
          ))}
        </div>
      </div>

      <div className="mt-5 px-3">
        <div className="flex items-center justify-between px-2 mb-1">
          <span className="text-[11px] font-medium uppercase tracking-wide text-muted">
            Manual collections
          </span>
          <button
            onClick={() => onNewManual()}
            className="text-muted hover:text-ink text-[15px] leading-none px-1"
            aria-label="New manual collection"
            title="New manual collection"
          >
            +
          </button>
        </div>
        <div className="space-y-0.5">
          {manual.length === 0 && (
            <div className="px-2 py-1 text-[12px] text-muted/70">
              None yet — drag items here from the grid.
            </div>
          )}
          {manual.map((c) => renderManualNode(c, 0))}
        </div>
        <CreateDropZone onDropManual={handleDropCreateManual} onDropSmart={handleDropCreateSmart} />
      </div>

      <div className="mt-auto px-4 py-3 border-t border-line text-[11px] text-muted space-y-1.5">
        {isAutoBackupSupported() ? (
          backupConfigured ? (
            <div className="flex items-center justify-between">
              <span>Last backup: {timeSince(state.lastBackupAt)}</span>
              <button
                onClick={handleSetBackupFile}
                className="text-ink/60 hover:text-ink underline decoration-dotted"
              >
                change
              </button>
            </div>
          ) : (
            <button
              onClick={handleSetBackupFile}
              className="w-full text-left rounded-lg border border-line px-2.5 py-1.5 text-[11px] text-ink/70 hover:bg-line/40"
              title="Pick a folder — every sync writes a new dated backup file there, no dialog, keeping the last 7"
            >
              Set backup folder for auto-backup
            </button>
          )
        ) : (
          <div className="text-muted/60">Auto-backup needs Chrome/Edge — use Export instead.</div>
        )}
        {sampleCount > 0 && (
          <button
            onClick={handleClearSamples}
            className="w-full text-left rounded-lg border border-line px-2.5 py-1.5 text-[11px] text-ink/70 hover:bg-line/40"
            title="Removes locally imported test data only — never touches mymind"
          >
            Clear {sampleCount} sample item{sampleCount === 1 ? "" : "s"}
          </button>
        )}
        <div className="flex items-center gap-1.5">
          <SmartIcon /> saved search — fills itself, hover for ✎ to edit
        </div>
        <div className="flex items-center gap-1.5">
          <FolderIcon /> curated folder — drag items in
        </div>
      </div>
    </aside>
  );
}

export { DRAG_MIME };
