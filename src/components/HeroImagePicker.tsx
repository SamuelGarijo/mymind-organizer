import { useMemo, useState } from "react";
import type { DesignObject } from "../types";

/**
 * Pick the image that fronts a collection — by looking at images.
 *
 * It used to be a text input over a `<datalist>` of titles (Samuel,
 * 2026-07-21: "a hero image selector showing text? really?"). Choosing a
 * picture by reading "Collection of Shopping Plaza Directory Signs" asks
 * you to remember which thing that was; a contact sheet just shows you.
 *
 * A search box still sits above, because a collection can hold hundreds —
 * but it filters the sheet, it isn't how you choose.
 */
export function HeroImagePicker({
  candidates,
  selectedId,
  onSelect,
  emptyHint,
}: {
  /** Objects eligible to front this collection — its own members. */
  candidates: DesignObject[];
  selectedId: string | null;
  onSelect: (id: string | null) => void;
  emptyHint: string;
}) {
  const [query, setQuery] = useState("");

  const withImages = useMemo(() => candidates.filter((o) => o.imageUrl), [candidates]);
  const shown = useMemo(() => {
    const q = query.trim().toLowerCase();
    const pool = q ? withImages.filter((o) => o.title.toLowerCase().includes(q)) : withImages;
    // A grid, not a catalogue: enough to choose from at a glance, and the
    // search box is there for everything past it.
    return pool.slice(0, 60);
  }, [withImages, query]);

  if (withImages.length === 0) {
    return <p className="mt-2 font-mono text-[11px] text-muted/80">{emptyHint}</p>;
  }

  return (
    <div className="mt-2">
      <div className="flex items-baseline justify-between mb-1.5">
        <span className="font-mono text-[10px] uppercase tracking-[0.12em] text-muted">
          Hero image
        </span>
        {selectedId && (
          <button
            onClick={() => onSelect(null)}
            className="font-mono text-[10px] text-muted hover:text-ink underline decoration-dotted"
          >
            clear
          </button>
        )}
      </div>

      {withImages.length > 12 && (
        <input
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="Filter…"
          className="w-full mb-1.5 rounded-lg border border-line px-2.5 py-1 font-mono text-[11px] outline-none focus:border-accent"
        />
      )}

      <div className="grid grid-cols-6 gap-1.5 max-h-44 overflow-y-auto pr-0.5">
        {shown.map((o) => {
          const active = o.id === selectedId;
          return (
            <button
              key={o.id}
              onClick={() => onSelect(active ? null : o.id)}
              title={o.title}
              aria-pressed={active}
              className={[
                "aspect-square rounded-md overflow-hidden border transition-shadow",
                active
                  ? "border-accent ring-2 ring-accent/40"
                  : "border-line hover:border-ink/30",
              ].join(" ")}
            >
              <img src={o.imageUrl} alt="" className="w-full h-full object-cover" />
            </button>
          );
        })}
      </div>

      {shown.length === 0 && (
        <p className="font-mono text-[11px] text-muted/80 py-2">Nothing matches "{query}".</p>
      )}
    </div>
  );
}
