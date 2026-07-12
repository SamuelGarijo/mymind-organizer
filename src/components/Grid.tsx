import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { DesignObject, FacetField } from "../types";
import { Card } from "./Card";
import { useStore } from "../store";
import { assignMasonryColumns, columnsForWidth, GRID_GAP } from "../lib/masonry";
import { groupObjects, ITEM_TYPE_GROUP } from "../lib/grouping";
import { GroupBySelect } from "./GroupBySelect";

const INITIAL_COUNT = 80;
const BATCH_SIZE = 120;

/** Below this many pixels of movement, a mousedown→mouseup on empty
 * background reads as a plain click (clears selection) rather than a
 * marquee (issue #103) — keeps a single-pixel jitter from flashing a
 * selection rectangle. */
const MARQUEE_THRESHOLD = 4;

type Rect = { x0: number; y0: number; x1: number; y1: number };

function rectsIntersect(a: Rect, b: DOMRect): boolean {
  return b.left < a.x1 && b.right > a.x0 && b.top < a.y1 && b.bottom > a.y0;
}

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
}: {
  objects: DesignObject[];
  /** Role field packages present in the current view — same prop Table
   * already takes, needed here too now that Grid can group (issue #98). */
  facetColumns: FacetField[];
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
  const [marqueeRect, setMarqueeRect] = useState<Rect | null>(null);
  const [groupByField, setGroupByField] = useState<string | null>(null);

  useEffect(() => {
    setRenderCount(INITIAL_COUNT);
  }, [viewKey]);

  useEffect(() => {
    setGroupByField(null);
  }, [viewKey]);

  // A range/marquee selection is only meaningful against the objects
  // currently on screen — switching views, or regrouping (which reshuffles
  // visual order into sections), drops any leftover selection rather than
  // carrying it somewhere it no longer visually corresponds to (same
  // reasoning as Table's identical effect, issue #98).
  useEffect(() => {
    useStore.getState().setSelection(new Set(), null);
  }, [viewKey, groupByField]);

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
  const columnCount = columnsForWidth(containerWidth);
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

  // Finder-style click handling (issue #103): plain click opens the object
  // and drops any selection; Shift ranges from the last plain/Cmd-clicked
  // anchor to this card in `orderedIds`; Cmd/Ctrl toggles just this card
  // in/out without touching the rest. Card itself stays modifier-agnostic
  // and just forwards the event.
  const handleCardClick = useCallback(
    (id: string, e: React.MouseEvent) => {
      const { selectedObjectIds, selectionAnchorId, setSelection } = useStore.getState();
      if (e.shiftKey) {
        const anchor = selectionAnchorId ?? id;
        const anchorIdx = orderedIds.indexOf(anchor);
        const targetIdx = orderedIds.indexOf(id);
        if (anchorIdx === -1 || targetIdx === -1) {
          setSelection(new Set([id]), id);
          return;
        }
        const [start, end] =
          anchorIdx <= targetIdx ? [anchorIdx, targetIdx] : [targetIdx, anchorIdx];
        setSelection(new Set(orderedIds.slice(start, end + 1)), anchor);
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
    [orderedIds, onOpen]
  );

  // Rectangle multi-select over empty grid background (issue #103). Global
  // mousemove/mouseup listeners (not React handlers) so the drag keeps
  // tracking even once the cursor leaves the grid's own bounds — very
  // common with a fast marquee gesture. Scoped to card hit-testing via each
  // card's own `data-object-id` + getBoundingClientRect, since only
  // currently-mounted cards (see the batched-render comment above) can be
  // selected this way — matches how any virtualized grid's selection works.
  const handleMarqueeMouseDown = useCallback((e: React.MouseEvent<HTMLDivElement>) => {
    if (e.button !== 0) return;
    if ((e.target as HTMLElement).closest("[data-object-id]")) return;
    const start = { x: e.clientX, y: e.clientY };
    let didDrag = false;
    const onMove = (ev: MouseEvent) => {
      const rect: Rect = {
        x0: Math.min(start.x, ev.clientX),
        y0: Math.min(start.y, ev.clientY),
        x1: Math.max(start.x, ev.clientX),
        y1: Math.max(start.y, ev.clientY),
      };
      if (!didDrag && rect.x1 - rect.x0 < MARQUEE_THRESHOLD && rect.y1 - rect.y0 < MARQUEE_THRESHOLD) {
        return;
      }
      didDrag = true;
      setMarqueeRect(rect);
      const ids = new Set<string>();
      containerRef.current?.querySelectorAll("[data-object-id]").forEach((el) => {
        if (rectsIntersect(rect, el.getBoundingClientRect())) {
          ids.add((el as HTMLElement).dataset.objectId!);
        }
      });
      useStore.getState().setSelection(ids, null);
    };
    const onUp = () => {
      // Never crossed the movement threshold — a plain click on empty
      // background, not a drag. Finder clears the selection for that too.
      if (!didDrag) useStore.getState().setSelection(new Set(), null);
      setMarqueeRect(null);
      window.removeEventListener("mousemove", onMove);
      window.removeEventListener("mouseup", onUp);
    };
    window.addEventListener("mousemove", onMove);
    window.addEventListener("mouseup", onUp);
  }, []);

  if (objects.length === 0) {
    return (
      <div className="h-full flex items-center justify-center text-muted text-sm">
        {emptyLabel ?? "Nothing here yet."}
      </div>
    );
  }

  const hasRoles = objects.some((o) => o.role);

  return (
    <>
      <GroupBySelect
        value={groupByField}
        onChange={setGroupByField}
        hasRoles={hasRoles}
        facetColumns={facetColumns}
      />
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
      {marqueeRect && (
        <div
          className="fixed border border-accent bg-accent/10 pointer-events-none z-50"
          style={{
            left: marqueeRect.x0,
            top: marqueeRect.y0,
            width: marqueeRect.x1 - marqueeRect.x0,
            height: marqueeRect.y1 - marqueeRect.y0,
          }}
        />
      )}
    </>
  );
}
