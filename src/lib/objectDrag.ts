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
export function objectDragProps(ids: string[]) {
  return {
    draggable: true,
    onDragStart: (e: React.DragEvent) => {
      const { sidebarCollapsed, setDragRevealSidebar } = useStore.getState();
      e.dataTransfer.setData(DRAG_MIME, JSON.stringify(ids));
      e.dataTransfer.effectAllowed = "copyMove";
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
