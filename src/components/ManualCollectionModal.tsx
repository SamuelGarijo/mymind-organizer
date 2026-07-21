import { useMemo, useState } from "react";
import { HeroImagePicker } from "./HeroImagePicker";
import { TypologyPanel } from "./TypologyPanel";
import type { FacetField } from "../types";
import { useStore } from "../store";

/** Collections are just named folders now — classification fields belong
 * to item types (issue #84, see RolePackageModal), not to collections, so
 * this modal no longer carries a schema editor. */
export function ManualCollectionModal({
  collectionId,
  parentId,
  onClose,
}: {
  collectionId?: string;
  /** Nests a freshly-created collection under a manual collection (issue
   * #126) — ignored when editing an existing one. */
  parentId?: string;
  onClose: () => void;
}) {
  const state = useStore();
  const existing =
    collectionId && state.collections[collectionId]?.type === "manual"
      ? state.collections[collectionId]
      : undefined;

  const [name, setName] = useState(existing?.type === "manual" ? existing.name : "");
  const [description, setDescription] = useState(existing?.description ?? "");
  const [heroImageObjectId, setHeroImageObjectId] = useState<string | null>(
    existing?.heroImageObjectId ?? null
  );
  // Creating a collection is an act of typology (2026-07-21) — the panel
  // proposes it, this holds the answer until Save.
  const [typology, setTypology] = useState<{ name: string; fields: FacetField[] } | null>(null);
  const [autoTagsDraft, setAutoTagsDraft] = useState(
    existing?.type === "manual" ? (existing.autoTags ?? []).join(", ") : ""
  );

  // Hero image is a reference to an object already curated into this
  // collection, never a new upload (issue #87) — only meaningful once the
  // collection actually has members to pick from.
  const memberObjects = useMemo(() => {
    if (!existing) return [];
    return Object.values(state.objects).filter((o) => o.manualCollectionIds.includes(existing.id));
  }, [state.objects, existing]);

  function save() {
    const trimmed = name.trim();
    if (!trimmed) return;
    const autoTags = Array.from(
      new Set(
        autoTagsDraft
          .split(",")
          .map((t) => t.trim())
          .filter(Boolean)
      )
    );
    let id: string;
    if (existing) {
      state.updateManualCollection(existing.id, { name: trimmed, autoTags });
      id = existing.id;
    } else {
      id = state.addManualCollection(trimmed, undefined, parentId);
      state.setSelectedView({ kind: "collection", collectionId: id });
      if (autoTags.length > 0) state.updateManualCollection(id, { autoTags });
    }
    state.updateCollectionMeta(id, { description, heroImageObjectId });
    if (typology) {
      useStore
        .getState()
        .applyTypology(typology.name, memberObjects.map((o) => o.id), typology.fields);
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
          {!existing && parentId && state.collections[parentId] && (
            <> Nested inside "{state.collections[parentId]!.name}".</>
          )}
        </p>
        <input
          autoFocus
          value={name}
          onChange={(e) => setName(e.target.value)}
          onKeyDown={(e) => e.key === "Enter" && save()}
          placeholder="e.g. Journalism"
          className="w-full rounded-lg border border-line px-2.5 py-1.5 text-sm outline-none focus:border-accent"
        />

        <textarea
          value={description}
          onChange={(e) => setDescription(e.target.value)}
          placeholder="Description (optional) — shown at the top of this collection, like an Are.na channel"
          rows={2}
          className="mt-2 w-full rounded-lg border border-line px-2.5 py-1.5 text-sm outline-none focus:border-accent resize-y"
        />

        <input
          value={autoTagsDraft}
          onChange={(e) => setAutoTagsDraft(e.target.value)}
          placeholder="Auto-tags (optional, comma-separated) — added to any item dropped in here"
          className="mt-2 w-full rounded-lg border border-line px-2.5 py-1.5 text-sm outline-none focus:border-accent"
        />

        <TypologyPanel
          collectionName={name}
          members={memberObjects}
          onApply={setTypology}
        />

        {existing && (
          <HeroImagePicker
            candidates={memberObjects}
            selectedId={heroImageObjectId}
            onSelect={setHeroImageObjectId}
            emptyHint="Nothing with a picture in here yet — drag some cards in and one can front the collection."
          />
        )}

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
