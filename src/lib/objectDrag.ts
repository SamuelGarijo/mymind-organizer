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

export function objectDragProps(ids: string[]) {
  return {
    draggable: true,
    onDragStart: (e: React.DragEvent) => {
      const { sidebarCollapsed, setDragRevealSidebar } = useStore.getState();
      e.dataTransfer.setData(DRAG_MIME, JSON.stringify(ids));
      e.dataTransfer.effectAllowed = "copyMove";
      applyDragGhost(e, ids.length);
      if (sidebarCollapsed) setDragRevealSidebar(true);
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
