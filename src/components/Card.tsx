import { memo, useMemo, useState } from "react";
import type { DesignObject } from "../types";
import { objectDragProps } from "../lib/objectDrag";
import { useStore } from "../store";
import { norm } from "../lib/ruleEngine";
import { colorForGroup } from "../lib/tagGroupColor";
import { pickDistinctiveTags } from "../lib/tagDistinctiveness";
import { visibleTags as visibleTagsOf } from "../lib/tagPromotion";
import { NOTE_CONTENT_KEY, asFieldString } from "../lib/mymindSync";
import { describeObject } from "../lib/objectKind";

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
  hideTags = false,
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
  /** Split view (canvas open): the narrow slit shows image+title only. */
  hideTags?: boolean;
}) {
  const tagGroups = useStore((s) => s.tagGroups);
  // Scoped selector: only cards whose OWN membership actually flips
  // re-render on a selection change (zustand bails out on an unchanged
  // selector result), which matters here since marquee drag fires this at
  // mousemove frequency over however many cards are mounted.
  const isSelected = useStore((s) => s.selectedObjectIds.has(object.id));
  // A tag promoted into a facet value is no longer a loose tag — it still
  // lives on the object, it just says its piece as structure now. See
  // lib/tagPromotion.ts for why this is a read-time overlay, not a deletion.
  const promotions = useStore((s) => s.tagPromotions[object.id]);
  const genericTags = useMemo(
    () => visibleTagsOf(object, promotions ? { [object.id]: promotions } : {}),
    [object, promotions]
  );
  // Rarer tags are more specific to this object than generic, high-frequency
  // ones — see lib/tagDistinctiveness for the (deliberately simple) ranking.
  const visibleTags = pickDistinctiveTags(genericTags, tagFrequency, VISIBLE_TAG_LIMIT);
  const overflow = genericTags.length - visibleTags.length;
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
  // Text-preview ONLY for objects that genuinely have no image (Notes,
  // Content…). An Image whose thumbnail merely failed to load must NOT
  // masquerade as a note — that made "Type: Image" look broken (real
  // confusion, 2026-07-19); it gets an honest muted placeholder instead.
  //
  // The placeholder belongs to that FAILURE case alone. An object with no
  // imageUrl at all never claimed to have a picture — it's a link or a
  // note — and giving it an empty 4:3 frame reads as broken rather than as
  // text (57 Are.na blocks imported as a wall of grey boxes, 2026-07-21).
  // With no text either, the paper block is skipped too and the card is
  // just its title, domain and tags: quiet, and true.
  const hasNoImage = !object.imageUrl;
  const isTextOnly = hasNoImage;
  // What this thing IS (issue #92) — a Book and an Image both arrive as a
  // cover picture, so the type's own fact (author·year, brand·price,
  // domain, @handle) is what tells them apart. One line, mono, quiet.
  const kind = describeObject(object);

  return (
    <div
      draggable
      onDragStart={(e) => {
        // Imperative getState() read, not a reactive subscription — this
        // fires per-drag, not per-render. Dragging a card that's part of an
        // active multi-selection carries the whole group (issue #103);
        // anything else carries just itself. The DRAG_MIME/reveal contract
        // itself lives in lib/objectDrag (issue #132's unified model).
        const { selectedObjectIds } = useStore.getState();
        const ids =
          selectedObjectIds.has(object.id) && selectedObjectIds.size > 1
            ? Array.from(selectedObjectIds)
            : [object.id];
        objectDragProps(ids).onDragStart(e);
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
        textPreview ? (
          <div
            className={[
              "w-full bg-panel rounded-card shadow-card group-hover:shadow-cardHover transition-shadow p-3.5",
              // A document is a file that happens to have text — it gets a
              // paper edge (left rule) so it doesn't read as your own note.
              kind.kind === "document" ? "border-l-2 border-line" : "",
            ].join(" ")}
          >
            <p className="text-[14px] leading-snug text-ink/75 line-clamp-[10] whitespace-pre-line">
              {textPreview}
            </p>
          </div>
        ) : null
      ) : (
        // Floating, near-borderless (design-philosophy: things breathe as
        // pieces on the canvas, not boxed sections) — soft shadow instead
        // of a hard border, lifting slightly on hover.
        <div className="relative w-full rounded-card overflow-hidden bg-panel shadow-card group-hover:shadow-cardHover transition-shadow">
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
            <div className="w-full aspect-[4/3] flex items-center justify-center font-mono text-[10px] uppercase tracking-[0.12em] text-muted/60">
              image unavailable
            </div>
          )}
          {/* Affordance, not badge: only where the MEDIUM behaves
              differently — a video plays, a document is a file. */}
          {kind.affordance === "play" && (
            <span className="absolute inset-0 flex items-center justify-center pointer-events-none">
              <span className="w-9 h-9 rounded-full bg-black/45 backdrop-blur-[1px] flex items-center justify-center text-white text-[12px] leading-none pl-[2px]">
                ▶
              </span>
            </span>
          )}
          {kind.affordance === "file" && (
            <span className="absolute left-1.5 top-1.5 font-mono text-[9px] uppercase tracking-[0.1em] px-1.5 py-0.5 rounded bg-panel/85 text-muted pointer-events-none">
              file
            </span>
          )}
        </div>
      )}
      <div className={kind.portraitCover ? "pt-1.5 pb-1" : "pt-2 pb-1"}>
        <div className="text-[13px] leading-snug line-clamp-2" title={object.title}>
          {object.title}
        </div>
        {kind.meta && (
          <div className="mt-0.5 font-mono text-[10px] leading-snug text-muted truncate" title={kind.meta}>
            {kind.meta}
          </div>
        )}
        {!hideTags && visibleTags.length > 0 && (
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
