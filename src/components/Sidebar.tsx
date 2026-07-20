import { useEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { AnimatePresence, motion } from "motion/react";
import {
  CaretRight,
  DotsThree,
  Folder,
  Graph,
  FrameCorners,
  GearSix,
  GridFour,
  Lightning,
  Rows,
  SidebarSimple,
  X,
} from "@phosphor-icons/react";
import { useShallow } from "zustand/react/shallow";
import { useStore, isSampleObject, getVisibleObjects } from "../store";
import { matchesSmartCollection } from "../lib/ruleEngine";
import { chooseBackupFile, getStoredBackupHandle, isAutoBackupSupported } from "../lib/autoBackup";
import { panelVariants, surfaceVariants, useWorkspaceChrome } from "../lib/chrome";
import { makeId } from "../lib/id";
import { DRAG_MIME } from "../lib/objectDrag";
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

function SmartIcon() {
  return <Lightning size={13} weight="fill" className="shrink-0 text-accent" />;
}

function FolderIcon() {
  return <Folder size={13} weight="fill" className="shrink-0 text-muted" />;
}

/** Shows the sidebar's CURRENT state (shaded left panel = visible), not the
 * action the click performs — same convention as most apps' sidebar-toggle
 * icon (VSCode, Notion, etc.). */
function SidebarToggleIcon({ collapsed }: { collapsed: boolean }) {
  return <SidebarSimple size={15} weight={collapsed ? "regular" : "fill"} className="shrink-0" />;
}

type RowAction = { label: string; onSelect: () => void; danger?: boolean };

/** Floating surface anchored to a rect, rendered through a portal so it's
 * never clipped by the sidebar's own scroll container (and stays correct
 * inside the motion-transformed overlay, where `fixed` descendants would
 * otherwise resolve against the transform). */
function AnchoredSurface({
  anchor,
  side,
  width,
  onHold,
  onRelease,
  children,
}: {
  anchor: DOMRect;
  /** "right" flies out laterally (nested children); "below" drops under
   * the anchor (row menu). */
  side: "right" | "below";
  width: number;
  onHold?: () => void;
  onRelease?: () => void;
  children: React.ReactNode;
}) {
  const style =
    side === "right"
      ? {
          top: Math.max(8, Math.min(anchor.top - 4, window.innerHeight - 320)),
          left: anchor.right + 6,
          width,
        }
      : {
          top: anchor.bottom + 4,
          left: Math.min(anchor.left, window.innerWidth - width - 12),
          width,
        };
  return createPortal(
    <motion.div
      className="fixed z-[60] rounded-xl border border-line/70 bg-panel shadow-cardHover p-1"
      style={style}
      custom={side === "right" ? { x: -8, y: 0 } : { x: 0, y: -6 }}
      variants={surfaceVariants}
      initial="hidden"
      animate="visible"
      exit="exit"
      onPointerEnter={onHold}
      onPointerLeave={onRelease}
    >
      {children}
    </motion.div>,
    document.body
  );
}

/** The ⋯ row menu — replaces the old pile of inline hover icons that
 * crowded the collection name (✎ × 📁+ ⚡+). One quiet trigger, one small
 * labeled surface. */
function RowMenu({ label, actions }: { label: string; actions: RowAction[] }) {
  const [open, setOpen] = useState(false);
  const [anchor, setAnchor] = useState<DOMRect | null>(null);
  const buttonRef = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    if (!open) return;
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape") {
        setOpen(false);
        buttonRef.current?.focus();
      }
    }
    function onPointerDown(e: MouseEvent) {
      const t = e.target as HTMLElement;
      if (buttonRef.current?.contains(t)) return;
      if (t.closest("[data-row-menu]")) return;
      setOpen(false);
    }
    document.addEventListener("keydown", onKey);
    document.addEventListener("mousedown", onPointerDown);
    return () => {
      document.removeEventListener("keydown", onKey);
      document.removeEventListener("mousedown", onPointerDown);
    };
  }, [open]);

  return (
    <>
      <button
        ref={buttonRef}
        onClick={(e) => {
          e.stopPropagation();
          setAnchor(buttonRef.current?.getBoundingClientRect() ?? null);
          setOpen((v) => !v);
        }}
        className={[
          "shrink-0 w-5 h-5 inline-flex items-center justify-center rounded text-muted hover:text-ink hover:bg-line/50 transition-opacity",
          open ? "opacity-100" : "opacity-0 group-hover:opacity-100 focus-visible:opacity-100",
        ].join(" ")}
        aria-label={`Actions for ${label}`}
        aria-haspopup="menu"
        aria-expanded={open}
        title="Actions"
      >
        <DotsThree size={15} weight="bold" />
      </button>
      <AnimatePresence>
        {open && anchor && (
          <AnchoredSurface anchor={anchor} side="below" width={176}>
            <div data-row-menu role="menu">
              {actions.map((a) => (
                <button
                  key={a.label}
                  role="menuitem"
                  onClick={(e) => {
                    e.stopPropagation();
                    setOpen(false);
                    a.onSelect();
                  }}
                  className={[
                    "w-full text-left px-2.5 py-1.5 rounded-lg font-mono text-[12px] hover:bg-line/30",
                    a.danger ? "text-red-700/80 hover:text-red-700" : "text-ink/85",
                  ].join(" ")}
                >
                  {a.label}
                </button>
              ))}
            </div>
          </AnchoredSurface>
        )}
      </AnimatePresence>
    </>
  );
}

function NavRow({
  active,
  onClick,
  icon,
  label,
  count,
  onDrop,
  explainDrop,
  actions,
  hasChildren,
  childrenOpen,
  onToggleChildren,
  disabled,
}: {
  active: boolean;
  onClick: () => void;
  icon?: React.ReactNode;
  label: string;
  count?: number;
  onDrop?: (objectId: string) => void;
  /** Smart-collection constraint (issue #132): the row accepts the drop
   * gesture but explains WHY nothing was filed instead of silently
   * ignoring it — a smart collection fills by rule, and a drop must never
   * quietly mutate that rule. */
  explainDrop?: string;
  /** Row actions collapse into one ⋯ menu (never a pile of inline icons). */
  actions?: RowAction[];
  /** Lateral flyout affordance (issue #126 nesting) — the chevron is the
   * keyboard/touch path; hover on the row is the pointer path. */
  hasChildren?: boolean;
  childrenOpen?: boolean;
  onToggleChildren?: () => void;
  disabled?: boolean;
}) {
  const [dragOver, setDragOver] = useState(false);
  const isDropTarget = !!onDrop || !!explainDrop;

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
        if (!onDrop) {
          if (explainDrop) useStore.getState().setFlashNotice(explainDrop);
          return;
        }
        const raw = e.dataTransfer.getData(DRAG_MIME);
        if (!raw) return;
        // Payload is always a JSON array of ids (issue #103) — one id for a
        // lone card, the whole selection for a multi-select drag.
        const ids: string[] = JSON.parse(raw);
        for (const id of ids) onDrop(id);
      }}
      className={[
        // Quiet active state (the Claude-app register): a soft tint, not an
        // inverted black pill — the sidebar is fixed structure and should
        // whisper, not shout.
        "group flex items-center gap-2 rounded-lg px-2.5 py-1.5 font-mono text-[12px] cursor-pointer select-none",
        active ? "bg-line/60 text-ink" : "text-ink/75 hover:bg-line/40",
        dragOver && onDrop ? "ring-2 ring-accent ring-offset-1 ring-offset-panel" : "",
        dragOver && !onDrop ? "ring-2 ring-amber-400/70 ring-offset-1 ring-offset-panel" : "",
        disabled ? "opacity-40 pointer-events-none" : "",
      ].join(" ")}
      title={isDropTarget ? "Drop an item here to add it to this collection" : undefined}
    >
      {icon}
      <span className="flex-1 truncate">{label}</span>
      {typeof count === "number" && (
        <span className="text-muted/70 group-hover:hidden">{count}</span>
      )}
      {actions && actions.length > 0 && <RowMenu label={label} actions={actions} />}
      {hasChildren && (
        <button
          onClick={(e) => {
            e.stopPropagation();
            onToggleChildren?.();
          }}
          className="shrink-0 w-5 h-5 inline-flex items-center justify-center rounded text-muted hover:text-ink hover:bg-line/50"
          aria-label={`${childrenOpen ? "Hide" : "Show"} collections inside ${label}`}
          aria-expanded={childrenOpen}
          title="Nested collections"
        >
          <CaretRight
            size={11}
            className={["transition-transform", childrenOpen ? "rotate-90" : ""].join(" ")}
          />
        </button>
      )}
    </div>
  );
}

/** Everything a collection row needs from the Sidebar — bundled so
 * CollectionNode can live at module level (its flyout state must survive
 * re-renders) and recurse without threading a dozen props. */
type NodeCtx = {
  counts: Map<string, number>;
  isView: (v: ViewSelection) => boolean;
  setSelectedView: (v: ViewSelection) => void;
  childrenOf: (parentId: string) => Collection[];
  assignToManualCollection: (objectId: string, collectionId: string) => void;
  deleteCollection: (id: string) => void;
  onEditSmart: (id: string) => void;
  onEditManual: (id: string) => void;
  onNewSmart: (parentId?: string) => void;
  onNewManual: (parentId?: string) => void;
  onExportArena: (id: string) => void;
  /** Collection → canvas (issue #133 follow-up #3): seeds a new canvas
   * with the collection's current members and opens it. */
  onOpenAsCanvas: (id: string) => void;
};

/**
 * One collection row. A manual collection with children reveals them as a
 * lateral flyout (outward, portal-anchored) instead of growing the sidebar
 * vertically — hover opens with a small intent delay, the chevron is the
 * click/keyboard/touch path, and a grace timer keeps the surface stable
 * while the pointer crosses the gap. Recursive: nested manual collections
 * fly out again from inside the flyout.
 */
function CollectionNode({ collection, ctx }: { collection: Collection; ctx: NodeCtx }) {
  const [open, setOpen] = useState(false);
  const [anchor, setAnchor] = useState<DOMRect | null>(null);
  const rowRef = useRef<HTMLDivElement>(null);
  const openTimer = useRef<number | null>(null);
  const closeTimer = useRef<number | null>(null);

  const isManual = collection.type === "manual";
  const children = isManual ? ctx.childrenOf(collection.id) : [];
  const hasChildren = children.length > 0;

  function openNow() {
    if (closeTimer.current) window.clearTimeout(closeTimer.current);
    closeTimer.current = null;
    setAnchor(rowRef.current?.getBoundingClientRect() ?? null);
    setOpen(true);
  }
  function scheduleOpen() {
    if (!hasChildren || open) return;
    if (openTimer.current) return;
    openTimer.current = window.setTimeout(() => {
      openTimer.current = null;
      openNow();
    }, 150);
  }
  function scheduleClose() {
    if (openTimer.current) window.clearTimeout(openTimer.current);
    openTimer.current = null;
    if (closeTimer.current) window.clearTimeout(closeTimer.current);
    closeTimer.current = window.setTimeout(() => {
      closeTimer.current = null;
      setOpen(false);
    }, 250);
  }
  function holdOpen() {
    if (closeTimer.current) window.clearTimeout(closeTimer.current);
    closeTimer.current = null;
  }
  useEffect(
    () => () => {
      if (openTimer.current) window.clearTimeout(openTimer.current);
      if (closeTimer.current) window.clearTimeout(closeTimer.current);
    },
    []
  );
  useEffect(() => {
    if (!open) return;
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape") setOpen(false);
    }
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [open]);

  const actions: RowAction[] = isManual
    ? [
        { label: "Edit", onSelect: () => ctx.onEditManual(collection.id) },
        { label: "New folder inside", onSelect: () => ctx.onNewManual(collection.id) },
        { label: "New smart inside", onSelect: () => ctx.onNewSmart(collection.id) },
        { label: "Open as canvas", onSelect: () => ctx.onOpenAsCanvas(collection.id) },
        { label: "Export to Are.na…", onSelect: () => ctx.onExportArena(collection.id) },
        { label: "Delete", onSelect: () => ctx.deleteCollection(collection.id), danger: true },
      ]
    : [
        { label: "Edit", onSelect: () => ctx.onEditSmart(collection.id) },
        { label: "Open as canvas", onSelect: () => ctx.onOpenAsCanvas(collection.id) },
        { label: "Export to Are.na…", onSelect: () => ctx.onExportArena(collection.id) },
        { label: "Delete", onSelect: () => ctx.deleteCollection(collection.id), danger: true },
      ];

  return (
    <div ref={rowRef} onPointerEnter={scheduleOpen} onPointerLeave={scheduleClose}>
      <NavRow
        active={ctx.isView({ kind: "collection", collectionId: collection.id })}
        onClick={() => ctx.setSelectedView({ kind: "collection", collectionId: collection.id })}
        icon={isManual ? <FolderIcon /> : <SmartIcon />}
        label={collection.name}
        count={ctx.counts.get(collection.id) ?? 0}
        onDrop={
          isManual
            ? (objectId) => ctx.assignToManualCollection(objectId, collection.id)
            : undefined
        }
        explainDrop={
          isManual
            ? undefined
            : `"${collection.name}" fills itself by rule — edit its rule (⋯ → Edit), or drop into a manual collection.`
        }
        actions={actions}
        hasChildren={hasChildren}
        childrenOpen={open}
        onToggleChildren={() => (open ? setOpen(false) : openNow())}
      />
      <AnimatePresence>
        {open && anchor && hasChildren && (
          <AnchoredSurface
            anchor={anchor}
            side="right"
            width={224}
            onHold={holdOpen}
            onRelease={scheduleClose}
          >
            <div className="max-h-72 overflow-y-auto">
              {children.map((child) => (
                <CollectionNode key={child.id} collection={child} ctx={ctx} />
              ))}
            </div>
          </AnchoredSurface>
        )}
      </AnimatePresence>
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
      "flex-1 text-center py-2 transition-colors font-mono text-[10px] uppercase tracking-[0.08em]",
      hoverSide === side ? "bg-accent/10 text-ink" : "text-muted/70",
    ].join(" ");

  return (
    <div className="mt-1.5 flex rounded-lg border border-dashed border-line overflow-hidden">
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

/** Condensed icon column (issue #128) — the view/zoom/preferences controls
 * that used to live in the top-right header, now icon-only and pinned in
 * the sidebar itself so they're reachable even when the sidebar is
 * collapsed to its 36px strip (rendered by both sidebar states below,
 * unlike everything else in this file that's expanded-only). Pressing the
 * card-size icon reveals a popover with the actual slider, mirroring how
 * the preferences gear already worked before this issue. */
function CondensedControls({
  viewMode,
  setViewMode,
  gridZoom,
  setGridZoom,
  prefsActive,
  onPrefsClick,
  vertical = false,
}: {
  viewMode: "grid" | "table";
  setViewMode: (mode: "grid" | "table") => void;
  gridZoom: number;
  setGridZoom: (zoom: number) => void;
  /** Preferences render as an inline section inside the sidebar body (one
   * instance, owned by App) — this is just the trigger. */
  prefsActive: boolean;
  onPrefsClick: () => void;
  /** Collapsed-rail placement stacks the icons; expanded lays them in a row. */
  vertical?: boolean;
}) {
  const [zoomOpen, setZoomOpen] = useState(false);
  const zoomRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!zoomOpen) return;
    function onPointerDown(e: MouseEvent) {
      if (zoomRef.current && !zoomRef.current.contains(e.target as Node)) setZoomOpen(false);
    }
    document.addEventListener("mousedown", onPointerDown);
    return () => document.removeEventListener("mousedown", onPointerDown);
  }, [zoomOpen]);

  // The slider shows plain size, small→big left→right — gridZoom itself
  // runs the opposite way internally (a HIGHER gridZoom means MORE grid
  // columns, i.e. SMALLER cards), which is exactly the inversion issue
  // #128 reported ("minus makes them bigger"). Negating it here means the
  // fix lives entirely in this one control, without touching Grid.tsx's
  // existing column-count math or the persisted gridZoom range.
  const sizeValue = -gridZoom;

  // Ghost icons in a quiet row (column when the sidebar is collapsed to its
  // rail) — no boxes, no borders: the Claude-app register for fixed
  // controls. Active view = soft tint, never an inverted block.
  const ghost = (isActive: boolean, isDisabled = false) =>
    [
      "w-7 h-7 flex items-center justify-center rounded-md text-[13px] transition-colors",
      isDisabled
        ? "opacity-30 pointer-events-none"
        : isActive
        ? "bg-line/60 text-ink"
        : "text-muted hover:text-ink hover:bg-line/40",
    ].join(" ");

  return (
    <div className={vertical ? "flex flex-col items-center gap-1" : "flex items-center gap-1"}>
      <div className="relative" ref={zoomRef}>
        <button
          onClick={() => setZoomOpen((v) => !v)}
          disabled={viewMode !== "grid"}
          className={ghost(zoomOpen, viewMode !== "grid")}
          aria-label="Card size"
          title="Card size"
        >
          <FrameCorners size={15} />
        </button>
        <AnimatePresence>
        {zoomOpen && (
          <motion.div
            custom={{ x: -8, y: 0 }}
            variants={surfaceVariants}
            initial="hidden"
            animate="visible"
            exit="exit"
            className="absolute left-full top-0 ml-2 w-40 rounded-xl border border-line/70 bg-panel shadow-cardHover p-2.5 z-50">
            <div className="font-mono text-[10px] uppercase tracking-[0.12em] text-muted mb-1.5">
              Card size
            </div>
            <input
              type="range"
              min={-3}
              max={2}
              step={1}
              value={sizeValue}
              onChange={(e) => setGridZoom(-Number(e.target.value))}
              className="w-full"
              aria-label="Card size slider"
            />
          </motion.div>
        )}
        </AnimatePresence>
      </div>

      <button
        onClick={() => setViewMode("grid")}
        className={ghost(viewMode === "grid")}
        aria-label="Masonry grid"
        title="Masonry grid"
      >
        <GridFour size={15} />
      </button>
      <button
        onClick={() => setViewMode("table")}
        className={ghost(viewMode === "table")}
        aria-label="Table with columns"
        title="Table with columns"
      >
        <Rows size={15} />
      </button>

      <button
        onClick={onPrefsClick}
        className={ghost(prefsActive)}
        aria-label="Organizer preferences"
        aria-expanded={prefsActive}
        title="Organizer preferences — sync and backup"
      >
        <GearSix size={15} />
      </button>
    </div>
  );
}

export function Sidebar({
  onNewSmart,
  onNewManual,
  onEditSmart,
  onEditManual,
  onExportArena,
  prefsOpen,
  onTogglePrefs,
  prefsBody,
}: {
  /** `parentId` (issue #126) nests the new collection under a manual
   * collection — omitted for a top-level create. */
  onNewSmart: (parentId?: string) => void;
  onNewManual: (parentId?: string) => void;
  onEditSmart: (collectionId: string) => void;
  onEditManual: (collectionId: string) => void;
  onExportArena: (collectionId: string) => void;
  /** Preferences (issue #128, reworked): App owns the state/handlers and
   * hands the CONTENT here; Sidebar expands it inline inside its own body
   * — settings unfold within the bar itself, never a floating popover. */
  prefsOpen: boolean;
  onTogglePrefs: () => void;
  prefsBody: React.ReactNode;
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
      viewMode: s.viewMode,
      setViewMode: s.setViewMode,
      gridZoom: s.gridZoom,
      setGridZoom: s.setGridZoom,
    }))
  );
  const { collections, collectionOrder, selectedView, setSelectedView } = state;

  // Adaptive Chrome (lib/chrome.ts): resolves compact / peek / drag-reveal /
  // pinned from the two existing store primitives plus transient intent.
  const chrome = useWorkspaceChrome();
  // The rail capsule (quick controls) — hovering IT must not count as
  // expansion intent (issue #135); see the gutter's onPointerMove.
  const capsuleRef = useRef<HTMLDivElement>(null);
  // Canvas documents (issue #133) — separate scoped subscriptions.
  const canvases = useStore((s) => s.canvases);
  const canvasOrder = useStore((s) => s.canvasOrder);
  const openCanvasId = useStore((s) => s.openCanvasId);
  const openCanvas = useStore((s) => s.openCanvas);
  const deleteCanvas = useStore((s) => s.deleteCanvas);

  const [backupConfigured, setBackupConfigured] = useState(false);
  useEffect(() => {
    getStoredBackupHandle().then((handle) => setBackupConfigured(!!handle));
  }, []);

  // The create-by-drop zone is only meaningful mid-drag, so it only exists
  // then (summoned by intent, N4) — document-level listeners catch any card
  // drag, wherever it started.
  const [dragging, setDragging] = useState(false);
  useEffect(() => {
    const start = () => setDragging(true);
    const end = () => setDragging(false);
    document.addEventListener("dragstart", start);
    document.addEventListener("dragend", end);
    document.addEventListener("drop", end);
    return () => {
      document.removeEventListener("dragstart", start);
      document.removeEventListener("dragend", end);
      document.removeEventListener("drop", end);
    };
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
  // Vertical-rail context: the active view's own count (collection counts
  // are already computed; library-wide views read the totals directly).
  const totalShownLabel = (
    selectedView.kind === "collection"
      ? counts.get(selectedView.collectionId) ?? 0
      : totalCount
  ).toLocaleString();

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

  // Context bag for the recursive CollectionNode rows (nesting now reveals
  // laterally as a flyout — issue #126's tree no longer grows vertically).
  const nodeCtx: NodeCtx = {
    counts,
    isView,
    setSelectedView,
    childrenOf,
    assignToManualCollection: state.assignToManualCollection,
    deleteCollection: state.deleteCollection,
    onEditSmart,
    onEditManual,
    onNewSmart,
    onNewManual,
    onExportArena,
    onOpenAsCanvas: (collectionId: string) => {
      const st = useStore.getState();
      const col = st.collections[collectionId];
      if (!col) return;
      const members = getVisibleObjects({
        objects: st.objects,
        collections: st.collections,
        selectedView: { kind: "collection", collectionId },
        tagGroups: st.tagGroups,
        objectRelations: st.objectRelations,
      });
      const id = st.createCanvas(col.name, members.map((o) => o.id));
      st.openCanvas(id);
    },
  };

  // Shared by the pinned in-flow aside and the temporary overlay — same
  // content, different frame. The header's affordance differs: pinned shows
  // "unpin/hide", the overlay shows "pin" (make this permanent) + close.
  const sidebarBody = (variant: "pinned" | "overlay") => (
    <>
      <div className="px-4 pt-4 pb-1 flex items-center justify-between gap-2">
        <div className="font-mono text-[13px] font-bold tracking-tight truncate">
          The Organizer
        </div>
        <div className="flex items-center gap-0.5 shrink-0">
          {variant === "overlay" ? (
            <>
              <button
                onClick={chrome.pin}
                className="w-7 h-7 flex items-center justify-center text-muted hover:text-ink rounded-md hover:bg-line/40"
                aria-label="Pin sidebar open"
                title="Pin open"
              >
                <SidebarToggleIcon collapsed={false} />
              </button>
              <button
                onClick={chrome.closePeek}
                className="w-7 h-7 flex items-center justify-center text-muted hover:text-ink rounded-md hover:bg-line/40 text-[14px]"
                aria-label="Close sidebar"
                title="Close"
              >
                ×
              </button>
            </>
          ) : (
            <button
              onClick={chrome.unpin}
              className="w-7 h-7 flex items-center justify-center text-muted hover:text-ink rounded-md hover:bg-line/40"
              aria-label="Unpin sidebar"
              title="Unpin — collapses to the floating rail"
            >
              <SidebarToggleIcon collapsed={false} />
            </button>
          )}
        </div>
      </div>

      <div className="px-3.5 pb-2">
        <CondensedControls
          viewMode={state.viewMode}
          setViewMode={state.setViewMode}
          gridZoom={state.gridZoom}
          setGridZoom={state.setGridZoom}
          prefsActive={prefsOpen}
          onPrefsClick={onTogglePrefs}
        />
      </div>

      <div className="flex-1 min-h-0 overflow-y-auto pb-2">
        {/* Preferences unfold inside the bar itself — one instance, no
            floating popover (the double-popup bug's root cause). */}
        <AnimatePresence initial={false}>
          {prefsOpen && (
            <motion.div
              initial={{ height: 0, opacity: 0 }}
              animate={{ height: "auto", opacity: 1, transition: { duration: 0.18, ease: [0.22, 1, 0.36, 1] } }}
              exit={{ height: 0, opacity: 0, transition: { duration: 0.12, ease: [0.55, 0, 0.55, 0.2] } }}
              className="overflow-hidden"
            >
              <div className="mx-3 mb-2 rounded-xl border border-line/60 bg-canvas/50 p-3">
                {prefsBody}
              </div>
            </motion.div>
          )}
        </AnimatePresence>
        <div className="px-3 pt-2 space-y-0.5">
          <NavRow
            active={isView({ kind: "all" })}
            onClick={() => setSelectedView({ kind: "all" })}
            label="All items"
            count={totalCount}
          />
        </div>

        <div className="mt-5 px-3">
          <div className="flex items-center justify-between px-2 mb-1">
            <span className="font-mono text-[10px] uppercase tracking-[0.12em] text-muted">
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
              <div className="px-2.5 py-1 font-mono text-[11px] text-muted/60">
                none yet — saved searches live here
              </div>
            )}
            {smart.map((c) => (
              <CollectionNode key={c.id} collection={c} ctx={nodeCtx} />
            ))}
          </div>
        </div>

        <div className="mt-5 px-3">
          <div className="flex items-center justify-between px-2 mb-1">
            <span className="font-mono text-[10px] uppercase tracking-[0.12em] text-muted">
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
              <div className="px-2.5 py-1 font-mono text-[11px] text-muted/60">
                none yet — drag things here
              </div>
            )}
            {manual.map((c) => (
              <CollectionNode key={c.id} collection={c} ctx={nodeCtx} />
            ))}
          </div>
          {dragging && (
            <CreateDropZone
              onDropManual={handleDropCreateManual}
              onDropSmart={handleDropCreateSmart}
            />
          )}
        </div>

        {/* Canvases (issue #133) — presentation documents over the same
            objects. Deleting one keeps every relationship it created:
            knowledge outlives the canvas. Section only exists once there
            IS a canvas (no empty-state chrome). */}
        {canvasOrder.length > 0 && (
          <div className="mt-5 px-3">
            <div className="px-2 mb-1">
              <span className="font-mono text-[10px] uppercase tracking-[0.12em] text-muted">
                Canvases
              </span>
            </div>
            <div className="space-y-0.5">
              {canvasOrder.map((id) => {
                const doc = canvases[id];
                if (!doc) return null;
                return (
                  <NavRow
                    key={id}
                    active={openCanvasId === id}
                    onClick={() => openCanvas(id)}
                    icon={<Graph size={13} className="shrink-0 text-muted" />}
                    label={doc.name}
                    actions={[
                      {
                        label: "Delete canvas",
                        onSelect: () => deleteCanvas(id),
                        danger: true,
                      },
                    ]}
                  />
                );
              })}
            </div>
          </div>
        )}
      </div>

      <div className="shrink-0 px-4 py-3 border-t border-line/70 font-mono text-[10px] text-muted space-y-1.5">
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
      </div>
    </>
  );

  // Pinned: the sidebar participates in layout (a deliberate, explicit
  // state). Everything else: a stable narrow gutter holds a floating
  // utility capsule, and any temporary expansion OVERLAYS the workspace —
  // the main content never shifts for a peek or a drag (Adaptive Chrome).
  if (chrome.pinned) {
    return (
      <aside className="w-64 shrink-0 border-r border-line/70 bg-panel h-full flex flex-col">
        {sidebarBody("pinned")}
      </aside>
    );
  }

  const inCollection = selectedView.kind === "collection";

  return (
    <>
      <div
        className="w-12 shrink-0 relative"
        // Dwell-based intent (issue #135), resolved per pointer MOVE rather
        // than enter/leave pairs: while the pointer sits on a rail CONTROL
        // (the capsule), the expand timer stays cancelled — quick controls
        // never open navigation; while it rests on the rail background,
        // the dwell arms. Move-based resolution is robust where synthetic
        // enter/leave ordering is not.
        onPointerMove={(e) => {
          if (capsuleRef.current?.contains(e.target as Node)) chrome.cancelOpen();
          else chrome.openPeek();
        }}
        onPointerLeave={chrome.scheduleClose}
      >
        <div
          ref={capsuleRef}
          className={[
            "absolute top-3 left-1.5 flex flex-col items-center gap-1 rounded-2xl border border-line/60 bg-panel shadow-card p-1.5 transition-opacity duration-150",
            chrome.overlayVisible ? "opacity-0 pointer-events-none" : "opacity-100",
          ].join(" ")}
        >
          <button
            onClick={() => (chrome.overlayVisible ? chrome.closePeek() : chrome.openPeek(true))}
            className="relative w-7 h-7 flex items-center justify-center text-muted hover:text-ink rounded-md hover:bg-line/40"
            aria-label="Collections"
            aria-expanded={chrome.overlayVisible}
            aria-controls="sidebar-overlay"
            title={`Collections — ${viewLabel(state)}`}
          >
            <SidebarToggleIcon collapsed />
            {/* Active-collection context survives compaction: a quiet
                accent dot instead of a label. */}
            {inCollection && (
              <span className="absolute top-0.5 right-0.5 w-1.5 h-1.5 rounded-full bg-accent" />
            )}
          </button>
          <CondensedControls
            viewMode={state.viewMode}
            setViewMode={state.setViewMode}
            gridZoom={state.gridZoom}
            setGridZoom={state.setGridZoom}
            prefsActive={prefsOpen}
            onPrefsClick={() => {
              // From the rail, settings need somewhere to unfold — open the
              // overlay and the prefs section in one gesture.
              chrome.openPeek(true);
              if (!prefsOpen) onTogglePrefs();
            }}
            vertical
          />
        </div>
        {/* Breadcrumb context, demoted from the main horizontal workspace
            to quiet vertical text in the rail (the mymind reference) —
            rotated to read UPWARD, root always reachable, current world in
            bold: ALL ITEMS / TYPOGRAPHY. */}
        <div className="absolute top-56 bottom-4 left-0 right-0 flex flex-col items-center justify-start select-none">
          <button
            onClick={() => setSelectedView({ kind: "all" })}
            className="font-mono text-[10px] uppercase tracking-[0.18em] whitespace-nowrap text-muted/70 hover:text-ink"
            style={{ writingMode: "vertical-rl", transform: "rotate(180deg)" }}
            title="Back to all items"
          >
            {/* Rotated vertical-rl puts the FIRST DOM content at the
                bottom — so reading upward gives ALL ITEMS / NAME, root
                first, exactly the breadcrumb order. */}
            {selectedView.kind === "collection" ? (
              <>
                <span>All items</span>
                <span className="text-muted/50">{" / "}</span>
                <span className="font-bold text-ink/80">
                  {viewLabel(state)} · {totalShownLabel}
                </span>
              </>
            ) : (
              <span className="font-bold text-ink/70">
                {viewLabel(state)} · {totalShownLabel}
              </span>
            )}
          </button>
        </div>
      </div>

      <AnimatePresence>
        {chrome.overlayVisible && (
          <motion.aside
            id="sidebar-overlay"
            data-sidebar-overlay
            style={{ transformOrigin: "top left" }}
            initial={{ opacity: 0, scaleX: 0.35, scaleY: 0.85 }}
            animate={{
              opacity: 1,
              scaleX: 1,
              scaleY: 1,
              transition: { duration: 0.18, ease: [0.22, 1, 0.36, 1] },
            }}
            exit={{
              opacity: 0,
              scaleX: 0.5,
              scaleY: 0.9,
              transition: { duration: 0.12, ease: [0.55, 0, 0.55, 0.2] },
            }}
            onPointerEnter={chrome.holdOpen}
            onPointerLeave={chrome.scheduleClose}
            className="fixed left-2 top-2 bottom-2 w-64 z-40 flex flex-col rounded-2xl border border-line/70 bg-panel/95 backdrop-blur shadow-cardHover overflow-hidden"
            aria-label="Collections"
          >
            {sidebarBody("overlay")}
          </motion.aside>
        )}
      </AnimatePresence>
    </>
  );
}

/** Human name of the current view for the capsule tooltip. */
function viewLabel(state: { selectedView: ViewSelection; collections: Record<string, Collection> }): string {
  const v = state.selectedView;
  if (v.kind === "all") return "All items";
  if (v.kind === "unclassified") return "Unclassified";
  if (v.kind === "similar") return "Similar view";
  return state.collections[v.collectionId]?.name ?? "Collection";
}

