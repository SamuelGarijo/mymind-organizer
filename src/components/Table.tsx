import { memo, useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useVirtualizer } from "@tanstack/react-virtual";
import type { DesignObject, FacetField } from "../types";
import { pickDistinctiveTags } from "../lib/tagDistinctiveness";
import { asFieldString } from "../lib/mymindSync";
import { useStore } from "../store";
import { DRAG_MIME } from "./Sidebar";

const ROW_HEIGHT = 44;
const GROUP_HEADER_HEIGHT = 32;
const VISIBLE_TAG_LIMIT = 4;
const UNGROUPED_LABEL = "—";
/** Sentinel dragOverGroup value for the trailing "+ new value" row — not a
 * real group label, so it can't collide with one. */
const NEW_VALUE_DROP_KEY = "__new_value__";

/** Plain-text display for a facet cell — a multi-select field's value
 * (issue #99) is an array; every other field is already a string. */
function displayFieldValue(value: string | string[] | undefined): string {
  return Array.isArray(value) ? value.join(", ") : value ?? "";
}

/** Sentinel group-by key for the object's item type (`object.role`, issue
 * #84) — deliberately not a valid field name, so it can never collide with
 * a real facet field called "role" or "Item type". */
export const ITEM_TYPE_GROUP = "__item_type__";

type FlatRow =
  | { kind: "header"; label: string; count: number }
  | { kind: "item"; object: DesignObject }
  | { kind: "newValue" };

/** Partitions objects by their value for `groupByField` (or by item type,
 * for the ITEM_TYPE_GROUP sentinel), preserving each object's existing
 * relative order within its group (the caller's list is already
 * recency-sorted). Groups are ordered by the field's own defined `options`
 * order when it's a select field — anything else (item types included)
 * falls back to alphabetical. Grouping by a real facet field (not item
 * type) appends a trailing "+ new value" row — the drop target that
 * creates a bucket that doesn't exist yet (issue #102). */
function buildFlatRows(
  objects: DesignObject[],
  groupByField: string | null,
  facetColumns: FacetField[]
): FlatRow[] {
  if (!groupByField) return objects.map((object) => ({ kind: "item", object }));

  const groups = new Map<string, DesignObject[]>();
  const addToGroup = (value: string, object: DesignObject) => {
    (groups.get(value) ?? groups.set(value, []).get(value)!).push(object);
  };
  for (const object of objects) {
    const raw = groupByField === ITEM_TYPE_GROUP ? object.role : object.fields[groupByField];
    if (Array.isArray(raw)) {
      // Multi-select (issue #99): an object with several values shows up
      // under each of its groups — same multi-membership every other
      // tag-like grouping in this app already has, not confined to one.
      if (raw.length === 0) addToGroup(UNGROUPED_LABEL, object);
      else for (const value of raw) addToGroup(value, object);
    } else {
      addToGroup(raw || UNGROUPED_LABEL, object);
    }
  }

  const definedOrder = facetColumns.find((f) => f.name === groupByField)?.options ?? [];
  const groupKeys = Array.from(groups.keys()).sort((a, b) => {
    const ai = definedOrder.indexOf(a);
    const bi = definedOrder.indexOf(b);
    if (ai !== -1 && bi !== -1) return ai - bi;
    if (ai !== -1) return -1;
    if (bi !== -1) return 1;
    return a.localeCompare(b);
  });

  const rows: FlatRow[] = [];
  for (const key of groupKeys) {
    const members = groups.get(key)!;
    rows.push({ kind: "header", label: key, count: members.length });
    for (const object of members) rows.push({ kind: "item", object });
  }
  if (groupByField !== ITEM_TYPE_GROUP) rows.push({ kind: "newValue" });
  return rows;
}

// Memoized for the same reason as Card: with ~8000 rows possible, skipping
// re-render for unchanged rows keeps scrolling/typing responsive.
const TableRow = memo(function TableRow({
  object,
  facetColumns,
  tagFrequency,
  onOpen,
  onRowClick,
}: {
  object: DesignObject;
  facetColumns: FacetField[];
  tagFrequency: Map<string, number>;
  onOpen: (id: string) => void;
  /** Reports every click along with its modifier keys — the parent Table
   * owns the actual Finder-style selection logic (issue #102, mirroring
   * Grid/Card's #103 pattern), since that needs the full row order that
   * only it has. */
  onRowClick: (id: string, e: React.MouseEvent) => void;
}) {
  const [imageFailed, setImageFailed] = useState(false);
  const showImage = object.imageUrl && !imageFailed;
  // Scoped selector: only rows whose own membership flips re-render on a
  // selection change, same reasoning as Card's identical pattern.
  const isSelected = useStore((s) => s.selectedObjectIds.has(object.id));

  return (
    <div
      draggable
      onDragStart={(e) => {
        const { selectedObjectIds, sidebarCollapsed, setDragRevealSidebar } = useStore.getState();
        // Dragging a selected row carries the whole selection; dragging
        // anything else (nothing selected, or only this row) carries just
        // itself — identical contract to Card.tsx (issue #103).
        const ids =
          selectedObjectIds.has(object.id) && selectedObjectIds.size > 1
            ? Array.from(selectedObjectIds)
            : [object.id];
        e.dataTransfer.setData(DRAG_MIME, JSON.stringify(ids));
        e.dataTransfer.effectAllowed = "copy";
        if (sidebarCollapsed) setDragRevealSidebar(true);
      }}
      onDragEnd={() => useStore.getState().setDragRevealSidebar(false)}
      onClick={(e) => onRowClick(object.id, e)}
      data-object-id={object.id}
      className={[
        "flex items-center gap-3 px-3 border-b border-line/60 hover:bg-line/30 cursor-pointer text-[13px]",
        isSelected ? "ring-2 ring-inset ring-accent bg-accent/5" : "",
      ].join(" ")}
    >
      <div className="w-9 h-9 shrink-0 rounded bg-line/40 overflow-hidden">
        {showImage && (
          <img
            src={object.imageUrl}
            alt=""
            loading="lazy"
            className="w-full h-full object-cover"
            onError={() => setImageFailed(true)}
          />
        )}
      </div>
      <span className="flex-1 min-w-[180px] truncate font-medium" title={object.title}>
        {object.title}
      </span>
      <span
        className="w-32 shrink-0 truncate text-muted"
        title={asFieldString(object.fields.entity_type)}
      >
        {asFieldString(object.fields.entity_type) || "—"}
      </span>
      <span className="w-56 shrink-0 truncate text-muted" title={object.tags.join(", ")}>
        {pickDistinctiveTags(object.tags, tagFrequency, VISIBLE_TAG_LIMIT)
          .map((t) => `#${t}`)
          .join(" ") || "—"}
      </span>
      {facetColumns.map((f) => (
        // Empty cells render blank, not a "—" placeholder (issue #101) —
        // this object may simply not carry this column's role, or hasn't
        // had the field filled in yet.
        <span key={f.name} className="w-28 shrink-0 truncate" title={displayFieldValue(object.fields[f.name])}>
          {displayFieldValue(object.fields[f.name])}
        </span>
      ))}
    </div>
  );
});

/**
 * Row-based alternative to the masonry Grid, sharing the same filtered/
 * sorted object list. Uses real windowed virtualization (only rows in/near
 * the viewport are mounted) rather than Grid's progressive-reveal-and-keep
 * pattern — Grid can't do that cleanly because masonry card heights vary
 * with image aspect ratio, but table rows have one fixed height, which is
 * exactly the case @tanstack/react-virtual is built for.
 */
export function Table({
  objects,
  facetColumns,
  tagFrequency,
  onOpen,
  emptyLabel,
  viewKey,
}: {
  objects: DesignObject[];
  facetColumns: FacetField[];
  tagFrequency: Map<string, number>;
  onOpen: (id: string) => void;
  emptyLabel?: string;
  /** Identifies the logical view — see Grid's identical prop. Resets
   * groupByField on a real view change without reacting to `objects`
   * merely getting a new array identity from a search/facet keystroke. */
  viewKey: string;
}) {
  const parentRef = useRef<HTMLDivElement>(null);
  const [groupByField, setGroupByField] = useState<string | null>(null);
  // Highlights whichever bucket (group header, or the trailing "+ new
  // value" row via NEW_VALUE_DROP_KEY) is currently under a drag.
  const [dragOverGroup, setDragOverGroup] = useState<string | null>(null);
  // A drop on the "+ new value" row waits for a name before doing anything
  // — these hold that in-progress state (issue #102).
  const [pendingNewValueIds, setPendingNewValueIds] = useState<string[] | null>(null);
  const [newValueDraft, setNewValueDraft] = useState("");

  useEffect(() => {
    setGroupByField(null);
  }, [viewKey]);

  // A range/selection only makes sense against what's currently on screen —
  // both a view switch and a regroup (which reshuffles row order) drop any
  // leftover selection, same reasoning as Grid's identical effect (#103).
  useEffect(() => {
    useStore.getState().setSelection(new Set(), null);
  }, [viewKey, groupByField]);

  // An in-progress "name this new bucket" prompt stops making sense the
  // moment the grouped field itself changes underneath it.
  useEffect(() => {
    setPendingNewValueIds(null);
    setNewValueDraft("");
  }, [groupByField]);

  const flatRows = useMemo(
    () => buildFlatRows(objects, groupByField, facetColumns),
    [objects, groupByField, facetColumns]
  );

  // Finder-style click handling (issue #102, mirroring Grid's #103
  // pattern): plain click opens + clears selection; Shift ranges from the
  // last plain/Cmd-clicked anchor in the CURRENT flat row order (Table is
  // linear, so — unlike Grid's masonry — visual order and range order are
  // the same thing, headers included in the span but never selected
  // themselves); Cmd/Ctrl toggles just this row.
  const itemIds = useMemo(
    () => flatRows.filter((r): r is Extract<FlatRow, { kind: "item" }> => r.kind === "item").map((r) => r.object.id),
    [flatRows]
  );
  const handleRowClick = useCallback(
    (id: string, e: React.MouseEvent) => {
      const { selectedObjectIds, selectionAnchorId, setSelection } = useStore.getState();
      if (e.shiftKey) {
        const anchor = selectionAnchorId ?? id;
        const anchorIdx = itemIds.indexOf(anchor);
        const targetIdx = itemIds.indexOf(id);
        if (anchorIdx === -1 || targetIdx === -1) {
          setSelection(new Set([id]), id);
          return;
        }
        const [start, end] =
          anchorIdx <= targetIdx ? [anchorIdx, targetIdx] : [targetIdx, anchorIdx];
        setSelection(new Set(itemIds.slice(start, end + 1)), anchor);
        return;
      }
      if (e.metaKey || e.ctrlKey) {
        const next = new Set(selectedObjectIds);
        if (next.has(id)) next.delete(id);
        else next.add(id);
        setSelection(next, id);
        return;
      }
      setSelection(new Set(), null);
      onOpen(id);
    },
    [itemIds, onOpen]
  );

  // The field currently grouped on, when it's a real facet column (not
  // item type) — its type decides whether a bucket drop replaces the
  // value (select) or appends to it (multi-select, issue #99).
  const groupedField = useMemo(
    () => facetColumns.find((f) => f.name === groupByField),
    [facetColumns, groupByField]
  );
  const isBucketable = !!groupByField && groupByField !== ITEM_TYPE_GROUP;

  function handleBucketDrop(e: React.DragEvent, label: string) {
    e.preventDefault();
    setDragOverGroup(null);
    if (!isBucketable || !groupByField) return;
    const raw = e.dataTransfer.getData(DRAG_MIME);
    if (!raw) return;
    const ids: string[] = JSON.parse(raw);
    const value = label === UNGROUPED_LABEL ? "" : label;
    const mode = groupedField?.type === "multi-select" ? "append" : "replace";
    useStore.getState().assignFieldValue(ids, groupByField, value, mode);
  }

  function handleNewValueDrop(e: React.DragEvent) {
    e.preventDefault();
    setDragOverGroup(null);
    const raw = e.dataTransfer.getData(DRAG_MIME);
    if (!raw) return;
    setPendingNewValueIds(JSON.parse(raw));
  }

  function confirmNewValue() {
    const trimmed = newValueDraft.trim();
    if (!trimmed || !groupByField || !pendingNewValueIds) return;
    const { addFieldOption, assignFieldValue } = useStore.getState();
    addFieldOption(groupByField, trimmed);
    assignFieldValue(
      pendingNewValueIds,
      groupByField,
      trimmed,
      groupedField?.type === "multi-select" ? "append" : "replace"
    );
    setPendingNewValueIds(null);
    setNewValueDraft("");
  }

  function cancelNewValue() {
    setPendingNewValueIds(null);
    setNewValueDraft("");
  }

  const virtualizer = useVirtualizer({
    count: flatRows.length,
    getScrollElement: () => parentRef.current,
    estimateSize: (index) =>
      flatRows[index].kind === "item" ? ROW_HEIGHT : GROUP_HEADER_HEIGHT,
    overscan: 12,
  });

  if (objects.length === 0) {
    return (
      <div className="h-full flex items-center justify-center text-muted text-sm">
        {emptyLabel ?? "Nothing here yet."}
      </div>
    );
  }

  // Fixed-width columns (type/tags/facets) plus a title that needs real
  // room to be readable — on a narrow window that adds up to more than the
  // viewport, so this scrolls horizontally instead of squeezing the title
  // into a couple of characters.
  const minWidth = 220 + 128 + 224 + facetColumns.length * 112 + 36;

  const hasRoles = objects.some((o) => o.role);

  return (
    <div className="h-full flex flex-col">
      {(facetColumns.length > 0 || hasRoles) && (
        <div className="shrink-0 flex items-center gap-1.5 mb-2 text-[12px]">
          <span className="text-muted">Group by</span>
          <select
            value={groupByField ?? ""}
            onChange={(e) => setGroupByField(e.target.value || null)}
            className="rounded-lg border border-line px-2 py-1 text-[12px] bg-panel outline-none focus:border-accent"
          >
            <option value="">None</option>
            {hasRoles && <option value={ITEM_TYPE_GROUP}>Item type</option>}
            {facetColumns.map((f) => (
              <option key={f.name} value={f.name}>
                {f.name}
              </option>
            ))}
          </select>
        </div>
      )}
      <div
        ref={parentRef}
        className="flex-1 min-h-0 overflow-auto border border-line rounded-card bg-panel"
      >
        <div style={{ minWidth }}>
          <div className="sticky top-0 z-10 flex items-center gap-3 border-b border-line bg-panel px-3 py-2 text-[11px] font-medium uppercase tracking-wide text-muted">
            <span className="w-9 shrink-0" />
            <span className="flex-1 min-w-[180px]">Title</span>
            <span className="w-32 shrink-0">Type</span>
            <span className="w-56 shrink-0">Tags</span>
            {facetColumns.map((f) => (
              <span key={f.name} className="w-28 shrink-0 truncate" title={f.name}>
                {f.name}
              </span>
            ))}
          </div>
          <div style={{ height: virtualizer.getTotalSize(), position: "relative" }}>
            {virtualizer.getVirtualItems().map((virtualRow) => {
              const row = flatRows[virtualRow.index];
              const key =
                row.kind === "header"
                  ? `group:${row.label}`
                  : row.kind === "newValue"
                  ? "newValue"
                  : row.object.id;
              return (
                <div
                  key={key}
                  style={{
                    position: "absolute",
                    top: 0,
                    left: 0,
                    width: "100%",
                    height: virtualRow.size,
                    transform: `translateY(${virtualRow.start}px)`,
                  }}
                >
                  {row.kind === "header" ? (
                    <div
                      onDragOver={
                        isBucketable
                          ? (e) => {
                              e.preventDefault();
                              setDragOverGroup(row.label);
                            }
                          : undefined
                      }
                      onDragLeave={isBucketable ? () => setDragOverGroup(null) : undefined}
                      onDrop={isBucketable ? (e) => handleBucketDrop(e, row.label) : undefined}
                      className={[
                        "h-full flex items-center px-3 bg-line/30 text-[11px] font-medium uppercase tracking-wide text-muted",
                        dragOverGroup === row.label ? "ring-2 ring-inset ring-accent bg-accent/10" : "",
                      ].join(" ")}
                      title={
                        isBucketable
                          ? row.label === UNGROUPED_LABEL
                            ? "Drop here to clear this field"
                            : `Drop here to set this field to "${row.label}"`
                          : undefined
                      }
                    >
                      {row.label}
                      <span className="ml-1.5 text-muted/70 normal-case">({row.count})</span>
                    </div>
                  ) : row.kind === "newValue" ? (
                    <div
                      onDragOver={(e) => {
                        e.preventDefault();
                        setDragOverGroup(NEW_VALUE_DROP_KEY);
                      }}
                      onDragLeave={() => setDragOverGroup(null)}
                      onDrop={handleNewValueDrop}
                      className={[
                        "h-full flex items-center gap-2 px-3 text-[11px] text-muted border-t border-dashed border-line",
                        dragOverGroup === NEW_VALUE_DROP_KEY
                          ? "ring-2 ring-inset ring-accent bg-accent/10"
                          : "",
                      ].join(" ")}
                    >
                      {pendingNewValueIds ? (
                        <>
                          <span className="shrink-0 normal-case">
                            New value for {pendingNewValueIds.length} item
                            {pendingNewValueIds.length === 1 ? "" : "s"}:
                          </span>
                          <input
                            autoFocus
                            value={newValueDraft}
                            onChange={(e) => setNewValueDraft(e.target.value)}
                            onKeyDown={(e) => {
                              if (e.key === "Enter") confirmNewValue();
                              if (e.key === "Escape") cancelNewValue();
                            }}
                            placeholder="Value name…"
                            className="flex-1 min-w-0 rounded border border-line bg-panel px-1.5 py-0.5 text-[12px] normal-case outline-none focus:border-accent"
                          />
                          <button
                            onClick={confirmNewValue}
                            className="shrink-0 normal-case text-accent hover:underline"
                          >
                            Add
                          </button>
                          <button
                            onClick={cancelNewValue}
                            className="shrink-0 normal-case text-muted hover:text-ink"
                          >
                            Cancel
                          </button>
                        </>
                      ) : (
                        <span>+ drop here to create a new value</span>
                      )}
                    </div>
                  ) : (
                    <TableRow
                      object={row.object}
                      facetColumns={facetColumns}
                      tagFrequency={tagFrequency}
                      onOpen={onOpen}
                      onRowClick={handleRowClick}
                    />
                  )}
                </div>
              );
            })}
          </div>
        </div>
      </div>
    </div>
  );
}
