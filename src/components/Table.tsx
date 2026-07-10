import { memo, useEffect, useMemo, useRef, useState } from "react";
import { useVirtualizer } from "@tanstack/react-virtual";
import type { DesignObject, FacetField } from "../types";
import { pickDistinctiveTags } from "../lib/tagDistinctiveness";

const ROW_HEIGHT = 44;
const GROUP_HEADER_HEIGHT = 32;
const VISIBLE_TAG_LIMIT = 4;
const UNGROUPED_LABEL = "—";

type FlatRow =
  | { kind: "header"; label: string; count: number }
  | { kind: "item"; object: DesignObject };

/** Partitions objects by their value for `groupByField`, preserving each
 * object's existing relative order within its group (the caller's list is
 * already recency-sorted). Groups are ordered by the field's own defined
 * `options` order when it's a select field (so "Role" groups render as
 * photo/author/book… in the order the schema author actually chose, not
 * alphabetically) — anything else falls back to alphabetical. */
function buildFlatRows(
  objects: DesignObject[],
  groupByField: string | null,
  facetColumns: FacetField[]
): FlatRow[] {
  if (!groupByField) return objects.map((object) => ({ kind: "item", object }));

  const groups = new Map<string, DesignObject[]>();
  for (const object of objects) {
    const value = object.fields[groupByField] || UNGROUPED_LABEL;
    (groups.get(value) ?? groups.set(value, []).get(value)!).push(object);
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
  return rows;
}

// Memoized for the same reason as Card: with ~8000 rows possible, skipping
// re-render for unchanged rows keeps scrolling/typing responsive.
const TableRow = memo(function TableRow({
  object,
  facetColumns,
  tagFrequency,
  onOpen,
}: {
  object: DesignObject;
  facetColumns: FacetField[];
  tagFrequency: Map<string, number>;
  onOpen: (id: string) => void;
}) {
  const [imageFailed, setImageFailed] = useState(false);
  const showImage = object.imageUrl && !imageFailed;

  return (
    <div
      onClick={() => onOpen(object.id)}
      className="flex items-center gap-3 px-3 border-b border-line/60 hover:bg-line/30 cursor-pointer text-[13px]"
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
        title={object.fields.entity_type ?? ""}
      >
        {object.fields.entity_type || "—"}
      </span>
      <span className="w-56 shrink-0 truncate text-muted" title={object.tags.join(", ")}>
        {pickDistinctiveTags(object.tags, tagFrequency, VISIBLE_TAG_LIMIT)
          .map((t) => `#${t}`)
          .join(" ") || "—"}
      </span>
      {facetColumns.map((f) => (
        <span
          key={f.name}
          className="w-28 shrink-0 truncate"
          title={object.fields[f.name] ?? ""}
        >
          {object.fields[f.name] || "—"}
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

  useEffect(() => {
    setGroupByField(null);
  }, [viewKey]);

  const flatRows = useMemo(
    () => buildFlatRows(objects, groupByField, facetColumns),
    [objects, groupByField, facetColumns]
  );

  const virtualizer = useVirtualizer({
    count: flatRows.length,
    getScrollElement: () => parentRef.current,
    estimateSize: (index) =>
      flatRows[index].kind === "header" ? GROUP_HEADER_HEIGHT : ROW_HEIGHT,
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

  return (
    <div className="h-full flex flex-col">
      {facetColumns.length > 0 && (
        <div className="shrink-0 flex items-center gap-1.5 mb-2 text-[12px]">
          <span className="text-muted">Group by</span>
          <select
            value={groupByField ?? ""}
            onChange={(e) => setGroupByField(e.target.value || null)}
            className="rounded-lg border border-line px-2 py-1 text-[12px] bg-panel outline-none focus:border-accent"
          >
            <option value="">None</option>
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
              return (
                <div
                  key={row.kind === "header" ? `group:${row.label}` : row.object.id}
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
                    <div className="h-full flex items-center px-3 bg-line/30 text-[11px] font-medium uppercase tracking-wide text-muted">
                      {row.label}
                      <span className="ml-1.5 text-muted/70 normal-case">({row.count})</span>
                    </div>
                  ) : (
                    <TableRow
                      object={row.object}
                      facetColumns={facetColumns}
                      tagFrequency={tagFrequency}
                      onOpen={onOpen}
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
