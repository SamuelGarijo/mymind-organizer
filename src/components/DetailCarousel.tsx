import { useEffect, useMemo, useRef, useState } from "react";
import { BLOB_TYPE_KEY, asFieldString } from "../lib/mymindSync";
import type { DesignObject } from "../types";

const SWIPE_THRESHOLD_PX = 60;
const ZOOM_MIN = 1;
const ZOOM_MAX = 4;
const ZOOM_STEP = 0.25;

/**
 * Third detail-view mode (issue #108) — fullscreen, image-only browsing
 * across whatever's currently visible, no metadata/fields at all (that's
 * what DetailPanel's "side"/"centered" modes are for). Supports every
 * input method the issue asked for: on-screen arrows, keyboard left/right,
 * a drag/swipe gesture, and trackpad horizontal scroll (wheel deltaX).
 *
 * Non-image items are skipped entirely (issue's own open question,
 * resolved this way: this mode is specifically for looking at images, so
 * an object with nothing to show isn't a stop on this particular tour —
 * "side"/"centered" modes still show it once you leave carousel mode).
 */
export function DetailCarousel({
  objects,
  currentId,
  onClose,
}: {
  objects: DesignObject[];
  currentId: string;
  onClose: () => void;
}) {
  const imageObjects = useMemo(() => objects.filter((o) => o.imageUrl), [objects]);
  const startIndex = useMemo(() => {
    const i = imageObjects.findIndex((o) => o.id === currentId);
    return i === -1 ? 0 : i;
  }, [imageObjects, currentId]);
  const [index, setIndex] = useState(startIndex);
  // Zoom in/out (issue follow-up) — a plain CSS scale on top of the
  // fit-to-viewport size below, not a separate crop/pan mode; resets on
  // every navigation since "zoomed into the last image" carrying over to
  // a brand new one would be surprising.
  const [zoom, setZoom] = useState(1);
  // Full width (issue #123) — drops the height cap so the image fills the
  // viewport's width instead of fitting inside it; a persisted-for-the-
  // session preference (unlike zoom), since liking wide framing doesn't
  // reset per image.
  const [fullWidth, setFullWidth] = useState(false);
  // Hi-res original (issue #123) — falls back to the same thumbnail this
  // always used if the object has no real uploaded blob, or mymind 422s
  // fetching it (a saved webpage, a blob mymind can't serve at all).
  const [hiResFailed, setHiResFailed] = useState(false);
  const dragStartX = useRef<number | null>(null);
  const wheelCooldown = useRef(false);

  useEffect(() => setIndex(startIndex), [startIndex]);
  useEffect(() => setZoom(1), [index]);
  useEffect(() => setHiResFailed(false), [index]);

  const goPrev = () => setIndex((i) => Math.max(0, i - 1));
  const goNext = () => setIndex((i) => Math.min(imageObjects.length - 1, i + 1));
  const zoomIn = () => setZoom((z) => Math.min(ZOOM_MAX, +(z + ZOOM_STEP).toFixed(2)));
  const zoomOut = () => setZoom((z) => Math.max(ZOOM_MIN, +(z - ZOOM_STEP).toFixed(2)));

  useEffect(() => {
    function handleKeyDown(e: KeyboardEvent) {
      if (e.key === "Escape") onClose();
      if (e.key === "ArrowLeft") goPrev();
      if (e.key === "ArrowRight") goNext();
      if (e.key === "+" || e.key === "=") zoomIn();
      if (e.key === "-" || e.key === "_") zoomOut();
      if (e.key === "0") setZoom(1);
    }
    document.addEventListener("keydown", handleKeyDown);
    return () => document.removeEventListener("keydown", handleKeyDown);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [onClose, imageObjects.length]);

  if (imageObjects.length === 0) {
    return (
      <div className="fixed inset-0 z-50 bg-black/90 flex items-center justify-center text-white/70 text-sm">
        <button onClick={onClose} className="absolute top-4 right-4 text-white/80 hover:text-white text-2xl leading-none">
          ×
        </button>
        Nothing with an image to browse here.
      </div>
    );
  }

  const object = imageObjects[index];
  const blobType = asFieldString(object.fields[BLOB_TYPE_KEY]);
  const hasImageBlob = object.source === "mymind" && blobType.startsWith("image/");
  const imgSrc =
    hasImageBlob && !hiResFailed
      ? `/api/mymind/blob/${object.id}?type=${encodeURIComponent(blobType)}`
      : object.imageUrl;

  return (
    <div
      className="group fixed inset-0 z-50 bg-black/90 flex items-center justify-center select-none overflow-auto"
      onPointerDown={(e) => {
        dragStartX.current = e.clientX;
      }}
      onPointerUp={(e) => {
        if (dragStartX.current === null) return;
        const dx = e.clientX - dragStartX.current;
        dragStartX.current = null;
        if (dx > SWIPE_THRESHOLD_PX) goPrev();
        else if (dx < -SWIPE_THRESHOLD_PX) goNext();
      }}
      onWheel={(e) => {
        // Mac three-finger/two-finger trackpad swipe reports as a
        // horizontal wheel delta — only treat it as a swipe when it's
        // clearly horizontal (not an accidental vertical scroll), and
        // cool down for a beat so one physical swipe gesture (many wheel
        // events) triggers exactly one slide change, not several.
        if (Math.abs(e.deltaX) <= Math.abs(e.deltaY) || wheelCooldown.current) return;
        wheelCooldown.current = true;
        setTimeout(() => {
          wheelCooldown.current = false;
        }, 400);
        if (e.deltaX > 0) goNext();
        else goPrev();
      }}
    >
      <button
        onClick={onClose}
        className="absolute top-4 right-4 text-white/80 hover:text-white text-2xl leading-none z-10"
        aria-label="Close carousel"
      >
        ×
      </button>

      {index > 0 && (
        <button
          onClick={goPrev}
          className="absolute left-4 top-1/2 -translate-y-1/2 text-white/70 hover:text-white text-4xl leading-none z-10 px-2"
          aria-label="Previous image"
        >
          ‹
        </button>
      )}
      {index < imageObjects.length - 1 && (
        <button
          onClick={goNext}
          className="absolute right-4 top-1/2 -translate-y-1/2 text-white/70 hover:text-white text-4xl leading-none z-10 px-2"
          aria-label="Next image"
        >
          ›
        </button>
      )}

      <img
        key={object.id}
        src={imgSrc}
        alt={object.title}
        draggable={false}
        onError={() => {
          if (hasImageBlob && !hiResFailed) setHiResFailed(true);
        }}
        // Uses nearly the full viewport by default (issue follow-up: "100%
        // of the viewport height") — a hair short of 100 so the close/arrow
        // controls above never get fully covered. Full-width mode (#123)
        // drops the height cap instead, so a tall image can run past the
        // viewport (the outer container scrolls). `zoom` scales further on
        // top of whichever base size is active.
        style={{ transform: `scale(${zoom})` }}
        className={[
          "object-contain pointer-events-none transition-transform",
          fullWidth ? "w-[98vw] h-auto" : "max-w-[98vw] max-h-[96vh]",
        ].join(" ")}
      />

      {/* Zoom + full-width controls (issue #123) — hidden until you hover
          the carousel, so they don't sit on top of the image at rest. */}
      <div className="absolute top-4 left-4 z-10 flex items-center gap-1 bg-black/40 rounded-lg px-1 py-1 opacity-0 group-hover:opacity-100 transition-opacity">
        <button
          onClick={zoomOut}
          disabled={zoom <= ZOOM_MIN}
          className="text-white/80 hover:text-white disabled:opacity-30 w-7 h-7 text-lg leading-none"
          aria-label="Zoom out"
        >
          −
        </button>
        <span className="text-white/70 text-[11px] w-10 text-center">{Math.round(zoom * 100)}%</span>
        <button
          onClick={zoomIn}
          disabled={zoom >= ZOOM_MAX}
          className="text-white/80 hover:text-white disabled:opacity-30 w-7 h-7 text-lg leading-none"
          aria-label="Zoom in"
        >
          +
        </button>
        <button
          onClick={() => setFullWidth((v) => !v)}
          className={[
            "w-7 h-7 text-[13px] leading-none rounded",
            fullWidth ? "bg-white/20 text-white" : "text-white/80 hover:text-white",
          ].join(" ")}
          aria-label="Toggle full width"
          title="Use the full viewport width"
        >
          ⇔
        </button>
      </div>

      <div className="absolute bottom-5 left-1/2 -translate-x-1/2 text-white/80 text-[13px] max-w-[80vw] truncate text-center">
        {object.title} <span className="text-white/40">· {index + 1}/{imageObjects.length}</span>
      </div>
    </div>
  );
}
