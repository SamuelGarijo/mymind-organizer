import { useEffect, useMemo, useRef, useState } from "react";
import type { DesignObject } from "../types";
import { Card } from "./Card";
import { assignMasonryColumns, columnsForWidth, GRID_GAP } from "../lib/masonry";

const INITIAL_COUNT = 80;
const BATCH_SIZE = 120;

/** Tracks the grid container's real pixel width via ResizeObserver — reacts
 * to both window resizes and sidebar collapse/expand (issue #70), neither of
 * which the old viewport-based CSS `columns-N` could see. Defaults to a
 * reasonable desktop guess before the first real measurement lands. */
function useContainerWidth(ref: React.RefObject<HTMLElement>): number {
  const [width, setWidth] = useState(1024);
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const observer = new ResizeObserver((entries) => {
      const w = entries[0]?.contentRect.width;
      if (w) setWidth(w);
    });
    observer.observe(el);
    return () => observer.disconnect();
  }, [ref]);
  return width;
}

export function Grid({
  objects,
  tagFrequency,
  viewKey,
  onOpen,
  emptyLabel,
}: {
  objects: DesignObject[];
  tagFrequency: Map<string, number>;
  /** Identifies the logical view (e.g. JSON.stringify(selectedView)) — reset
   * keys off this, not `objects` itself. `objects` gets a new array identity
   * on every search/facet keystroke without the view actually changing, and
   * resetting on that snapped the progressive reveal back to 80 items mid-
   * type (the "choppy" re-appearing the perf audit flagged). */
  viewKey: string;
  onOpen: (id: string) => void;
  emptyLabel?: string;
}) {
  // With a full mymind library (~8000 objects) mounting every card at once
  // makes the whole app crawl. Render in batches instead: the sentinel div
  // below the grid grows the count as it scrolls into range, so only what's
  // near the viewport ever exists in the DOM.
  const [renderCount, setRenderCount] = useState(INITIAL_COUNT);
  const sentinelRef = useRef<HTMLDivElement>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  const containerWidth = useContainerWidth(containerRef);

  useEffect(() => {
    setRenderCount(INITIAL_COUNT);
  }, [viewKey]);

  useEffect(() => {
    const el = sentinelRef.current;
    if (!el || renderCount >= objects.length) return;
    const observer = new IntersectionObserver(
      (entries) => {
        if (entries.some((e) => e.isIntersecting)) {
          setRenderCount((c) => Math.min(c + BATCH_SIZE, objects.length));
        }
      },
      { rootMargin: "1500px" }
    );
    observer.observe(el);
    return () => observer.disconnect();
  }, [objects.length, renderCount]);

  const visible = renderCount < objects.length ? objects.slice(0, renderCount) : objects;
  const columnCount = columnsForWidth(containerWidth);
  const columnWidth = (containerWidth - (columnCount - 1) * GRID_GAP) / columnCount;

  // Greedy shortest-column placement (see lib/masonry.ts) — a pure function
  // of the ordered prefix, so loading more items via the sentinel below
  // extends this without reshuffling anything already on screen.
  const columns = useMemo(
    () => assignMasonryColumns(visible, columnCount, columnWidth),
    [visible, columnCount, columnWidth]
  );

  if (objects.length === 0) {
    return (
      <div className="h-full flex items-center justify-center text-muted text-sm">
        {emptyLabel ?? "Nothing here yet."}
      </div>
    );
  }

  return (
    <>
      <div ref={containerRef} className="flex items-start" style={{ gap: GRID_GAP }}>
        {columns.map((column, i) => (
          <div key={i} className="flex-1 min-w-0 flex flex-col" style={{ gap: GRID_GAP }}>
            {column.map((obj) => (
              <Card key={obj.id} object={obj} tagFrequency={tagFrequency} onOpen={onOpen} />
            ))}
          </div>
        ))}
      </div>
      {renderCount < objects.length && (
        <div ref={sentinelRef} className="py-6 text-center text-[12px] text-muted">
          Showing {visible.length.toLocaleString()} of {objects.length.toLocaleString()} — scroll
          for more
        </div>
      )}
    </>
  );
}
