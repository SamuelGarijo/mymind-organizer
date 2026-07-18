import { memo, useState } from "react";
import type { DesignObject } from "../types";
import { DRAG_MIME } from "./Sidebar";
import { useStore } from "../store";
import { norm } from "../lib/ruleEngine";
import { colorForGroup } from "../lib/tagGroupColor";
import { pickDistinctiveTags } from "../lib/tagDistinctiveness";
import { NOTE_CONTENT_KEY, asFieldString } from "../lib/mymindSync";

const VISIBLE_TAG_LIMIT = 4;

// Memoized: with thousands of cards mounted, skipping re-render for
// unchanged objects is what keeps typing in the search box responsive.
// `tagFrequency` is computed once per library change (see App.tsx) and
// passed down rather than recomputed per card, for the same reason.
export const Card = memo(function Card({
  object,
  tagFrequency,
  onOpen,
  onCardClick,
}: {
  object: DesignObject;
  tagFrequency: Map<string, number>;
  onOpen: (id: string) => void;
  /** Reports every click along with its modifier keys — Grid.tsx owns the
   * actual Finder-style selection logic (plain click opens + clears
   * selection, Shift ranges, Cmd/Ctrl toggles), since that needs the full
   * ordered list of currently-mounted cards that only Grid has (issue
   * #103). Card stays a dumb reporter so it doesn't need its siblings. */
  onCardClick: (id: string, e: React.MouseEvent) => void;
}) {
  const tagGroups = useStore((s) => s.tagGroups);
  // Scoped selector: only cards whose OWN membership actually flips
  // re-render on a selection change (zustand bails out on an unchanged
  // selector result), which matters here since marquee drag fires this at
  // mousemove frequency over however many cards are mounted.
  const isSelected = useStore((s) => s.selectedObjectIds.has(object.id));
  // Rarer tags are more specific to this object than generic, high-frequency
  // ones — see lib/tagDistinctiveness for the (deliberately simple) ranking.
  const visibleTags = pickDistinctiveTags(object.tags, tagFrequency, VISIBLE_TAG_LIMIT);
  const overflow = object.tags.length - visibleTags.length;
  // Not every synced object has a thumbnail (e.g. plain notes) — the proxy
  // URL is always present, but the underlying request can 404/422.
  const [imageFailed, setImageFailed] = useState(false);
  const showImage = object.imageUrl && !imageFailed;
  // Text-based objects (notes, etc.) have no real thumbnail — prefer the
  // real written content (NOTE_CONTENT_KEY) over mymind's AI-generated
  // `summary`, falling back to summary only when there's no real content
  // (e.g. a non-Note object with no thumbnail). Only the preview slot itself
  // gets the white/rounded "paper" card treatment — it floats as its own
  // shape, decoupled from the metadata below, which stays identical to
  // every other card's (no special background or padding).
  const textPreview = (
    asFieldString(object.fields[NOTE_CONTENT_KEY]) || asFieldString(object.fields.summary)
  ).trim();
  const isTextOnly = !showImage && !!textPreview;

  return (
    <div
      draggable
      onDragStart={(e) => {
        // Imperative getState() read, not a reactive subscription — this
        // fires per-drag, not per-render, so it doesn't cost every one of
        // the thousands of mounted cards a re-render subscription just for
        // an event that only ever touches one of them at a time.
        const { selectedObjectIds, sidebarCollapsed, setDragRevealSidebar } = useStore.getState();
        // Dragging a card that's part of an active multi-selection carries
        // the whole group; dragging anything else (nothing selected, or
        // only this card) carries just itself — same single-id shape as
        // before #103 for the common case.
        const ids =
          selectedObjectIds.has(object.id) && selectedObjectIds.size > 1
            ? Array.from(selectedObjectIds)
            : [object.id];
        e.dataTransfer.setData(DRAG_MIME, JSON.stringify(ids));
        e.dataTransfer.effectAllowed = "copy";
        if (sidebarCollapsed) setDragRevealSidebar(true);
      }}
      onDragEnd={() => useStore.getState().setDragRevealSidebar(false)}
      onClick={(e) => onCardClick(object.id, e)}
      className={[
        // `overflow-hidden` is what actually makes `rounded-card` visible on
        // the image/text preview below — without it, nothing clips to that
        // radius, so the image's own hard square corners peek out from
        // inside the rounded selection ring (issue #110). Radius now comes
        // from one shared token (rounded-card) instead of the ring drawing
        // a curve nothing else honors, so it holds at any card size.
        "group active:cursor-grabbing rounded-card overflow-hidden",
        isSelected ? "ring-2 ring-accent ring-offset-2" : "",
      ].join(" ")}
      data-object-id={object.id}
    >
      {isTextOnly ? (
        <div className="w-full bg-panel rounded-card shadow-card group-hover:shadow-cardHover transition-shadow p-3.5">
          <p className="text-[14px] leading-snug text-ink/75 line-clamp-[10] whitespace-pre-line">
            {textPreview}
          </p>
        </div>
      ) : (
        // Floating, near-borderless (design-philosophy: things breathe as
        // pieces on the canvas, not boxed sections) — soft shadow instead
        // of a hard border, lifting slightly on hover.
        <div className="w-full rounded-card overflow-hidden bg-panel shadow-card group-hover:shadow-cardHover transition-shadow">
          {showImage ? (
            <img
              src={object.imageUrl}
              alt={object.title}
              loading="lazy"
              className="w-full h-auto block"
              draggable={false}
              onError={() => setImageFailed(true)}
            />
          ) : (
            <div className="w-full aspect-[4/3] flex items-center justify-center text-muted text-xs">
              No image
            </div>
          )}
        </div>
      )}
      <div className="pt-2 pb-1">
        <div className="text-[13px] leading-snug line-clamp-2" title={object.title}>
          {object.title}
        </div>
        {visibleTags.length > 0 && (
          <div className="mt-1 text-[11px] text-muted/80 leading-snug">
            {visibleTags.map((t, i) => {
              const group = tagGroups[norm(t)];
              const color = group ? colorForGroup(group).text : undefined;
              return (
                <span key={t} style={color ? { color } : undefined}>
                  {i > 0 && " "}#{t}
                </span>
              );
            })}
            {overflow > 0 && <span> +{overflow}</span>}
          </div>
        )}
      </div>
    </div>
  );
});
