import type { DesignObject } from "../types";
import { BLOB_ASPECT_KEY, NOTE_CONTENT_KEY, asFieldString } from "./mymindSync";

/** Matches `.masonry`'s old `column-gap`/`margin-bottom` in index.css —
 * kept in sync manually since both now express the same visual gap, one in
 * CSS (unavoidable — Tailwind's `gap-4` utility) and one here (feeding the
 * height estimate below). */
export const GRID_GAP = 16;

/** Same breakpoints Tailwind's default theme uses for sm/md/lg/xl, now
 * applied to the grid *container's* width (via ResizeObserver in Grid.tsx)
 * rather than the viewport's — a deliberate change from the old CSS
 * `columns-1 sm:columns-2 md:columns-3 lg:columns-4 xl:columns-5`, which
 * couldn't see the sidebar and would size columns off raw viewport width
 * even while collapsed/expanded ate into the actual available space. */
const COLUMN_BREAKPOINTS: [minWidth: number, columns: number][] = [
  [1280, 5],
  [1024, 4],
  [768, 3],
  [640, 2],
  [0, 1],
];

export function columnsForWidth(containerWidth: number): number {
  for (const [minWidth, columns] of COLUMN_BREAKPOINTS) {
    if (containerWidth >= minWidth) return columns;
  }
  return 1;
}

// ---------------------------------------------------------------------------
// Height estimation — deliberately approximate. The goal is only to decide
// "which column is currently shortest" well enough that the grid balances
// the way Pinterest-style masonry does; a few px of estimate error per card
// doesn't matter since each column still lays its own cards out via normal
// document flow (real heights), not absolute positioning. Measuring the
// real DOM instead (render, measure, reflow) would be more accurate but
// means either a double-render pass or per-card ResizeObservers at a scale
// (thousands of cards) that isn't worth it for a "which side is shorter"
// decision.
// ---------------------------------------------------------------------------

/** Rough per-card overhead for the title (line-clamp-2) + tag line below
 * the image/text, common to every card regardless of type — see Card.tsx. */
const METADATA_HEIGHT = 46;
/** Card.tsx's text-preview box: `p-3.5` (14px) padding on all sides. */
const TEXT_CARD_PADDING = 28;
/** `text-[14px] leading-snug` ≈ 14px * 1.375. */
const TEXT_LINE_HEIGHT = 19;
/** Card.tsx caps the text preview at `line-clamp-[10]`. */
const TEXT_MAX_LINES = 10;
/** Rough average glyph width for 14px text — good enough to estimate wrap
 * points without measuring actual text metrics. */
const AVG_CHAR_WIDTH = 7.5;
/** Card.tsx's "no image, no text" fallback box is `aspect-[4/3]`. */
const FALLBACK_ASPECT = 4 / 3;
/** Used when an image card has no known aspect ratio yet (synced before
 * BLOB_ASPECT_KEY existed — needs a resync to backfill; or a non-mymind
 * sample object). A slightly-tall-than-square guess reads better than a
 * perfect square for a photo grid. */
const DEFAULT_IMAGE_ASPECT = 0.85;

function estimateTextLines(text: string, columnWidth: number): number {
  const usableWidth = Math.max(1, columnWidth - TEXT_CARD_PADDING);
  const charsPerLine = Math.max(10, Math.floor(usableWidth / AVG_CHAR_WIDTH));
  const lines = Math.ceil(text.length / charsPerLine) || 1;
  return Math.min(TEXT_MAX_LINES, lines);
}

/** Estimates a card's total rendered height (image/text + metadata),
 * mirroring Card.tsx's own branching (showImage / isTextOnly / fallback). */
export function estimateCardHeight(object: DesignObject, columnWidth: number): number {
  const textPreview = (
    asFieldString(object.fields[NOTE_CONTENT_KEY]) || asFieldString(object.fields.summary)
  ).trim();
  const showImage = !!object.imageUrl;

  if (showImage) {
    const aspect = Number(object.fields[BLOB_ASPECT_KEY]) || DEFAULT_IMAGE_ASPECT;
    return columnWidth / aspect + METADATA_HEIGHT;
  }
  if (textPreview) {
    return (
      estimateTextLines(textPreview, columnWidth) * TEXT_LINE_HEIGHT +
      TEXT_CARD_PADDING +
      METADATA_HEIGHT
    );
  }
  return columnWidth / FALLBACK_ASPECT + METADATA_HEIGHT;
}

/**
 * Assigns items to columns greedily: each item goes into whichever column
 * is currently shortest. Since every column starts at height 0 and ties
 * favor the lowest index, the first `columnCount` items land one per
 * column left-to-right (the "row 1" the issue asks for) purely as a
 * consequence of the tie-break — no special-cased first row needed.
 *
 * Deterministic prefix property: re-running this on a longer prefix of the
 * same ordered `items` (e.g. after the grid's progressive-reveal loads more)
 * reproduces the exact same placement for every item already placed, so
 * revealing more items never reshuffles cards already on screen.
 */
export function assignMasonryColumns(
  items: DesignObject[],
  columnCount: number,
  columnWidth: number
): DesignObject[][] {
  const columns: DesignObject[][] = Array.from({ length: columnCount }, () => []);
  const heights = new Array(columnCount).fill(0);

  for (const item of items) {
    let shortest = 0;
    for (let i = 1; i < columnCount; i++) {
      if (heights[i] < heights[shortest]) shortest = i;
    }
    columns[shortest].push(item);
    heights[shortest] += estimateCardHeight(item, columnWidth) + GRID_GAP;
  }

  return columns;
}
