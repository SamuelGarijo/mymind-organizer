import { useEffect, useRef, useState } from "react";
import { useStore } from "../store";
import { orderedFacetBuckets } from "../lib/primaryFacets";
import { resolveTagOrigin } from "../lib/tagOrigin";
import { UNGROUPED_LABEL } from "../lib/grouping";
import { DRAG_MIME } from "./Sidebar";
import type { DesignObject, RoleDefinition } from "../types";

const UNCLASSIFIED_LABEL = "Unclassified";

/**
 * Right-side workbench for classifying objects (collection-workspace
 * feature): one tab per the active role's pinned primaryFacets, buckets per
 * value underneath — drag objects in from Grid/Table, or between buckets
 * inside the panel itself. Mirrors Table.tsx's existing bucket-drop
 * precedent (handleBucketDrop → assignFieldValue), just presented as a
 * panel instead of table rows. Follows DetailPanel's own overlay/dialog
 * convention so the two never visually compete.
 */
export function ClassificationPanel({
  objects,
  activeRole,
  onClose,
}: {
  /** Already scoped to the active role by the caller — off-role objects
   * can't carry any of its fields, so there's nothing for them to do here. */
  objects: DesignObject[];
  activeRole: RoleDefinition;
  onClose: () => void;
}) {
  const localUserTags = useStore((s) => s.localUserTags);
  const primaryFacets = activeRole.primaryFacets ?? [];
  const [activeFieldName, setActiveFieldName] = useState(primaryFacets[0]);
  const [dragOverLabel, setDragOverLabel] = useState<string | null>(null);
  const panelRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    panelRef.current?.focus();
  }, []);
  useEffect(() => {
    function handleKeyDown(e: KeyboardEvent) {
      if (e.key === "Escape") onClose();
    }
    document.addEventListener("keydown", handleKeyDown);
    return () => document.removeEventListener("keydown", handleKeyDown);
  }, [onClose]);

  const activeField = activeRole.fields.find((f) => f.name === activeFieldName);

  if (primaryFacets.length === 0 || !activeField) {
    return (
      <div className="fixed inset-0 z-40 flex justify-end" role="dialog" aria-modal="true">
        <div className="absolute inset-0 bg-black/20" onClick={onClose} />
        <div className="relative w-96 h-full bg-panel border-l border-line shadow-2xl p-5 text-[13px] text-muted">
          <button onClick={onClose} className="absolute top-3 right-3 text-muted hover:text-ink text-lg">
            ×
          </button>
          "{activeRole.name}" has no primary facets pinned yet — pin some in Item Types (★ next
          to a field) to classify by them here.
        </div>
      </div>
    );
  }

  const buckets = orderedFacetBuckets(objects, activeField);
  const fieldName = activeField.name;
  const mode = activeField.type === "multi-select" ? "append" : "replace";

  const handleDrop = (e: React.DragEvent, label: string) => {
    e.preventDefault();
    setDragOverLabel(null);
    const raw = e.dataTransfer.getData(DRAG_MIME);
    if (!raw) return;
    const ids: string[] = JSON.parse(raw);
    const value = label === UNGROUPED_LABEL ? "" : label;
    useStore.getState().assignFieldValue(ids, fieldName, value, mode);
  };

  return (
    <div className="fixed inset-0 z-40 flex justify-end" role="dialog" aria-modal="true">
      <div className="absolute inset-0 bg-black/20" onClick={onClose} />
      <div
        ref={panelRef}
        tabIndex={-1}
        className="relative w-96 h-full bg-panel border-l border-line shadow-2xl flex flex-col outline-none"
      >
        <div className="shrink-0 flex items-center justify-between px-4 py-3 border-b border-line">
          <div className="text-sm font-medium truncate">Classify — {activeRole.name}</div>
          <button onClick={onClose} className="text-muted hover:text-ink text-lg leading-none" aria-label="Close">
            ×
          </button>
        </div>

        <div className="shrink-0 flex items-center gap-1 px-3 py-2 border-b border-line overflow-x-auto">
          {primaryFacets.map((name) => (
            <button
              key={name}
              onClick={() => setActiveFieldName(name)}
              className={[
                "tag-chip shrink-0",
                name === activeFieldName ? "border-accent/40 bg-accent/5 text-ink" : "",
              ].join(" ")}
            >
              {name}
            </button>
          ))}
        </div>

        <div className="flex-1 overflow-y-auto px-3 py-3 space-y-3">
          {buckets.map(({ label, objects: bucketObjects }) => {
            const displayLabel = label === UNGROUPED_LABEL ? UNCLASSIFIED_LABEL : label;
            return (
              <div
                key={label}
                onDragOver={(e) => {
                  e.preventDefault();
                  setDragOverLabel(label);
                }}
                onDragLeave={() => setDragOverLabel((cur) => (cur === label ? null : cur))}
                onDrop={(e) => handleDrop(e, label)}
                className={[
                  "rounded-lg border border-line p-2",
                  dragOverLabel === label ? "ring-2 ring-accent ring-offset-1 ring-offset-panel" : "",
                  label === UNGROUPED_LABEL ? "border-dashed" : "",
                ].join(" ")}
              >
                <div className="text-[11px] font-medium text-muted mb-1.5 flex items-center justify-between">
                  <span>{displayLabel}</span>
                  <span className="text-muted/70">{bucketObjects.length}</span>
                </div>
                <div className="flex flex-wrap gap-1.5 min-h-[2.5rem]">
                  {bucketObjects.map((object) => {
                    const raw = object.fields[activeField.name];
                    const values = Array.isArray(raw) ? raw : raw ? [raw] : [];
                    const isUser = values.some(
                      (v) => resolveTagOrigin(object, v, localUserTags[object.id]) === "user"
                    );
                    return (
                      <div
                        key={object.id}
                        draggable
                        onDragStart={(e) => {
                          e.dataTransfer.setData(DRAG_MIME, JSON.stringify([object.id]));
                          e.dataTransfer.effectAllowed = "copy";
                        }}
                        title={object.title}
                        className={[
                          "w-14 h-14 rounded-md overflow-hidden border shrink-0 relative cursor-grab",
                          isUser ? "border-accent/50" : "border-line border-dashed",
                        ].join(" ")}
                      >
                        {object.imageUrl ? (
                          <img src={object.imageUrl} alt="" className="w-full h-full object-cover" />
                        ) : (
                          <div className="w-full h-full flex items-center justify-center text-[9px] text-muted px-1 text-center">
                            {object.title}
                          </div>
                        )}
                      </div>
                    );
                  })}
                </div>
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
}
