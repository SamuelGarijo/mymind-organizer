import { useEffect, useRef, useState } from "react";
import type { DesignObject } from "../types";
import { Card } from "./Card";

const INITIAL_COUNT = 80;
const BATCH_SIZE = 120;

export function Grid({
  objects,
  tagFrequency,
  onOpen,
  emptyLabel,
}: {
  objects: DesignObject[];
  tagFrequency: Map<string, number>;
  onOpen: (id: string) => void;
  emptyLabel?: string;
}) {
  // With a full mymind library (~8000 objects) mounting every card at once
  // makes the whole app crawl. Render in batches instead: the sentinel div
  // below the grid grows the count as it scrolls into range, so only what's
  // near the viewport ever exists in the DOM.
  const [renderCount, setRenderCount] = useState(INITIAL_COUNT);
  const sentinelRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    setRenderCount(INITIAL_COUNT);
  }, [objects]);

  useEffect(() => {
    const el = sentinelRef.current;
    if (!el || renderCount >= objects.length) return;
    const observer = new IntersectionObserver(
      (entries) => {
        if (entries.some((e) => e.isIntersecting)) {
          setRenderCount((c) => Math.min(c + BATCH_SIZE, objects.length));
        }
      },
      { rootMargin: "1500px" }
    );
    observer.observe(el);
    return () => observer.disconnect();
  }, [objects.length, renderCount]);

  if (objects.length === 0) {
    return (
      <div className="h-full flex items-center justify-center text-muted text-sm">
        {emptyLabel ?? "Nothing here yet."}
      </div>
    );
  }

  const visible = renderCount < objects.length ? objects.slice(0, renderCount) : objects;

  return (
    <>
      <div className="masonry columns-1 sm:columns-2 md:columns-3 lg:columns-4 xl:columns-5">
        {visible.map((obj) => (
          <Card key={obj.id} object={obj} tagFrequency={tagFrequency} onOpen={onOpen} />
        ))}
      </div>
      {renderCount < objects.length && (
        <div ref={sentinelRef} className="py-6 text-center text-[12px] text-muted">
          Showing {visible.length.toLocaleString()} of {objects.length.toLocaleString()} — scroll
          for more
        </div>
      )}
    </>
  );
}
