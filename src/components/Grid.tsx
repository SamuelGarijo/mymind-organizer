import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { DesignObject, FacetField } from "../types";
import { Card } from "./Card";
import { useStore } from "../store";
import { assignMasonryColumns, columnsForWidth, GRID_GAP } from "../lib/masonry";
import { groupObjects, ITEM_TYPE_GROUP } from "../lib/grouping";
import { MarqueeOverlay, useObjectSelection } from "../lib/useObjectSelection";

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
  facetColumns,
  tagFrequency,
  viewKey,
  onOpen,
  emptyLabel,
  zoom = 0,
  groupBy = null,
  minColumnWidth,
  hideTags = false,
}: {
  objects: DesignObject[];
  /** Role field packages present in the current view — same prop Table
   * already takes, needed here too now that Grid can group (issue #98). */
  facetColumns: FacetField[];
  tagFrequency: Map<string, number>;
  /** Grouping lens — now store-owned (TopBar's filter popover sets it), so
   * Grid just renders whatever lens is active instead of owning a local
   * dropdown (design-philosophy: group-by lives inside the filters). */
  groupBy?: string | null;
  /** Identifies the logical view (e.g. JSON.stringify(selectedView)) — reset
   * keys off this, not `objects` itself. `objects` gets a new array identity
   * on every search/facet keystroke without the view actually changing, and
   * resetting on that snapped the progressive reveal back to 80 items mid-
   * type (the "choppy" re-appearing the perf audit flagged). */
  viewKey: string;
  onOpen: (id: string) => void;
  emptyLabel?: string;
  /** Item-size control (App.tsx header +/−) — a delta on top of the
   * container-width breakpoint column count, not an absolute value, so
   * resizing the window/sidebar still adapts around whatever zoom is set. */
  zoom?: number;
  /** Split view (canvas open): floor for a column's width so thumbnails
   * never crush below recognizability, whatever the zoom says. */
  minColumnWidth?: number;
  /** Split view: the slit is for recognizing/dragging — tags are noise
   * at that width. */
  hideTags?: boolean;
}) {
  // With a full mymind library (~8000 objects) mounting every card at once
  // makes the whole app crawl. Render in batches instead: the sentinel div
  // below the grid grows the count as it scrolls into range, so only what's
  // near the viewport ever exists in the DOM.
  const [renderCount, setRenderCount] = useState(INITIAL_COUNT);
  const sentinelRef = useRef<HTMLDivElement>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  const containerWidth = useContainerWidth(containerRef);
  const groupByField = groupBy;

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

  // Memoized (not just a plain slice) so its reference only changes when
  // `objects`/`renderCount` actually do — a marquee drag re-renders Grid on
  // every qualifying mousemove (see handleMarqueeMouseDown below) via its own
  // local `marqueeRect` state, and an unstable `visible` would cascade into
  // a new `handleCardClick` and defeat every Card's memoization on each of
  // those renders, re-rendering the whole mounted set instead of just the
  // handful of cards whose selection membership actually flipped.
  const visible = useMemo(
    () => (renderCount < objects.length ? objects.slice(0, renderCount) : objects),
    [objects, renderCount]
  );
  let columnCount = Math.max(1, Math.min(8, columnsForWidth(containerWidth) + zoom));
  // Split view (canvas open): never let zoom crush thumbnails below a
  // readable minimum — the slit is for RECOGNIZING and dragging things,
  // not for dense browsing.
  if (minColumnWidth) {
    columnCount = Math.max(1, Math.min(columnCount, Math.floor(containerWidth / minColumnWidth) || 1));
  }
  const columnWidth = (containerWidth - (columnCount - 1) * GRID_GAP) / columnCount;

  // Greedy shortest-column placement (see lib/masonry.ts) — a pure function
  // of the ordered prefix, so loading more items via the sentinel below
  // extends this without reshuffling anything already on screen. Ungrouped
  // path: one flat masonry over everything currently revealed, exactly as
  // before #98.
  const columns = useMemo(
    () => (groupByField ? null : assignMasonryColumns(visible, columnCount, columnWidth)),
    [visible, columnCount, columnWidth, groupByField]
  );

  // Grouped path (issue #98): the same placement run separately per group,
  // sharing the exact partition/order logic Table's grouping already uses
  // (lib/grouping.ts) so both views group identically. Progressive reveal
  // stays global — it grows the shared `visible` prefix, not a per-section
  // one — so a section's count reflects "how much of it has been revealed
  // so far", same thing the page's own "Showing X of Y" sentinel already
  // communicates below. A per-section reveal would need a separate
  // IntersectionObserver (and renderCount) per group, which buys accurate
  // per-group counts at real complexity cost for something the issue itself
  // flagged as an open implementation question, not a firm requirement.
  const sections = useMemo(() => {
    if (!groupByField) return null;
    return groupObjects(visible, groupByField, facetColumns).map((group) => ({
      ...group,
      columns: assignMasonryColumns(group.objects, columnCount, columnWidth),
    }));
  }, [visible, groupByField, facetColumns, columnCount, columnWidth]);

  // Shift-click range order (issue #103) follows whatever's actually on
  // screen top-to-bottom: `visible`'s own reading order when ungrouped,
  // or each section's objects back-to-back when grouped — same convention
  // Table's grouped shift-range already uses (#102).
  const orderedIds = useMemo(
    () => (sections ? sections.flatMap((s) => s.objects.map((o) => o.id)) : visible.map((o) => o.id)),
    [sections, visible]
  );

  // Finder-style selection (shift-range / cmd-toggle / marquee / ⌘A) —
  // one shared implementation, see lib/useObjectSelection.
  const { handleCardClick, handleMarqueeMouseDown, marqueeRect } = useObjectSelection({
    orderedIds,
    onOpen,
    containerRef,
    resetKey: `${viewKey}::${groupByField ?? ""}`,
  });

  if (objects.length === 0) {
    return (
      <div className="h-full flex items-center justify-center text-muted text-sm">
        {emptyLabel ?? "Nothing here yet."}
      </div>
    );
  }

  return (
    <>
      <div ref={containerRef} onMouseDown={handleMarqueeMouseDown}>
        {sections ? (
          <div className="space-y-6">
            {sections.map((section) => (
              <div key={section.label}>
                <div className="mb-2 flex items-center text-[11px] font-medium uppercase tracking-wide text-muted">
                  {section.label}
                  <span className="ml-1.5 text-muted/70 normal-case">
                    ({section.objects.length})
                  </span>
                </div>
                <div className="flex items-start" style={{ gap: GRID_GAP }}>
                  {section.columns.map((column, i) => (
                    <div
                      key={i}
                      className="flex-1 min-w-0 flex flex-col"
                      style={{ gap: GRID_GAP }}
                    >
                      {column.map((obj) => (
                        <Card
                          key={obj.id}
                          object={obj}
                          tagFrequency={tagFrequency}
                          onOpen={onOpen}
                          onCardClick={handleCardClick}
                          hideTags={hideTags}
                        />
                      ))}
                    </div>
                  ))}
                </div>
              </div>
            ))}
          </div>
        ) : (
          <div className="flex items-start" style={{ gap: GRID_GAP }}>
            {columns!.map((column, i) => (
              <div key={i} className="flex-1 min-w-0 flex flex-col" style={{ gap: GRID_GAP }}>
                {column.map((obj) => (
                  <Card
                    key={obj.id}
                    object={obj}
                    tagFrequency={tagFrequency}
                    onOpen={onOpen}
                    onCardClick={handleCardClick}
                    hideTags={hideTags}
                  />
                ))}
              </div>
            ))}
          </div>
        )}
      </div>
      {renderCount < objects.length && (
        <div ref={sentinelRef} className="py-6 text-center text-[12px] text-muted">
          Showing {visible.length.toLocaleString()} of {objects.length.toLocaleString()} — scroll
          for more
        </div>
      )}
      <MarqueeOverlay rect={marqueeRect} />
    </>
  );
}
