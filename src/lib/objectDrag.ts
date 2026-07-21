import { useStore } from "../store";

/** The one drag payload for Organizer objects — a JSON array of ids
 * (issue #103: one id for a lone item, the whole selection for a
 * multi-select drag). Defined here (not Sidebar) so every surface imports
 * the contract from the interaction layer, not from a component. */
export const DRAG_MIME = "application/x-organizer-object-id";

/**
 * Universal drag-source props (issue #132) — spread onto ANY rendered
 * object so it can be picked up and dropped on any target (collections,
 * workbench, classify folders, table groups). Centralizes the three-part
 * contract every source must honor:
 *   1. DRAG_MIME carries the id array;
 *   2. a drag reveals the collapsed sidebar's drop targets
 *      (dragRevealSidebar) and holds them stable until the drop;
 *   3. dragend always clears the reveal.
 *
 * `ids` defaults to just the object itself; pass the current selection for
 * multi-drag surfaces (Grid/Table already do).
 */
/**
 * Replaces the browser's default drag image (a full-size snapshot of the
 * dragged element, centered under the cursor — which hides exactly the
 * drop target you're aiming at) with a compact 56px thumb floated ABOVE
 * the cursor, so the destination stays visible. Falls back to a small
 * count chip when the source has no loaded image. The ghost node must be
 * in the DOM at setDragImage time; it's removed on the next tick.
 */
export function applyDragGhost(e: React.DragEvent, count: number) {
  const sourceImg = (e.currentTarget as HTMLElement).querySelector("img");
  const ghost = document.createElement("div");
  ghost.style.cssText =
    "position:fixed;top:-200px;left:-200px;width:56px;height:56px;" +
    "border-radius:2px;overflow:hidden;box-shadow:0 4px 14px rgba(0,0,0,.25);" +
    "background:#fff;display:flex;align-items:center;justify-content:center;" +
    "font:700 13px ui-monospace,monospace;color:#1c1c1c;";
  if (sourceImg instanceof HTMLImageElement && sourceImg.complete && sourceImg.naturalWidth > 0) {
    const img = sourceImg.cloneNode() as HTMLImageElement;
    img.style.cssText = "width:100%;height:100%;object-fit:cover;";
    ghost.appendChild(img);
  } else {
    ghost.textContent = count > 1 ? `×${count}` : "▣";
  }
  if (count > 1) {
    const badge = document.createElement("div");
    badge.textContent = String(count);
    badge.style.cssText =
      "position:absolute;top:2px;right:2px;background:#1c1c1c;color:#fff;" +
      "border-radius:2px;padding:0 4px;font:700 10px ui-monospace,monospace;";
    ghost.appendChild(badge);
  }
  document.body.appendChild(ghost);
  // Anchor point = bottom-center of the ghost → it rides ABOVE the cursor.
  e.dataTransfer.setDragImage(ghost, 28, 68);
  setTimeout(() => ghost.remove(), 0);
}

/** Pointer must come within this many pixels of the left edge before a
 * drag reveals the collapsed sidebar — the reveal answers an intent
 * ("I'm heading for a collection"), it isn't a side effect of picking
 * anything up (Samuel, 2026-07-21). */
const REVEAL_AT_PX = 90;
/** ...and it only retracts once you're clearly back over the work. The
 * gap is deliberate hysteresis: the revealed sidebar is ~256px wide, so a
 * single threshold would snap it shut the moment you moved onto the very
 * targets it just offered. */
const HIDE_BEYOND_PX = 320;

/**
 * Watches an in-flight drag and reveals the collapsed sidebar only while
 * the pointer is near the left edge, then guarantees the reveal is undone.
 *
 * Both halves are why this lives on `document` rather than on the dragged
 * element. The reveal needs pointer coordinates, which `dragstart` alone
 * can't give over time; and the teardown must survive the source node
 * disappearing mid-drag — dropping a card into a classify drawer gives it
 * a value, which removes it from the reservoir, unmounting the very
 * element whose `dragend` was supposed to close the sidebar. That left it
 * pinned open over the objects. `drop` on document (capture) always fires.
 */
function trackDragTowardSidebar() {
  if (!useStore.getState().sidebarCollapsed) return;

  const onDragOver = (e: DragEvent) => {
    const st = useStore.getState();
    const reveal = st.dragRevealSidebar ? e.clientX <= HIDE_BEYOND_PX : e.clientX <= REVEAL_AT_PX;
    if (reveal !== st.dragRevealSidebar) st.setDragRevealSidebar(reveal);
  };
  const end = () => {
    useStore.getState().setDragRevealSidebar(false);
    document.removeEventListener("dragover", onDragOver);
    document.removeEventListener("dragend", end, true);
    document.removeEventListener("drop", end, true);
    window.removeEventListener("blur", end);
  };

  document.addEventListener("dragover", onDragOver);
  document.addEventListener("dragend", end, true);
  document.addEventListener("drop", end, true);
  // Dragging out of the window and releasing there fires neither.
  window.addEventListener("blur", end);
}

export function objectDragProps(ids: string[]) {
  return {
    draggable: true,
    onDragStart: (e: React.DragEvent) => {
      e.dataTransfer.setData(DRAG_MIME, JSON.stringify(ids));
      e.dataTransfer.effectAllowed = "copyMove";
      applyDragGhost(e, ids.length);
      trackDragTowardSidebar();
    },
    onDragEnd: () => useStore.getState().setDragRevealSidebar(false),
  };
}

/** Reads the payload off a drop event — empty array when the drag wasn't
 * an Organizer object (a file from the desktop, a text selection…). */
export function readDraggedIds(e: React.DragEvent): string[] {
  const raw = e.dataTransfer.getData(DRAG_MIME);
  if (!raw) return [];
  try {
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed.filter((x) => typeof x === "string") : [];
  } catch {
    return [];
  }
}
