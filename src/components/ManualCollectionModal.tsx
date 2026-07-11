import { useState } from "react";
import { useStore } from "../store";

/** Collections are just named folders now — classification fields belong
 * to item types (issue #84, see RolePackageModal), not to collections, so
 * this modal no longer carries a schema editor. */
export function ManualCollectionModal({
  collectionId,
  onClose,
}: {
  collectionId?: string;
  onClose: () => void;
}) {
  const state = useStore();
  const existing =
    collectionId && state.collections[collectionId]?.type === "manual"
      ? state.collections[collectionId]
      : undefined;

  const [name, setName] = useState(existing?.type === "manual" ? existing.name : "");

  function save() {
    const trimmed = name.trim();
    if (!trimmed) return;
    if (existing) {
      state.updateManualCollection(existing.id, { name: trimmed });
    } else {
      const id = state.addManualCollection(trimmed);
      state.setSelectedView({ kind: "collection", collectionId: id });
    }
    onClose();
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center">
      <div className="absolute inset-0 bg-black/30" onClick={onClose} />
      <div className="relative bg-panel rounded-card border border-line shadow-2xl w-full max-w-sm p-5">
        <div className="text-sm font-medium mb-1">
          {existing ? "Edit manual collection" : "New manual collection"}
        </div>
        <p className="text-[12px] text-muted mb-3">
          A folder you curate yourself. Drag cards from the grid onto it in the sidebar —
          this never changes anything in mymind. Classification fields live on each item's
          type (set it in the item's detail panel), not on the collection.
        </p>
        <input
          autoFocus
          value={name}
          onChange={(e) => setName(e.target.value)}
          onKeyDown={(e) => e.key === "Enter" && save()}
          placeholder="e.g. Journalism"
          className="w-full rounded-lg border border-line px-2.5 py-1.5 text-sm outline-none focus:border-accent"
        />

        <div className="mt-4 flex justify-end gap-2">
          <button
            onClick={onClose}
            className="text-sm px-3 py-1.5 rounded-lg hover:bg-line/40 text-ink/70"
          >
            Cancel
          </button>
          <button
            onClick={save}
            disabled={!name.trim()}
            className="text-sm px-3 py-1.5 rounded-lg bg-ink text-white disabled:opacity-40"
          >
            {existing ? "Save" : "Create"}
          </button>
        </div>
      </div>
    </div>
  );
}
