import { useEffect, useMemo, useRef, useState } from "react";
import type { DesignObject, FacetField } from "../types";
import { Card } from "./Card";
import { orderedFacetBuckets } from "../lib/primaryFacets";
import { UNGROUPED_LABEL } from "../lib/grouping";
import { assignMasonryColumns, columnsForWidth, GRID_GAP } from "../lib/masonry";
import { norm } from "../lib/textNorm";

/**
 * "Organize by" (§9, 2026-07-21) — the collection rebuilt as a long
 * editorial landing page: one section per value of the chosen property,
 * clear heading and count, "Not yet classified" as a real closing section.
 * This is a way of BROWSING and understanding the collection — the same
 * data Classify assigns, read as chapters instead of edited as values.
 *
 * Not the Classify membrane, not a folder tree: a full page of the
 * collection itself, navigated like a publication — which is what the
 * chapter rail (§10) is for: quiet ticks at rest, names on hover, click
 * to jump, the current chapter marked while scrolling.
 *
 * Sections cap their initial render (a couple of rows) with "show all N" —
 * an editorial page must open fast even over a 1,200-object collection,
 * and a chapter you're interested in is one click from complete.
 */

const LABEL_NOT_CLASSIFIED = "Not yet classified";

function useContainerWidth(ref: React.RefObject<HTMLElement>): number {
  const [width, setWidth] = useState(1024);
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const observer = new ResizeObserver((entries) => {
      const w = entries[0]?.contentRect.width;
      if (w) setWidth(w);
    });
    observer.observe(el);
    return () => observer.disconnect();
  }, [ref]);
  return width;
}

type Section = {
  label: string;
  objects: DesignObject[];
  /** §5: a child value (optionParents) renders as a subchapter of its
   * parent — indented heading, nested rail entry. */
  parent?: string;
};

export function OrganizeView({
  objects,
  field,
  tagFrequency,
  onOpen,
  zoom = 0,
}: {
  /** The collection members this property can describe (the active
   * entity type's objects). */
  objects: DesignObject[];
  field: FacetField;
  tagFrequency: Map<string, number>;
  onOpen: (id: string) => void;
  zoom?: number;
}) {
  const containerRef = useRef<HTMLDivElement>(null);
  const containerWidth = useContainerWidth(containerRef);
  const sectionRefs = useRef<Map<string, HTMLElement>>(new Map());
  const [expanded, setExpanded] = useState<Set<string>>(new Set());
  const [current, setCurrent] = useState<string | null>(null);

  const sections: Section[] = useMemo(() => {
    const buckets = orderedFacetBuckets(objects, field).map((b) => ({
      label: b.label === UNGROUPED_LABEL ? LABEL_NOT_CLASSIFIED : b.label,
      objects: b.objects,
    }));
    const parents = field.optionParents;
    if (!parents || Object.keys(parents).length === 0) return buckets;
    // Hierarchical values (§5): children follow their parent, in the
    // parent's position — never a second nesting system, just ordering
    // and an indent.
    const byLabel = new Map(buckets.map((b) => [norm(b.label), b]));
    const childOf = new Map<string, string>(
      Object.entries(parents).map(([child, parent]) => [norm(child), parent])
    );
    const ordered: Section[] = [];
    for (const bucket of buckets) {
      if (childOf.has(norm(bucket.label))) continue; // placed under its parent
      ordered.push(bucket);
      for (const [childKey, parentName] of childOf) {
        if (norm(parentName) !== norm(bucket.label)) continue;
        const child = byLabel.get(childKey);
        if (child) ordered.push({ ...child, parent: bucket.label });
      }
    }
    // Orphan children whose parent has no bucket still show, flat.
    for (const bucket of buckets) {
      if (!ordered.includes(bucket) && !ordered.some((s) => norm(s.label) === norm(bucket.label))) {
        ordered.push(bucket);
      }
    }
    return ordered;
  }, [objects, field]);

  const classified = objects.length - (sections.find((s) => s.label === LABEL_NOT_CLASSIFIED)?.objects.length ?? 0);

  const columnCount = Math.max(1, Math.min(8, columnsForWidth(containerWidth) + zoom));
  const columnWidth = (containerWidth - (columnCount - 1) * GRID_GAP) / columnCount;
  /** Initial per-section render: about two rows of cards. */
  const initialCap = columnCount * 2;

  // §10: the current chapter follows the scroll — the topmost section
  // whose heading has passed the upper third of the viewport.
  useEffect(() => {
    const observer = new IntersectionObserver(
      (entries) => {
        for (const entry of entries) {
          if (entry.isIntersecting) {
            setCurrent((entry.target as HTMLElement).dataset.sectionLabel ?? null);
          }
        }
      },
      { rootMargin: "0px 0px -70% 0px" }
    );
    for (const el of sectionRefs.current.values()) observer.observe(el);
    return () => observer.disconnect();
  }, [sections]);

  function jumpTo(label: string) {
    sectionRefs.current.get(label)?.scrollIntoView({ behavior: "smooth", block: "start" });
  }

  if (objects.length === 0) {
    return (
      <div className="h-full flex items-center justify-center text-muted text-sm">
        Nothing here yet.
      </div>
    );
  }

  return (
    <div className="flex gap-1">
      {/* Chapter rail (§10): a narrow vertical index, quiet at rest
          (ticks), names on hover, current chapter marked. The nav's LAYOUT
          box never changes width — the expanding list is an inner surface
          that overflows OVER the cards like a hover menu (Samuel,
          2026-07-21: the index must be an overlay, never displace the
          objects), picking up a panel background for legibility. */}
      <nav
        // top-[72px], not top-2: the scroll container reserves pt-16 (64px)
        // for the floating command bar, and `sticky` resolves against the
        // scrollport, not that padding — at top-2 the rail slid under the
        // bar as soon as the page scrolled.
        className="group/rail sticky top-[72px] self-start shrink-0 w-4 z-20"
        aria-label={`${field.name} chapters`}
      >
        <div className="w-4 group-hover/rail:w-48 overflow-hidden transition-[width] duration-200 rounded-xl group-hover/rail:bg-panel/95 group-hover/rail:shadow-cardHover group-hover/rail:backdrop-blur">
          <div className="flex flex-col gap-1 py-1 group-hover/rail:p-2">
            {sections.map((section) => {
              const active = current === section.label;
              return (
                <button
                  key={section.label}
                  onClick={() => jumpTo(section.label)}
                  className={[
                    "flex items-center gap-2 text-left",
                    section.parent ? "pl-3" : "",
                  ].join(" ")}
                  title={`${section.label} · ${section.objects.length}`}
                >
                  <span
                    className={[
                      "shrink-0 rounded-full transition-all",
                      active ? "w-3 h-0.5 bg-ink" : "w-2 h-px bg-line",
                    ].join(" ")}
                  />
                  <span
                    className={[
                      "font-mono text-[10px] truncate opacity-0 group-hover/rail:opacity-100 transition-opacity",
                      active ? "text-ink" : "text-muted",
                      section.label === LABEL_NOT_CLASSIFIED ? "italic" : "",
                    ].join(" ")}
                  >
                    {section.label} <span className="text-muted/60">{section.objects.length}</span>
                  </span>
                </button>
              );
            })}
          </div>
        </div>
      </nav>

      <div ref={containerRef} className="flex-1 min-w-0">
        {/* §11: coverage as a fact, stated once at the top. */}
        <div className="mb-5 font-mono text-[11px] text-muted">
          {objects.length.toLocaleString()} {field.name.toLowerCase()}-organized ·{" "}
          {classified.toLocaleString()} classified (
          {objects.length ? Math.round((classified / objects.length) * 100) : 0}%) ·{" "}
          {(objects.length - classified).toLocaleString()} not yet
        </div>

        <div className="space-y-10">
          {sections.map((section) => {
            const isOpen = expanded.has(section.label);
            const shown = isOpen ? section.objects : section.objects.slice(0, initialCap);
            const columns = assignMasonryColumns(shown, columnCount, columnWidth);
            const hidden = section.objects.length - shown.length;
            return (
              <section
                key={section.label}
                data-section-label={section.label}
                ref={(el) => {
                  if (el) sectionRefs.current.set(section.label, el);
                  else sectionRefs.current.delete(section.label);
                }}
                className="scroll-mt-16"
              >
                <h2
                  className={[
                    "mb-3 flex items-baseline gap-2",
                    section.parent ? "pl-4" : "",
                  ].join(" ")}
                >
                  <span
                    className={[
                      "text-[17px] font-medium tracking-tight",
                      section.label === LABEL_NOT_CLASSIFIED ? "text-muted italic" : "text-ink",
                    ].join(" ")}
                  >
                    {section.label}
                  </span>
                  <span className="font-mono text-[11px] text-muted">
                    {section.objects.length}
                  </span>
                </h2>
                <div className="flex items-start" style={{ gap: GRID_GAP }}>
                  {columns.map((column, i) => (
                    <div key={i} className="flex-1 min-w-0 flex flex-col" style={{ gap: GRID_GAP }}>
                      {column.map((obj) => (
                        <Card
                          key={obj.id}
                          object={obj}
                          tagFrequency={tagFrequency}
                          onOpen={onOpen}
                          onCardClick={(id) => onOpen(id)}
                        />
                      ))}
                    </div>
                  ))}
                </div>
                {hidden > 0 && (
                  <button
                    onClick={() => setExpanded((cur) => new Set(cur).add(section.label))}
                    className="mt-3 font-mono text-[11px] text-muted hover:text-ink hover:underline decoration-dotted underline-offset-2"
                  >
                    show all {section.objects.length.toLocaleString()}
                  </button>
                )}
              </section>
            );
          })}
        </div>
      </div>
    </div>
  );
}
