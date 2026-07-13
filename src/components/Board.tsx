import { useEffect, useState } from "react";
import { useStore } from "../store";
import { orderedFacetBuckets } from "../lib/primaryFacets";
import { resolveTagOrigin } from "../lib/tagOrigin";
import { UNGROUPED_LABEL } from "../lib/grouping";
import { DRAG_MIME } from "./Sidebar";
import type { DesignObject, RoleDefinition } from "../types";

const UNCLASSIFIED_LABEL = "Unclassified";

/**
 * Collection-workspace Kanban view (replaces Grid/Table in the main content
 * area while active — not a modal/side overlay, so cards are always visible
 * and draggable exactly where they normally live). One tab per the active
 * role's pinned primaryFacets; columns per value underneath, dragged
 * between natively. Mirrors Table.tsx's existing bucket-drop precedent
 * (handleBucketDrop → assignFieldValue), just laid out as real Kanban
 * columns instead of table group rows.
 */
export function Board({
  objects,
  activeRole,
  onOpen,
}: {
  /** Already scoped to the active role by the caller — off-role objects
   * can't carry any of its fields, so there's nothing for them to do here. */
  objects: DesignObject[];
  activeRole: RoleDefinition;
  onOpen: (id: string) => void;
}) {
  const localUserTags = useStore((s) => s.localUserTags);
  const primaryFacets = activeRole.primaryFacets ?? [];
  const [activeFieldName, setActiveFieldName] = useState(primaryFacets[0]);
  const [dragOverLabel, setDragOverLabel] = useState<string | null>(null);

  // The active role can change (switching the top bar's role picker) out
  // from under an already-mounted Board — keep the tab in sync rather than
  // pointing at a field name that belonged to the previous role.
  useEffect(() => {
    if (!primaryFacets.includes(activeFieldName ?? "")) setActiveFieldName(primaryFacets[0]);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeRole.name]);

  const activeField = activeRole.fields.find((f) => f.name === activeFieldName);

  if (primaryFacets.length === 0 || !activeField) {
    return (
      <div className="h-full flex items-center justify-center p-8 text-center text-[13px] text-muted">
        "{activeRole.name}" has no primary facets pinned yet — pin some in Item Types (★ next to a
        field) to lay out a board here.
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
    <div className="h-full flex flex-col">
      {primaryFacets.length > 1 && (
        <div className="shrink-0 flex items-center gap-1 px-5 py-2 border-b border-line overflow-x-auto">
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
      )}

      <div className="flex-1 overflow-x-auto overflow-y-hidden p-5">
        <div className="flex gap-3 h-full">
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
                  "w-56 shrink-0 h-full flex flex-col rounded-lg border border-line bg-canvas",
                  dragOverLabel === label ? "ring-2 ring-accent ring-offset-1 ring-offset-panel" : "",
                  label === UNGROUPED_LABEL ? "border-dashed" : "",
                ].join(" ")}
              >
                <div className="shrink-0 px-3 py-2 border-b border-line text-[12px] font-medium text-ink/80 flex items-center justify-between">
                  <span className="truncate">{displayLabel}</span>
                  <span className="text-muted shrink-0">{bucketObjects.length}</span>
                </div>
                <div className="flex-1 overflow-y-auto p-2 space-y-2">
                  {bucketObjects.map((object) => {
                    const raw = object.fields[fieldName];
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
                        onClick={() => onOpen(object.id)}
                        title={object.title}
                        className={[
                          "rounded-md overflow-hidden border bg-panel cursor-grab shadow-sm",
                          isUser ? "border-accent/50" : "border-line",
                        ].join(" ")}
                      >
                        {object.imageUrl ? (
                          <img
                            src={object.imageUrl}
                            alt=""
                            className="w-full h-24 object-cover pointer-events-none"
                          />
                        ) : (
                          <div className="w-full h-24 flex items-center justify-center bg-line/20 text-[10px] text-muted px-2 text-center pointer-events-none">
                            {object.title}
                          </div>
                        )}
                        <div className="px-2 py-1 text-[11px] text-ink/80 truncate">
                          {object.title}
                        </div>
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
