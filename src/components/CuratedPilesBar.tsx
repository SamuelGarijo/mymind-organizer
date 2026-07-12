import { useState } from "react";
import { useShallow } from "zustand/react/shallow";
import { useStore } from "../store";
import { addMymindTag } from "../lib/mymindWrite";
import { DRAG_MIME } from "./Sidebar";
import type { TagFrequency } from "../lib/quickFilter";

const VISIBLE_LIMIT = 10;

/**
 * Curated Piles — lightweight, provisional "desk piles" built from tags the
 * user typed by hand (lib/tagOrigin.ts's "user" origin), never mymind/AI
 * metadata. Deliberately NOT a folder/role/facet: no hierarchy, no colors,
 * no icons, no suggestions — just a click-to-filter, drag-to-assign strip
 * that reuses the exact same facetTags/toggleFacetTag filter state and
 * DRAG_MIME drag contract every other part of the app already uses, so a
 * pile behaves exactly like any other tag filter everywhere else.
 */
export function CuratedPilesBar({ piles }: { piles: TagFrequency[] }) {
  const state = useStore(
    useShallow((s) => ({
      objects: s.objects,
      facetTags: s.facetTags,
      toggleFacetTag: s.toggleFacetTag,
      addObjectTag: s.addObjectTag,
    }))
  );
  const [expanded, setExpanded] = useState(false);
  const [dragOverTag, setDragOverTag] = useState<string | null>(null);

  if (piles.length === 0) {
    return (
      <div className="border-b border-line bg-panel px-5 py-2 text-[12px] text-muted/70">
        No curated piles yet — tags you add by hand (DetailPanel's "Add tag") show up here as
        piles.
      </div>
    );
  }

  // Selected piles pin to the left regardless of count, so a pile you're
  // actively filtering by never scrolls out of view or gets buried under
  // "More" — everything else keeps the highest-count-first order.
  const selectedSet = new Set(state.facetTags);
  const ordered = [
    ...piles.filter((p) => selectedSet.has(p.tag)),
    ...piles.filter((p) => !selectedSet.has(p.tag)),
  ];
  const shown = expanded ? ordered : ordered.slice(0, VISIBLE_LIMIT);
  const hiddenCount = ordered.length - shown.length;

  function assignTag(objectId: string, tag: string) {
    const object = state.objects[objectId];
    if (!object || object.tags.includes(tag)) return;
    state.addObjectTag(objectId, tag);
    if (object.source === "mymind") void addMymindTag(objectId, tag);
  }

  return (
    <div className="border-b border-line bg-panel px-5 py-2 flex items-center gap-1.5 overflow-x-auto whitespace-nowrap">
      {shown.map(({ tag, count }) => {
        const active = selectedSet.has(tag);
        const dragOver = dragOverTag === tag;
        return (
          <button
            key={tag}
            onClick={() => state.toggleFacetTag(tag)}
            onDragOver={(e) => {
              e.preventDefault();
              setDragOverTag(tag);
            }}
            onDragLeave={() => setDragOverTag((t) => (t === tag ? null : t))}
            onDrop={(e) => {
              e.preventDefault();
              setDragOverTag(null);
              const raw = e.dataTransfer.getData(DRAG_MIME);
              if (!raw) return;
              const ids: string[] = JSON.parse(raw);
              for (const id of ids) assignTag(id, tag);
            }}
            className={[
              "tag-chip gap-1 shrink-0",
              active ? "bg-ink text-white border-ink" : "",
              dragOver ? "ring-2 ring-accent ring-offset-1 ring-offset-panel" : "",
            ].join(" ")}
            title={`${tag} — click to filter, drop an item here to add this tag to it`}
          >
            {tag}
            <span className={active ? "text-white/60" : "text-muted"}>{count}</span>
          </button>
        );
      })}
      {(hiddenCount > 0 || expanded) && (
        <button
          onClick={() => setExpanded((v) => !v)}
          className="text-[11px] text-muted hover:text-ink shrink-0 px-1"
        >
          {expanded ? "less" : `+${hiddenCount} more`}
        </button>
      )}
    </div>
  );
}
