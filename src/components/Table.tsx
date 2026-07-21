import { memo, useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useVirtualizer } from "@tanstack/react-virtual";
import type { DesignObject, FacetField } from "../types";
import { pickDistinctiveTags } from "../lib/tagDistinctiveness";
import { asFieldString } from "../lib/mymindSync";
import { useStore } from "../store";
import { DRAG_MIME, objectDragProps } from "../lib/objectDrag";
import {
  groupObjects,
  ITEM_TYPE_GROUP,
  SORT_BY_TITLE,
  sortObjects,
  UNGROUPED_LABEL,
  type SortRule,
} from "../lib/grouping";

export { ITEM_TYPE_GROUP };

const ROW_HEIGHT = 44;
const GROUP_HEADER_HEIGHT = 32;
const VISIBLE_TAG_LIMIT = 4;
/** Sentinel dragOverGroup value for the trailing "+ new value" row — not a
 * real group label, so it can't collide with one. */
const NEW_VALUE_DROP_KEY = "__new_value__";

/** Plain-text display for a facet cell — a multi-select field's value
 * (issue #99) is an array; every other field is already a string. */
function displayFieldValue(value: string | string[] | undefined): string {
  return Array.isArray(value) ? value.join(", ") : value ?? "";
}

type FlatRow =
  | { kind: "header"; label: string; count: number }
  | { kind: "item"; object: DesignObject }
  | { kind: "newValue" };

/** Flattens the shared grouped partition (lib/grouping.ts) into Table's own
 * header/item/newValue row shape for its linear virtualizer. Grouping by a
 * real facet field (not item type) appends a trailing "+ new value" row —
 * the drop target that creates a bucket that doesn't exist yet (#102). */
function buildFlatRows(
  objects: DesignObject[],
  groupByField: string | null,
  facetColumns: FacetField[]
): FlatRow[] {
  if (!groupByField) return objects.map((object) => ({ kind: "item", object }));

  const groups = groupObjects(objects, groupByField, facetColumns);
  const rows: FlatRow[] = [];
  for (const { label, objects: members } of groups) {
    rows.push({ kind: "header", label, count: members.length });
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
  showType,
  showTags,
  tagFrequency,
  onOpen,
  onRowClick,
}: {
  object: DesignObject;
  /** Already filtered down to visible-only columns (issue #119's column
   * show/hide) — Table itself decides what's hidden, this just renders
   * whatever it's given. */
  facetColumns: FacetField[];
  showType: boolean;
  showTags: boolean;
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
        // Dragging a selected row carries the whole selection; dragging
        // anything else carries just itself — identical contract to
        // Card.tsx (issue #103), shared mechanics from lib/objectDrag
        // (issue #132's unified model).
        const { selectedObjectIds } = useStore.getState();
        const ids =
          selectedObjectIds.has(object.id) && selectedObjectIds.size > 1
            ? Array.from(selectedObjectIds)
            : [object.id];
        objectDragProps(ids).onDragStart(e);
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
      {showType && (
        <span
          className="w-32 shrink-0 truncate text-muted"
          title={asFieldString(object.fields.entity_type)}
        >
          {asFieldString(object.fields.entity_type) || "—"}
        </span>
      )}
      {showTags && (
        <span className="w-56 shrink-0 truncate text-muted" title={object.tags.join(", ")}>
          {pickDistinctiveTags(object.tags, tagFrequency, VISIBLE_TAG_LIMIT)
            .map((t) => `#${t}`)
            .join(" ") || "—"}
        </span>
      )}
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
  groupBy = null,
}: {
  objects: DesignObject[];
  facetColumns: FacetField[];
  tagFrequency: Map<string, number>;
  onOpen: (id: string) => void;
  emptyLabel?: string;
  /** Identifies the logical view — see Grid's identical prop. Resets
   * view-local presentation state on a real view change without reacting
   * to `objects` merely getting a new array identity from a keystroke. */
  viewKey: string;
  /** Grouping lens — store-owned now (TopBar's filter popover sets it),
   * same prop as Grid's. */
  groupBy?: string | null;
}) {
  const parentRef = useRef<HTMLDivElement>(null);
  const groupByField = groupBy;
  // Highlights whichever bucket (group header, or the trailing "+ new
  // value" row via NEW_VALUE_DROP_KEY) is currently under a drag.
  const [dragOverGroup, setDragOverGroup] = useState<string | null>(null);
  // A drop on the "+ new value" row waits for a name before doing anything
  // — these hold that in-progress state (issue #102).
  const [pendingNewValueIds, setPendingNewValueIds] = useState<string[] | null>(null);
  const [newValueDraft, setNewValueDraft] = useState("");
  // Multi-sort (issue #119) — a primary field plus an optional tiebreaker,
  // both resettable per-view like groupByField. Not persisted to the store:
  // this is view-local presentation state, same footing as grouping.
  const [sortRules, setSortRules] = useState<SortRule[]>([]);
  // Column show/hide (issue #119) — keys are "type"/"tags" for the two
  // built-in columns or a facet field's own name.
  const [hiddenColumns, setHiddenColumns] = useState<Set<string>>(new Set());
  const [sortMenuOpen, setSortMenuOpen] = useState(false);
  const [columnsMenuOpen, setColumnsMenuOpen] = useState(false);
  const controlsRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!sortMenuOpen && !columnsMenuOpen) return;
    function handleClick(e: MouseEvent) {
      if (controlsRef.current && !controlsRef.current.contains(e.target as Node)) {
        setSortMenuOpen(false);
        setColumnsMenuOpen(false);
      }
    }
    document.addEventListener("mousedown", handleClick);
    return () => document.removeEventListener("mousedown", handleClick);
  }, [sortMenuOpen, columnsMenuOpen]);

  useEffect(() => {
    setSortRules([]);
    setHiddenColumns(new Set());
  }, [viewKey]);

  // A range/selection only makes sense against what's currently on screen —
  // both a view switch and a regroup (which reshuffles row order) drop any
  // leftover selection, same reasoning as Grid's identical effect (#103).
  useEffect(() => {
    useStore.getState().setSelection(new Set(), null);
  }, [viewKey, groupByField]);

  // Cmd/Ctrl+A selects every row in the current filtered view (issue #117),
  // same convention as Grid's identical handler — reaches rows that haven't
  // scrolled into range yet, which a shift-click range can't do on its own.
  useEffect(() => {
    function handleKeyDown(e: KeyboardEvent) {
      if (!(e.metaKey || e.ctrlKey) || e.key.toLowerCase() !== "a") return;
      const target = e.target as HTMLElement;
      if (target.closest("input, textarea, [contenteditable='true']")) return;
      if (useStore.getState().detailObjectId) return;
      e.preventDefault();
      useStore.getState().setSelection(new Set(objects.map((o) => o.id)), null);
    }
    document.addEventListener("keydown", handleKeyDown);
    return () => document.removeEventListener("keydown", handleKeyDown);
  }, [objects]);

  // An in-progress "name this new bucket" prompt stops making sense the
  // moment the grouped field itself changes underneath it.
  useEffect(() => {
    setPendingNewValueIds(null);
    setNewValueDraft("");
  }, [groupByField]);

  const sortedObjects = useMemo(() => sortObjects(objects, sortRules), [objects, sortRules]);

  const flatRows = useMemo(
    () => buildFlatRows(sortedObjects, groupByField, facetColumns),
    [sortedObjects, groupByField, facetColumns]
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

  const showType = !hiddenColumns.has("type");
  const showTags = !hiddenColumns.has("tags");
  const visibleFacetColumns = facetColumns.filter((f) => !hiddenColumns.has(f.name));

  // Fixed-width columns (type/tags/facets) plus a title that needs real
  // room to be readable — on a narrow window that adds up to more than the
  // viewport, so this scrolls horizontally instead of squeezing the title
  // into a couple of characters.
  const minWidth =
    220 + (showType ? 128 : 0) + (showTags ? 224 : 0) + visibleFacetColumns.length * 112 + 36;

  const sortableFields = [{ name: "Title", key: SORT_BY_TITLE }, ...facetColumns.map((f) => ({ name: f.name, key: f.name }))];

  return (
    <div className="h-full flex flex-col">
      <div className="flex items-center gap-3 flex-wrap" ref={controlsRef}>
        <div className="relative mb-2">
          <button
            onClick={() => {
              setSortMenuOpen((v) => !v);
              setColumnsMenuOpen(false);
            }}
            className="text-[12px] rounded-lg border border-line px-2 py-1 bg-panel hover:bg-line/40"
          >
            Sort{sortRules.length > 0 ? ` (${sortRules.length})` : ""}
          </button>
          {sortMenuOpen && (
            <div className="absolute z-20 top-full mt-1 left-0 w-64 rounded-lg border border-line bg-panel shadow-lg p-2 text-[12px]">
              {sortableFields.length === 0 ? (
                <p className="text-muted">No sortable fields.</p>
              ) : (
                [0, 1].map((i) => {
                  const rule = sortRules[i];
                  if (i > 0 && !sortRules[0]) return null;
                  const usedKey = sortRules[i - 1]?.field;
                  return (
                    <div key={i} className="flex items-center gap-1 mb-1">
                      <span className="text-muted shrink-0">{i === 0 ? "Sort by" : "then by"}</span>
                      <select
                        value={rule?.field ?? ""}
                        onChange={(e) => {
                          const field = e.target.value;
                          setSortRules((rules) => {
                            const next = rules.slice(0, i);
                            if (field) next[i] = { field, direction: rule?.direction ?? "asc" };
                            return next;
                          });
                        }}
                        className="flex-1 rounded border border-line px-1 py-0.5 bg-panel outline-none"
                      >
                        <option value="">{i === 0 ? "None" : "—"}</option>
                        {sortableFields
                          .filter((f) => f.key !== usedKey)
                          .map((f) => (
                            <option key={f.key} value={f.key}>
                              {f.name}
                            </option>
                          ))}
                      </select>
                      {rule && (
                        <button
                          onClick={() =>
                            setSortRules((rules) =>
                              rules.map((r, ri) =>
                                ri === i ? { ...r, direction: r.direction === "asc" ? "desc" : "asc" } : r
                              )
                            )
                          }
                          className="shrink-0 text-muted hover:text-ink px-1"
                          title="Toggle sort direction"
                        >
                          {rule.direction === "asc" ? "↑" : "↓"}
                        </button>
                      )}
                    </div>
                  );
                })
              )}
              {sortRules.length > 0 && (
                <button
                  onClick={() => setSortRules([])}
                  className="text-muted hover:text-ink underline decoration-dotted"
                >
                  clear sort
                </button>
              )}
            </div>
          )}
        </div>

        <div className="relative mb-2">
          <button
            onClick={() => {
              setColumnsMenuOpen((v) => !v);
              setSortMenuOpen(false);
            }}
            className="text-[12px] rounded-lg border border-line px-2 py-1 bg-panel hover:bg-line/40"
          >
            Columns
          </button>
          {columnsMenuOpen && (
            <div className="absolute z-20 top-full mt-1 left-0 w-48 rounded-lg border border-line bg-panel shadow-lg p-2 text-[12px] flex flex-col gap-1">
              {[{ key: "type", name: "Type" }, { key: "tags", name: "Tags" }, ...facetColumns.map((f) => ({ key: f.name, name: f.name }))].map(
                ({ key, name }) => (
                  <label key={key} className="flex items-center gap-1.5 cursor-pointer">
                    <input
                      type="checkbox"
                      checked={!hiddenColumns.has(key)}
                      onChange={() =>
                        setHiddenColumns((prev) => {
                          const next = new Set(prev);
                          if (next.has(key)) next.delete(key);
                          else next.add(key);
                          return next;
                        })
                      }
                    />
                    {name}
                  </label>
                )
              )}
            </div>
          )}
        </div>
      </div>
      <div
        ref={parentRef}
        data-content-scroll
        className="flex-1 min-h-0 overflow-auto border border-line rounded-card bg-panel"
      >
        <div style={{ minWidth }}>
          <div className="sticky top-0 z-10 flex items-center gap-3 border-b border-line bg-panel px-3 py-2 text-[11px] font-medium uppercase tracking-wide text-muted">
            <span className="w-9 shrink-0" />
            <span className="flex-1 min-w-[180px]">Title</span>
            {/* mymind's entity_type is the MEDIA type (Article, Image…) —
             * §4: never share a label with the role ("Entity type"). */}
            {showType && <span className="w-32 shrink-0">Media type</span>}
            {showTags && <span className="w-56 shrink-0">Tags</span>}
            {visibleFacetColumns.map((f) => (
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
                      facetColumns={visibleFacetColumns}
                      showType={showType}
                      showTags={showTags}
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
