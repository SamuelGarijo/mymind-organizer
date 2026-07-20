import { useEffect, useMemo, useRef, useState } from "react";
import { Palette, Sparkle, X } from "@phosphor-icons/react";
import { useShallow } from "zustand/react/shallow";
import { allObjectsOf, useStore } from "../store";
import { rankBySimilarityMode, type SimilarityMode } from "../lib/hybridSimilarity";
import { applyDragGhost, DRAG_MIME } from "../lib/objectDrag";
import type { DesignObject, ManualCollection } from "../types";

/** Internal reorder payload — distinct from DRAG_MIME so dragging a bench
 * item OUT (to a sidebar collection, a classify folder…) still carries the
 * normal object-ids contract, while drops WITHIN the bench reorder. */
const BENCH_MIME = "application/x-organizer-bench-reorder";

/** How many hybrid-similarity neighbours a per-item ✦ pulls in. */
const VIBE_BATCH = 12;

type UndoBuffer = { ids: string[]; label: string } | null;

/**
 * The Workbench — a temporary side worktable, deliberately NOT another
 * collection system (design-philosophy: delay formalization). It gathers
 * provisional groups of references before they mean anything: drag things
 * in, reorder, compare, pull in same-vibe neighbours — all reversible, all
 * without touching collections, roles or facets. Formalizing ("save as
 * collection", "add to existing") is offered only at the end, never
 * required.
 *
 * Spatially it is a compartment of the workshop, not a floating inspector:
 * it slides in flush from the right edge (contrast with ClassifyPanel,
 * which floats — that distinction is deliberate: Classify is a conditional
 * module, the bench is architecture). The original view stays intact and
 * usable beside it — non-destructive exploration ("don't navigate away
 * from a thought; open space beside it").
 *
 * Safety model: contents persist across sessions (store.workbenchIds is in
 * the persisted slice), removals and clear are undoable in place, and the
 * only confirmation-like surface is the undo row itself — no dialogs.
 */
export function Workbench({ onOpenDetail }: { onOpenDetail: (id: string) => void }) {
  const state = useStore(
    useShallow((s) => ({
      objects: s.objects,
      collections: s.collections,
      collectionOrder: s.collectionOrder,
      workbenchIds: s.workbenchIds,
      setWorkbenchOpen: s.setWorkbenchOpen,
      addToWorkbench: s.addToWorkbench,
      removeFromWorkbench: s.removeFromWorkbench,
      reorderWorkbench: s.reorderWorkbench,
      clearWorkbench: s.clearWorkbench,
      addManualCollection: s.addManualCollection,
      assignToManualCollection: s.assignToManualCollection,
    }))
  );
  const [dragOverId, setDragOverId] = useState<string | null>(null);
  const [surfaceDragOver, setSurfaceDragOver] = useState(false);
  const [undo, setUndo] = useState<UndoBuffer>(null);
  const [saveMode, setSaveMode] = useState<"none" | "new" | "existing">("none");
  const [newName, setNewName] = useState("");
  const undoTimer = useRef<number | null>(null);

  const items = useMemo(
    () =>
      state.workbenchIds
        .map((id) => state.objects[id])
        .filter((o): o is DesignObject => Boolean(o)),
    [state.workbenchIds, state.objects]
  );
  // Shared store-level list — same identity as every other similarity
  // caller, so the corpus/tfidf caches hit instead of rebuilding per pool.
  const allObjectsList = allObjectsOf(state.objects);
  const manualCollections = useMemo(
    () =>
      state.collectionOrder
        .map((id) => state.collections[id])
        .filter((c): c is ManualCollection => c?.type === "manual"),
    [state.collectionOrder, state.collections]
  );

  // The undo row lingers long enough to be reachable, then lapses — quiet
  // reversibility instead of confirmation dialogs.
  function offerUndo(ids: string[], label: string) {
    if (undoTimer.current) window.clearTimeout(undoTimer.current);
    setUndo({ ids, label });
    undoTimer.current = window.setTimeout(() => setUndo(null), 8000);
  }
  useEffect(
    () => () => {
      if (undoTimer.current) window.clearTimeout(undoTimer.current);
    },
    []
  );

  function removeOne(id: string) {
    state.removeFromWorkbench(id);
    offerUndo([id], "removed 1");
  }
  function clearAll() {
    if (items.length === 0) return;
    const ids = items.map((o) => o.id);
    state.clearWorkbench();
    offerUndo(ids, `cleared ${ids.length}`);
  }

  /** Pull this item's similar neighbours into the bench, in a specific
   * mode (#136: form = visual likeness, content = semantic) — secondary
   * exploration happens INSIDE the bench, the main view never changes. */
  function pullVibes(seed: DesignObject, mode: Exclude<SimilarityMode, "blend">) {
    const st = useStore.getState();
    const candidates = allObjectsList.filter(
      (o) => o.id !== seed.id && !state.workbenchIds.includes(o.id)
    );
    const similar = rankBySimilarityMode(seed, candidates, allObjectsList, {
      mode,
      limit: VIBE_BATCH,
      relations: st.objectRelations,
    });
    state.addToWorkbench(similar.map((r) => r.id));
  }

  function handleSurfaceDrop(e: React.DragEvent) {
    e.preventDefault();
    setSurfaceDragOver(false);
    setDragOverId(null);
    if (e.dataTransfer.getData(BENCH_MIME)) {
      // Internal reorder dropped on empty space → send to the end.
      state.reorderWorkbench(e.dataTransfer.getData(BENCH_MIME), null);
      return;
    }
    const raw = e.dataTransfer.getData(DRAG_MIME);
    if (!raw) return;
    state.addToWorkbench(JSON.parse(raw) as string[]);
  }

  function saveAsNew() {
    const name = newName.trim();
    if (!name || items.length === 0) return;
    const id = state.addManualCollection(name);
    for (const o of items) state.assignToManualCollection(o.id, id);
    setSaveMode("none");
    setNewName("");
  }

  return (
    <aside
      onDragOver={(e) => {
        e.preventDefault();
        setSurfaceDragOver(true);
      }}
      onDragLeave={(e) => {
        if (!(e.currentTarget as HTMLElement).contains(e.relatedTarget as Node)) {
          setSurfaceDragOver(false);
        }
      }}
      onDrop={handleSurfaceDrop}
      className={[
        // The right Membrane (issue #134) owns position/depth/reveal — this
        // is just the cavity's content: recessed canvas tone, a subtle ring
        // when a drag hovers the surface, no chrome of its own.
        "h-full flex flex-col",
        surfaceDragOver ? "ring-2 ring-inset ring-accent/50" : "",
      ].join(" ")}
      aria-label="Workbench"
    >
      <div className="shrink-0 px-4 pt-4 pb-3 border-b border-line/60 flex items-center justify-between">
        <div className="font-mono text-[10px] uppercase tracking-[0.12em] text-muted">
          Workbench <span className="text-muted/60">{items.length}</span>
        </div>
        <button
          onClick={() => state.setWorkbenchOpen(false)}
          className="w-7 h-7 flex items-center justify-center text-muted hover:text-ink rounded-md hover:bg-line/40 text-[14px]"
          aria-label="Close workbench"
          title="Close (⌘J)"
        >
          <X size={14} />
        </button>
      </div>

      <div className="flex-1 min-h-0 overflow-y-auto px-3 py-3">
        {items.length === 0 ? (
          <div className="h-full flex items-center justify-center text-center px-6">
            <p className="font-mono text-[11px] leading-relaxed text-muted/70">
              a worktable, not a collection — drag things here to gather a
              thought before it has a name. ✦ on any item pulls its same-vibe
              neighbours in beside it.
            </p>
          </div>
        ) : (
          <div className="grid grid-cols-2 gap-2">
            {items.map((o) => (
              <BenchRow
                key={o.id}
                object={o}
                dragOver={dragOverId === o.id}
                onDragOverRow={(over) => setDragOverId(over ? o.id : null)}
                onReorder={(draggedId) => {
                  state.reorderWorkbench(draggedId, o.id);
                  setDragOverId(null);
                }}
                onOpen={() => onOpenDetail(o.id)}
                onRemove={() => removeOne(o.id)}
                onVibes={(mode) => pullVibes(o, mode)}
              />
            ))}
          </div>
        )}
      </div>

      {undo && (
        <div className="shrink-0 mx-3 mb-2 px-3 py-2 rounded-lg bg-line/40 flex items-center justify-between font-mono text-[11px] text-ink/80">
          <span>{undo.label}</span>
          <button
            onClick={() => {
              state.addToWorkbench(undo.ids);
              setUndo(null);
            }}
            className="text-accent hover:underline"
          >
            undo
          </button>
        </div>
      )}

      {items.length > 0 && (
        <div className="shrink-0 border-t border-line/60 px-3 py-3 space-y-2">
          {saveMode === "new" ? (
            <form
              onSubmit={(e) => {
                e.preventDefault();
                saveAsNew();
              }}
              className="flex items-center gap-1.5"
            >
              <input
                autoFocus
                value={newName}
                onChange={(e) => setNewName(e.target.value)}
                onKeyDown={(e) => e.key === "Escape" && setSaveMode("none")}
                placeholder="collection name…"
                className="flex-1 rounded-lg border border-line/70 px-2.5 py-1.5 font-mono text-[12px] outline-none focus:border-accent/40"
              />
              <button type="submit" className="font-mono text-[11px] text-accent hover:underline shrink-0">
                save
              </button>
            </form>
          ) : saveMode === "existing" ? (
            <div className="max-h-40 overflow-y-auto flex flex-col gap-0.5">
              <button
                onClick={() => setSaveMode("none")}
                className="text-left font-mono text-[10px] text-muted hover:text-ink px-1"
              >
                ← back
              </button>
              {manualCollections.map((c) => (
                <button
                  key={c.id}
                  onClick={() => {
                    for (const o of items) state.assignToManualCollection(o.id, c.id);
                    setSaveMode("none");
                  }}
                  className="text-left px-2.5 py-1.5 rounded-lg font-mono text-[12px] text-ink/85 hover:bg-line/30"
                >
                  ▤ {c.name}
                </button>
              ))}
            </div>
          ) : (
            <div className="flex items-center gap-2 font-mono text-[11px]">
              <button
                onClick={() => {
                  const st = useStore.getState();
                  const id = st.createCanvas(
                    `Canvas — ${new Date().toLocaleDateString()}`,
                    st.workbenchIds
                  );
                  st.openCanvas(id);
                }}
                className="text-ink/80 hover:text-ink hover:underline decoration-dotted underline-offset-2"
                title="Lay this set out on an infinite canvas — arrange freely, connect objects to record relationships (#133)"
              >
                open as canvas
              </button>
              <span className="text-muted/40">·</span>
              <button
                onClick={() => setSaveMode("new")}
                className="text-ink/80 hover:text-ink hover:underline decoration-dotted underline-offset-2"
                title="Formalize this group as a new manual collection"
              >
                save as collection
              </button>
              <span className="text-muted/40">·</span>
              <button
                onClick={() => setSaveMode("existing")}
                className="text-ink/80 hover:text-ink hover:underline decoration-dotted underline-offset-2"
                title="Add everything here to an existing collection"
              >
                add to existing
              </button>
              <span className="flex-1" />
              <button
                onClick={clearAll}
                className="text-muted hover:text-ink hover:underline decoration-dotted underline-offset-2"
                title="Clear the bench — undoable for a few seconds"
              >
                clear
              </button>
            </div>
          )}
        </div>
      )}
    </aside>
  );
}

function BenchRow({
  object,
  dragOver,
  onDragOverRow,
  onReorder,
  onOpen,
  onRemove,
  onVibes,
}: {
  object: DesignObject;
  dragOver: boolean;
  onDragOverRow: (over: boolean) => void;
  onReorder: (draggedId: string) => void;
  onOpen: () => void;
  onRemove: () => void;
  onVibes: (mode: "form" | "content") => void;
}) {
  const [imgFailed, setImgFailed] = useState(false);
  return (
    <div
      draggable
      onDragStart={(e) => {
        // Carries BOTH contracts: BENCH_MIME so in-bench drops reorder,
        // DRAG_MIME so dragging out to a collection/folder still works.
        e.dataTransfer.setData(BENCH_MIME, object.id);
        e.dataTransfer.setData(DRAG_MIME, JSON.stringify([object.id]));
        e.dataTransfer.effectAllowed = "copyMove";
        applyDragGhost(e, 1);
      }}
      onDragOver={(e) => {
        e.preventDefault();
        e.stopPropagation();
        onDragOverRow(true);
      }}
      onDragLeave={() => onDragOverRow(false)}
      onDrop={(e) => {
        e.stopPropagation();
        e.preventDefault();
        const benchId = e.dataTransfer.getData(BENCH_MIME);
        if (benchId) {
          onReorder(benchId);
          return;
        }
        // External drop on a row behaves like a surface drop before it.
        const raw = e.dataTransfer.getData(DRAG_MIME);
        if (raw) useStore.getState().addToWorkbench(JSON.parse(raw) as string[]);
        onDragOverRow(false);
      }}
      className={[
        // Objects as visual entities on a table, not a text list — image
        // first, a whisper of a caption, controls only on hover.
        "group relative rounded-lg overflow-hidden cursor-grab active:cursor-grabbing bg-panel shadow-card hover:shadow-cardHover transition-shadow",
        dragOver ? "ring-2 ring-accent/60" : "",
      ].join(" ")}
    >
      <button onClick={onOpen} className="block w-full" title={object.title}>
        {object.imageUrl && !imgFailed ? (
          <img
            src={object.imageUrl}
            alt=""
            className="w-full aspect-square object-cover pointer-events-none"
            onError={() => setImgFailed(true)}
          />
        ) : (
          <span className="flex w-full aspect-square p-2 font-mono text-[9px] leading-snug text-ink/70 text-left overflow-hidden pointer-events-none bg-line/15">
            {object.title}
          </span>
        )}
        <span className="block px-1.5 py-1 font-mono text-[9px] text-muted truncate text-left">
          {object.title}
        </span>
      </button>
      <div className="absolute top-1 right-1 flex items-center gap-0.5 opacity-0 group-hover:opacity-100 transition-opacity">
        <button
          onClick={() => onVibes("form")}
          className="w-6 h-6 rounded-md flex items-center justify-center bg-panel/85 backdrop-blur text-muted hover:text-accent shadow-card"
          title="Pull VISUALLY similar things onto the bench (same form)"
          aria-label={`Add items visually similar to ${object.title}`}
        >
          <Palette size={12} />
        </button>
        <button
          onClick={() => onVibes("content")}
          className="w-6 h-6 rounded-md flex items-center justify-center bg-panel/85 backdrop-blur text-muted hover:text-accent shadow-card"
          title="Pull SEMANTICALLY similar things onto the bench (same content)"
          aria-label={`Add items about the same thing as ${object.title}`}
        >
          <Sparkle size={12} />
        </button>
        <button
          onClick={onRemove}
          className="w-6 h-6 rounded-md flex items-center justify-center bg-panel/85 backdrop-blur text-muted hover:text-ink shadow-card"
          title="Remove from bench (undoable)"
          aria-label={`Remove ${object.title} from workbench`}
        >
          <X size={12} />
        </button>
      </div>
    </div>
  );
}
