import { useCallback, useEffect, useState } from "react";
import { useStore } from "../store";

/**
 * Finder-style selection over a list of rendered objects — extracted from
 * Grid (issue #103) so every surface that lays cards out shares ONE
 * implementation instead of reinventing (or, as happened on the
 * "Organize by" page, silently dropping) shift-range, cmd-toggle, marquee
 * and ⌘A.
 *
 * `orderedIds` must be the ids in the order they actually read on screen —
 * shift-range walks that array, so a grouped/chaptered layout passes its
 * sections flattened back-to-back, not the unordered source list.
 */

/** Below this many pixels of movement, a mousedown→mouseup on empty
 * background reads as a plain click (clears selection) rather than a
 * marquee — keeps single-pixel jitter from flashing a rectangle. */
const MARQUEE_THRESHOLD = 4;

type Rect = { x0: number; y0: number; x1: number; y1: number };

function rectsIntersect(a: Rect, b: DOMRect): boolean {
  return b.left < a.x1 && b.right > a.x0 && b.top < a.y1 && b.bottom > a.y0;
}

export function useObjectSelection({
  orderedIds,
  onOpen,
  containerRef,
  resetKey,
}: {
  orderedIds: string[];
  onOpen: (id: string) => void;
  /** Scopes marquee hit-testing to this subtree's `[data-object-id]`. */
  containerRef: React.RefObject<HTMLElement>;
  /** Changing this drops any leftover selection — switching views or
   * regrouping reshuffles what's on screen, so a carried-over selection
   * would no longer correspond to anything visible. */
  resetKey: string;
}) {
  const [marqueeRect, setMarqueeRect] = useState<Rect | null>(null);

  useEffect(() => {
    useStore.getState().setSelection(new Set(), null);
  }, [resetKey]);

  // ⌘A selects every object in the current filtered view (issue #117), not
  // just what's mounted so far — reaching items that haven't scrolled into
  // range yet is the entire point.
  useEffect(() => {
    function handleKeyDown(e: KeyboardEvent) {
      if (!(e.metaKey || e.ctrlKey) || e.key.toLowerCase() !== "a") return;
      const target = e.target as HTMLElement;
      if (target.closest("input, textarea, [contenteditable='true']")) return;
      if (useStore.getState().detailObjectId) return;
      e.preventDefault();
      useStore.getState().setSelection(new Set(orderedIds), null);
    }
    document.addEventListener("keydown", handleKeyDown);
    return () => document.removeEventListener("keydown", handleKeyDown);
  }, [orderedIds]);

  /** Plain click opens and clears; Shift ranges from the anchor; Cmd/Ctrl
   * toggles just this card. Cards stay modifier-agnostic and forward the
   * event. */
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

  /** Rectangle multi-select over empty background. Global listeners (not
   * React handlers) so the drag keeps tracking once the cursor leaves the
   * container's bounds — very common with a fast marquee. */
  const handleMarqueeMouseDown = useCallback(
    (e: React.MouseEvent<HTMLElement>) => {
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
        if (
          !didDrag &&
          rect.x1 - rect.x0 < MARQUEE_THRESHOLD &&
          rect.y1 - rect.y0 < MARQUEE_THRESHOLD
        ) {
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
        // Never crossed the threshold — a plain click on empty background.
        // Finder clears the selection for that too.
        if (!didDrag) useStore.getState().setSelection(new Set(), null);
        setMarqueeRect(null);
        window.removeEventListener("mousemove", onMove);
        window.removeEventListener("mouseup", onUp);
      };
      window.addEventListener("mousemove", onMove);
      window.addEventListener("mouseup", onUp);
    },
    [containerRef]
  );

  return { handleCardClick, handleMarqueeMouseDown, marqueeRect };
}

/** The marquee rectangle itself — rendered by whoever owns the surface. */
export function MarqueeOverlay({ rect }: { rect: { x0: number; y0: number; x1: number; y1: number } | null }) {
  if (!rect) return null;
  return (
    <div
      className="fixed border border-accent bg-accent/10 pointer-events-none z-50"
      style={{
        left: rect.x0,
        top: rect.y0,
        width: rect.x1 - rect.x0,
        height: rect.y1 - rect.y0,
      }}
    />
  );
}
