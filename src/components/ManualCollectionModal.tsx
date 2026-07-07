import { useState } from "react";
import { useStore } from "../store";
import { normalizeFacetSchema } from "../lib/facetSchema";
import type { FacetField, FacetFieldType } from "../types";

const TYPE_LABELS: Record<FacetFieldType, string> = {
  text: "Text",
  date: "Date",
  select: "Select",
};

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
  const [facets, setFacets] = useState<FacetField[]>(
    existing?.type === "manual" ? normalizeFacetSchema(existing) : []
  );
  const [nameDraft, setNameDraft] = useState("");
  const [typeDraft, setTypeDraft] = useState<FacetFieldType>("text");
  const [optionsDraft, setOptionsDraft] = useState("");

  function addFacet() {
    const value = nameDraft.trim();
    if (!value) return;
    if (facets.some((f) => f.name.toLowerCase() === value.toLowerCase())) {
      setNameDraft("");
      return;
    }
    const options =
      typeDraft === "select"
        ? optionsDraft
            .split(",")
            .map((o) => o.trim())
            .filter(Boolean)
        : undefined;
    setFacets([...facets, { name: value, type: typeDraft, ...(options ? { options } : {}) }]);
    setNameDraft("");
    setOptionsDraft("");
    setTypeDraft("text");
  }

  function removeFacet(name: string) {
    setFacets(facets.filter((f) => f.name !== name));
  }

  function save() {
    const trimmed = name.trim();
    if (!trimmed) return;
    if (existing) {
      state.updateManualCollection(existing.id, { name: trimmed, facetSchema: facets });
    } else {
      const id = state.addManualCollection(trimmed, facets);
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
          this never changes anything in mymind.
        </p>
        <input
          autoFocus
          value={name}
          onChange={(e) => setName(e.target.value)}
          onKeyDown={(e) => e.key === "Enter" && save()}
          placeholder="e.g. Journalism"
          className="w-full rounded-lg border border-line px-2.5 py-1.5 text-sm outline-none focus:border-accent"
        />

        <div className="mt-4">
          <div className="text-[11px] uppercase tracking-wide text-muted">Facet schema</div>
          <p className="text-[12px] text-muted/80 mt-0.5 mb-2">
            A fixed, typed schema for this collection — every item placed here gets exactly
            these fields to fill in (e.g. author: text, fact-check: select). Optional.
          </p>
          <div className="space-y-1">
            {facets.map((field) => (
              <div key={field.name} className="flex items-center gap-1.5">
                <span className="tag-chip flex-1 justify-start gap-1.5">
                  {field.name}
                  <span className="text-muted">· {TYPE_LABELS[field.type]}</span>
                  {field.type === "select" && field.options && (
                    <span className="text-muted/70 truncate">({field.options.join(", ")})</span>
                  )}
                </span>
                <button
                  onClick={() => removeFacet(field.name)}
                  className="text-muted hover:text-ink px-1"
                  aria-label={`Remove facet ${field.name}`}
                >
                  ×
                </button>
              </div>
            ))}
          </div>

          <div className="mt-1.5 space-y-1.5">
            <div className="flex gap-1.5">
              <input
                value={nameDraft}
                onChange={(e) => setNameDraft(e.target.value)}
                onKeyDown={(e) => e.key === "Enter" && typeDraft !== "select" && addFacet()}
                placeholder="Field name…"
                className="flex-1 rounded-lg border border-line px-2.5 py-1.5 text-sm outline-none focus:border-accent"
              />
              <select
                value={typeDraft}
                onChange={(e) => setTypeDraft(e.target.value as FacetFieldType)}
                className="rounded-lg border border-line px-2 py-1.5 text-sm bg-panel"
              >
                {(Object.keys(TYPE_LABELS) as FacetFieldType[]).map((t) => (
                  <option key={t} value={t}>
                    {TYPE_LABELS[t]}
                  </option>
                ))}
              </select>
            </div>
            {typeDraft === "select" && (
              <input
                value={optionsDraft}
                onChange={(e) => setOptionsDraft(e.target.value)}
                onKeyDown={(e) => e.key === "Enter" && addFacet()}
                placeholder="Options, comma-separated (e.g. unverified, verified, false)"
                className="w-full rounded-lg border border-line px-2.5 py-1.5 text-sm outline-none focus:border-accent"
              />
            )}
            <button
              onClick={addFacet}
              className="w-full rounded-lg border border-line px-3 py-1.5 text-sm hover:bg-line/40"
            >
              Add field
            </button>
          </div>
        </div>

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
