import { useEffect, useMemo, useState } from "react";
import { motion } from "motion/react";
import { panelVariants } from "../lib/chrome";
import { useStore } from "../store";
import { orderedFacetBuckets } from "../lib/primaryFacets";
import { rankByHybridSimilarity } from "../lib/hybridSimilarity";
import { UNGROUPED_LABEL } from "../lib/grouping";
import { norm } from "../lib/textNorm";
import { asFieldString } from "../lib/mymindSync";
import { DRAG_MIME } from "./Sidebar";
import type { DesignObject, RoleDefinition } from "../types";

/** Roles / mymind types that read as *text* — the cross-category bridge:
 * when a collection's things are images, related reading links out to the
 * written side of the library (and vice versa, the same set works). */
const TEXTUAL_KEYS = new Set(
  ["article", "note", "text", "writing", "document", "pdf", "webpage", "content", "post"].map(norm)
);

function isTextual(object: DesignObject): boolean {
  if (object.role && TEXTUAL_KEYS.has(norm(object.role))) return true;
  const entity = asFieldString(object.fields.entity_type);
  return entity ? TEXTUAL_KEYS.has(norm(entity)) : false;
}

function PanelLabel({ children }: { children: React.ReactNode }) {
  return (
    <div className="font-mono text-[10px] uppercase tracking-[0.12em] text-muted">{children}</div>
  );
}

/** Tiny thumbnail used in folder peeks and the similar strip — a failed
 * image falls back to the title, never a broken-image glyph. */
function Peek({ object, onOpen }: { object: DesignObject; onOpen: (id: string) => void }) {
  const [failed, setFailed] = useState(false);
  return (
    <button
      onClick={() => onOpen(object.id)}
      title={object.title}
      className="shrink-0 w-12 h-12 rounded-md overflow-hidden border border-line bg-line/20 hover:border-accent/50"
    >
      {object.imageUrl && !failed ? (
        <img
          src={object.imageUrl}
          alt=""
          className="w-full h-full object-cover pointer-events-none"
          onError={() => setFailed(true)}
        />
      ) : (
        <span className="block w-full h-full p-1 text-[7px] leading-tight text-muted text-left overflow-hidden pointer-events-none">
          {object.title}
        </span>
      )}
    </button>
  );
}

/**
 * The conditional floating panel from Samuel's sketch ("this is like a
 * conditional floating panel with tabs… modular pieces that come and go
 * depending on context"). Summoned by ✦ Classify, recedes on close (N21).
 *
 * The inversion that matters (design-philosophy N8): the *unclassified
 * reservoir stays in the main grid* — the sacred space — and the classified
 * values live here as half-naked folder rows that let their content peek
 * through. Drag a thing from the grid onto a folder to classify it.
 *
 * Below the folders, two cross-pollination modules:
 * - Related reading — textual objects from the wider library whose tags
 *   match this facet's values (cross-category: images link to words).
 * - Similar outside — hybrid-similarity neighbours of this collection that
 *   live OUTSIDE it, so the world's edges stay porous.
 */
export function ClassifyPanel({
  roleObjects,
  collectionIds,
  allObjects,
  activeRole,
  fieldName,
  reservoirCount,
  onFieldChange,
  onClose,
  onOpen,
}: {
  /** Collection members carrying the active role — the folders' population. */
  roleObjects: DesignObject[];
  /** Every id in the current collection — the outside/inside boundary. */
  collectionIds: Set<string>;
  /** Whole library (stable reference — feeds the similarity corpus cache). */
  allObjects: DesignObject[];
  activeRole: RoleDefinition;
  fieldName: string;
  /** How many things are still unfolded for this facet — shown as a quiet
   * note here (the grid itself carries no annotation). */
  reservoirCount: number;
  onFieldChange: (name: string) => void;
  onClose: () => void;
  onOpen: (id: string) => void;
}) {
  const primaryFacets = activeRole.primaryFacets ?? [];
  const activeField = activeRole.fields.find((f) => f.name === fieldName);
  const [dragOverLabel, setDragOverLabel] = useState<string | null>(null);
  // Folders created by hand this session that have no members yet — they
  // exist to be dropped into ("+ new folder" in the sketch). Reset per facet.
  const [draftFolders, setDraftFolders] = useState<string[]>([]);
  const [draftName, setDraftName] = useState("");
  useEffect(() => setDraftFolders([]), [fieldName, activeRole.name]);

  const buckets = useMemo(
    () => (activeField ? orderedFacetBuckets(roleObjects, activeField) : []),
    [roleObjects, activeField]
  );
  const valueBuckets = buckets.filter((b) => b.label !== UNGROUPED_LABEL);
  const existingLabels = new Set(valueBuckets.map((b) => norm(b.label)));
  const drafts = draftFolders.filter((d) => !existingLabels.has(norm(d)));

  // Cross-category: textual library objects (outside this collection) whose
  // tags/title mention one of this facet's values — "articles about the
  // tones these images have".
  const relatedReading = useMemo(() => {
    const values = valueBuckets.map((b) => ({ raw: b.label, key: norm(b.label) }));
    if (values.length === 0) return [];
    const hits: { object: DesignObject; matches: string[] }[] = [];
    for (const object of allObjects) {
      if (collectionIds.has(object.id) || !isTextual(object)) continue;
      const tagKeys = new Set(object.tags.map(norm));
      const titleKey = norm(object.title);
      const matches = values
        .filter((v) => tagKeys.has(v.key) || titleKey.includes(v.key))
        .map((v) => v.raw);
      if (matches.length > 0) hits.push({ object, matches });
    }
    return hits.sort((a, b) => b.matches.length - a.matches.length).slice(0, 5);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [allObjects, collectionIds, valueBuckets.map((b) => b.label).join("|")]);

  // Similar things OUTSIDE the collection — a handful of spread-out seeds
  // from the role's members, each ranked against the outside pool with the
  // hybrid engine (#23), merged by best score. Computed once per panel
  // open/facet switch; the corpus cache keys on the allObjects reference.
  const similarOutside = useMemo(() => {
    if (roleObjects.length === 0) return [];
    const step = Math.max(1, Math.floor(roleObjects.length / 5));
    const seeds = [0, 1, 2, 3, 4]
      .map((i) => roleObjects[i * step])
      .filter((o): o is DesignObject => Boolean(o));
    const candidates = allObjects.filter((o) => !collectionIds.has(o.id));
    const best = new Map<string, number>();
    for (const seed of seeds) {
      for (const r of rankByHybridSimilarity(seed, candidates, allObjects, 30)) {
        if ((best.get(r.id) ?? 0) < r.score) best.set(r.id, r.score);
      }
    }
    const byId = new Map(candidates.map((o) => [o.id, o]));
    return Array.from(best.entries())
      .sort((a, b) => b[1] - a[1])
      .slice(0, 10)
      .map(([id]) => byId.get(id))
      .filter((o): o is DesignObject => Boolean(o));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [roleObjects, allObjects, collectionIds]);

  if (!activeField) {
    return (
      <motion.aside
        custom={{ x: 24, y: 0 }}
        variants={panelVariants}
        initial="hidden"
        animate="visible"
        exit="exit"
        className="fixed right-4 top-20 bottom-6 w-[380px] z-30 flex flex-col rounded-2xl border border-line bg-panel/95 backdrop-blur shadow-cardHover p-5">
        <div className="flex items-center justify-between mb-3">
          <PanelLabel>Classifying · {activeRole.name}</PanelLabel>
          <button onClick={onClose} className="text-muted hover:text-ink" aria-label="Close">
            ×
          </button>
        </div>
        <p className="text-[12px] text-muted leading-relaxed">
          "{activeRole.name}" has no primary facets pinned yet — pin some in Item Types (★ next to
          a field) to lay out folders here.
        </p>
      </motion.aside>
    );
  }

  const mode = activeField.type === "multi-select" ? "append" : "replace";

  function handleDrop(e: React.DragEvent, label: string) {
    e.preventDefault();
    setDragOverLabel(null);
    const raw = e.dataTransfer.getData(DRAG_MIME);
    if (!raw) return;
    const ids: string[] = JSON.parse(raw);
    useStore.getState().assignFieldValue(ids, activeField!.name, label, mode);
  }

  function folderRow(label: string, members: DesignObject[]) {
    const over = dragOverLabel === label;
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
          "rounded-xl border bg-canvas/70 px-3 py-2 transition-shadow",
          over ? "border-accent ring-2 ring-accent/30 shadow-cardHover" : "border-line",
        ].join(" ")}
      >
        <div className="flex items-baseline justify-between mb-1.5">
          <span className="font-mono text-[12px] text-ink/85 truncate">{label}</span>
          <span className="font-mono text-[11px] text-muted shrink-0">{members.length}</span>
        </div>
        {members.length > 0 ? (
          <div className="flex gap-1.5 overflow-x-auto pb-0.5">
            {members.slice(0, 14).map((o) => (
              <Peek key={o.id} object={o} onOpen={onOpen} />
            ))}
            {members.length > 14 && (
              <span className="shrink-0 self-center font-mono text-[10px] text-muted px-1">
                +{members.length - 14}
              </span>
            )}
          </div>
        ) : (
          <div className="h-12 rounded-md border border-dashed border-line/80 flex items-center justify-center font-mono text-[10px] text-muted/70">
            drop things here
          </div>
        )}
      </div>
    );
  }

  return (
    <motion.aside
      custom={{ x: 24, y: 0 }}
      variants={panelVariants}
      initial="hidden"
      animate="visible"
      exit="exit"
      className="fixed right-4 top-20 bottom-6 w-[380px] z-30 flex flex-col rounded-2xl border border-line bg-panel/95 backdrop-blur shadow-cardHover overflow-hidden"
      aria-label="Classification folders"
    >
      <div className="shrink-0 px-4 pt-4 pb-3 border-b border-line/70">
        <div className="flex items-center justify-between mb-2">
          <PanelLabel>Classifying · {activeRole.name}</PanelLabel>
          <button onClick={onClose} className="text-muted hover:text-ink text-[15px] leading-none" aria-label="Close">
            ×
          </button>
        </div>
        {primaryFacets.length > 1 && (
          <div className="flex items-center gap-1 flex-wrap">
            {primaryFacets.map((name) => (
              <button
                key={name}
                onClick={() => onFieldChange(name)}
                className={[
                  "tag-chip font-mono shrink-0",
                  name === fieldName ? "border-accent/40 bg-accent/5 text-ink" : "",
                ].join(" ")}
              >
                {name}
              </button>
            ))}
          </div>
        )}
        {reservoirCount > 0 && (
          <div className="mt-1.5 font-mono text-[10px] text-muted/80">
            {reservoirCount.toLocaleString()} unfolded — drag them in from the grid
          </div>
        )}
      </div>

      <div className="flex-1 overflow-y-auto px-4 py-3 flex flex-col gap-2">
        {valueBuckets.map((b) => folderRow(b.label, b.objects))}
        {drafts.map((d) => folderRow(d, []))}

        <form
          onSubmit={(e) => {
            e.preventDefault();
            const name = draftName.trim();
            if (!name || existingLabels.has(norm(name))) return;
            setDraftFolders((cur) => [...cur, name]);
            setDraftName("");
          }}
          className="flex items-center gap-1.5 pt-0.5"
        >
          <input
            value={draftName}
            onChange={(e) => setDraftName(e.target.value)}
            placeholder="+ new folder"
            className="flex-1 rounded-lg border border-dashed border-line bg-transparent px-2.5 py-1.5 font-mono text-[11px] outline-none focus:border-accent placeholder:text-muted/60"
          />
          {draftName.trim() !== "" && (
            <button type="submit" className="font-mono text-[11px] text-accent hover:underline shrink-0">
              add
            </button>
          )}
        </form>

        {relatedReading.length > 0 && (
          <div className="mt-3">
            <PanelLabel>Related reading</PanelLabel>
            <div className="mt-1.5 flex flex-col gap-1">
              {relatedReading.map(({ object, matches }) => (
                <button
                  key={object.id}
                  onClick={() => onOpen(object.id)}
                  className="text-left group"
                  title={object.title}
                >
                  <span className="text-[12px] text-ink/80 group-hover:underline decoration-dotted underline-offset-2 line-clamp-1">
                    {object.title}
                  </span>
                  <span className="font-mono text-[10px] text-muted">
                    {matches.join(" · ")}
                  </span>
                </button>
              ))}
            </div>
          </div>
        )}
      </div>

      {similarOutside.length > 0 && (
        <div className="shrink-0 border-t border-line/70 px-4 py-3">
          <PanelLabel>Similar · outside this collection</PanelLabel>
          <div className="mt-2 flex gap-1.5 overflow-x-auto pb-0.5">
            {similarOutside.map((o) => (
              <Peek key={o.id} object={o} onOpen={onOpen} />
            ))}
          </div>
        </div>
      )}
    </motion.aside>
  );
}
