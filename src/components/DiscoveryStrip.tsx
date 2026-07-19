import { useMemo, useState } from "react";
import { objectDragProps } from "../lib/objectDrag";
import { computeSimilarOutside } from "../lib/similarOutside";
import type { DesignObject } from "../types";

/** Discovery thumb — draggable like every rendered object (N22), honest
 * image-failure fallback like every other thumb. */
function DiscoveryThumb({ object, onOpen }: { object: DesignObject; onOpen: (id: string) => void }) {
  const [failed, setFailed] = useState(false);
  return (
    <button
      onClick={() => onOpen(object.id)}
      {...objectDragProps([object.id])}
      title={object.title}
      className="shrink-0 w-32 h-32 rounded overflow-hidden border border-line/70 bg-panel hover:border-accent/50 cursor-grab active:cursor-grabbing shadow-card"
    >
      {object.imageUrl && !failed ? (
        <img
          src={object.imageUrl}
          alt=""
          loading="lazy"
          className="w-full h-full object-cover pointer-events-none"
          onError={() => setFailed(true)}
        />
      ) : (
        <span className="block w-full h-full p-2 font-mono text-[9px] leading-snug text-muted text-left overflow-hidden pointer-events-none">
          {object.title}
        </span>
      )}
    </button>
  );
}

/**
 * First tenant of the bottom Discovery membrane (issue #134): the
 * collection's same-vibe neighbours from OUTSIDE it — exploration that
 * opens BENEATH the current thought instead of replacing it. Internal
 * hybrid-similarity only for now; external sources (Are.na search,
 * Pinterest, image similarity…) are the membrane's future tenants, not
 * this foundation's scope.
 */
export function DiscoveryStrip({
  members,
  memberIds,
  allObjects,
  onOpen,
}: {
  members: DesignObject[];
  memberIds: Set<string>;
  allObjects: DesignObject[];
  onOpen: (id: string) => void;
}) {
  const similar = useMemo(
    () => computeSimilarOutside(members, memberIds, allObjects),
    [members, memberIds, allObjects]
  );

  return (
    <div className="h-full flex flex-col px-5 pt-3 pb-4">
      <div className="shrink-0 font-mono text-[10px] uppercase tracking-[0.12em] text-muted mb-2.5">
        Discover · similar outside this collection
      </div>
      {similar.length === 0 ? (
        <p className="font-mono text-[11px] text-muted/70">
          nothing similar found outside yet — this world is one of a kind.
        </p>
      ) : (
        <div className="flex-1 min-h-0 flex gap-2.5 overflow-x-auto pb-1">
          {similar.map((o) => (
            <DiscoveryThumb key={o.id} object={o} onOpen={onOpen} />
          ))}
        </div>
      )}
    </div>
  );
}
