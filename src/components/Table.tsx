import { memo, useRef, useState } from "react";
import { useVirtualizer } from "@tanstack/react-virtual";
import type { DesignObject, FacetField } from "../types";
import { pickDistinctiveTags } from "../lib/tagDistinctiveness";

const ROW_HEIGHT = 44;
const VISIBLE_TAG_LIMIT = 4;

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
}: {
  objects: DesignObject[];
  facetColumns: FacetField[];
  tagFrequency: Map<string, number>;
  onOpen: (id: string) => void;
  emptyLabel?: string;
}) {
  const parentRef = useRef<HTMLDivElement>(null);

  const virtualizer = useVirtualizer({
    count: objects.length,
    getScrollElement: () => parentRef.current,
    estimateSize: () => ROW_HEIGHT,
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
    <div
      ref={parentRef}
      className="h-full overflow-auto border border-line rounded-card bg-panel"
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
            const object = objects[virtualRow.index];
            return (
              <div
                key={object.id}
                style={{
                  position: "absolute",
                  top: 0,
                  left: 0,
                  width: "100%",
                  height: virtualRow.size,
                  transform: `translateY(${virtualRow.start}px)`,
                }}
              >
                <TableRow
                  object={object}
                  facetColumns={facetColumns}
                  tagFrequency={tagFrequency}
                  onOpen={onOpen}
                />
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
}
