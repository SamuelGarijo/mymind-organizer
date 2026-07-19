import type { Collection, DesignObject, ViewSelection } from "../types";

/** Human label for a view — shared by App.tsx's header title and the
 * exploration back-stack pill (lib/viewLabel so neither imports the other). */
export function viewTitle(state: {
  selectedView: ViewSelection;
  objects: Record<string, DesignObject>;
  collections: Record<string, Collection>;
}): string {
  const view = state.selectedView;
  if (view.kind === "all") return "All items";
  if (view.kind === "unclassified") return "Unclassified";
  if (view.kind === "similar") {
    const target = state.objects[view.objectId];
    return target ? `Similar to: ${target.title}` : "Similar to…";
  }
  return state.collections[view.collectionId]?.name ?? "Collection";
}
