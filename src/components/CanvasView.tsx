import { useCallback, useRef, useState } from "react";
import {
  BaseBoxShapeUtil,
  HTMLContainer,
  T,
  Tldraw,
  createShapeId,
  getArrowBindings,
  getSnapshot,
  loadSnapshot,
  stopEventPropagation,
  useEditor,
  useValue,
  type Editor,
  type TLArrowShape,
  type TLEditorSnapshot,
  type TLFrameShape,
  type TLShape,
} from "tldraw";
import "tldraw/tldraw.css";
import { ArrowSquareOut, X } from "@phosphor-icons/react";
import { useStore } from "../store";
import { DRAG_MIME } from "../lib/objectDrag";

/**
 * The infinite canvas (issue #133) — tldraw as the ENGINE (pan/zoom/
 * selection/arrows/undo), Organizer as the KNOWLEDGE MODEL. Spatially it
 * is the WORKBENCH EVOLVED (follow-up #7): it lives in the right
 * membrane, expanding right-to-left over the workspace while a slit of
 * the sacred space stays visible on the left as the place to drag things
 * from — it never replaces the archive view.
 *
 * Everything on the canvas references an object by id, never a copy;
 * spatial state lives in the canvas doc's snapshot; arrows persist
 * knowledge relationships; frames can be BOUND to a meaning (semantic
 * sections): dropping an object into a bound frame applies that metadata.
 */

// v5 registers custom shape types via module augmentation — this is what
// lets createShapes/getShape narrow to our props without casts.
declare module "tldraw" {
  export interface TLGlobalShapePropsMap {
    "org-object": { w: number; h: number; objectId: string };
  }
}
type OrgShape = TLShape<"org-object">;

class OrganizerShapeUtil extends BaseBoxShapeUtil<OrgShape> {
  static override type = "org-object" as const;
  static override props = { w: T.number, h: T.number, objectId: T.string };

  getDefaultProps(): OrgShape["props"] {
    return { w: 168, h: 190, objectId: "" };
  }

  override component(shape: OrgShape) {
    return <OrgShapeCard shape={shape} />;
  }

  override getIndicatorPath(shape: OrgShape) {
    const p = new Path2D();
    p.rect(0, 0, shape.props.w, shape.props.h);
    return p;
  }
}

/** The live card inside a shape — reads the object from the store, so
 * metadata edits anywhere update every canvas instantly (objects remain
 * alive, #133 §9). The ↗ opens the real object; the card is otherwise
 * inert HTML so tldraw owns drag/select. */
function OrgShapeCard({ shape }: { shape: OrgShape }) {
  const object = useStore((s) => s.objects[shape.props.objectId]);
  const openDetail = useStore((s) => s.openDetail);
  const editor = useEditor();
  /** Figma-style connector: the + handle on the card's edge switches to
   * the arrow tool DURING the same pointer-down (capture phase — before
   * tldraw's own container listener sees the event), so the ongoing drag
   * draws an arrow starting at the handle, bound to this shape. tldraw
   * returns to the select tool when the arrow completes. */
  const startConnector = () => {
    // Deliberately does NOT stop propagation — tldraw must receive this
    // same pointer-down so the arrow starts under the handle.
    editor.setCurrentTool("arrow");
  };
  if (!object) {
    return (
      <HTMLContainer
        style={{ pointerEvents: "all" }}
        className="flex items-center justify-center rounded border border-dashed border-line bg-canvas font-mono text-[10px] text-muted"
      >
        object removed
      </HTMLContainer>
    );
  }
  return (
    <HTMLContainer style={{ pointerEvents: "all" }}>
      <div className="group relative w-full h-full flex flex-col rounded border border-line bg-panel shadow-card">
        <span
          onPointerDownCapture={startConnector}
          className="absolute -right-2 top-1/2 -translate-y-1/2 z-10 w-5 h-5 rounded-full bg-accent text-white shadow-card items-center justify-center text-[13px] leading-none font-bold cursor-crosshair select-none hidden group-hover:flex"
          title="Drag to connect to another object — the connection is saved as a relationship"
        >
          +
        </span>
        <div className="w-full h-full flex flex-col rounded overflow-hidden">
        <div className="flex-1 min-h-0 bg-line/10">
          {object.imageUrl ? (
            <img
              src={object.imageUrl}
              alt=""
              draggable={false}
              className="w-full h-full object-cover"
            />
          ) : (
            <div className="w-full h-full p-2 font-mono text-[9px] leading-snug text-ink/70 overflow-hidden">
              {object.title}
            </div>
          )}
        </div>
        <div className="shrink-0 px-1.5 py-1 flex items-center gap-1">
          <span className="flex-1 font-mono text-[9px] text-muted truncate">{object.title}</span>
          <button
            onPointerDown={stopEventPropagation}
            onClick={() => openDetail(object.id)}
            className="shrink-0 text-muted hover:text-ink"
            title="Open object"
            aria-label={`Open ${object.title}`}
          >
            <ArrowSquareOut size={10} />
          </button>
        </div>
        </div>
      </div>
    </HTMLContainer>
  );
}

/** Lays the seed objects out in a loose grid on first open. */
function seedShapes(editor: Editor, objectIds: string[]) {
  const COLS = 5;
  const W = 168;
  const H = 190;
  const GAP = 48;
  editor.createShapes(
    objectIds.map((objectId, i) => ({
      id: createShapeId(),
      type: "org-object" as const,
      x: (i % COLS) * (W + GAP),
      y: Math.floor(i / COLS) * (H + GAP),
      props: { w: W, h: H, objectId },
    }))
  );
  editor.zoomToFit({ animation: { duration: 0 } });
}

/**
 * Semantic-section binding panel (issue #133 §7) — appears when exactly
 * one FRAME is selected. Deliberately styled in Organizer's register
 * (mono, sharp, accent) while tldraw's native tools stay stock: anything
 * that triggers an Organizer function wears Organizer's clothes
 * (follow-up #6). Binding writes to the canvas doc; the frame's name gets
 * a "§" prefix so bound frames read differently on the canvas too.
 */
function SemanticSectionPanel({ canvasId }: { canvasId: string }) {
  const editor = useEditor();
  const selectedFrame = useValue(
    "selected-frame",
    () => {
      const sel = editor.getOnlySelectedShape();
      return sel?.type === "frame" ? (sel as TLFrameShape) : null;
    },
    [editor]
  );
  const semantic = useStore((s) =>
    selectedFrame ? s.canvases[canvasId]?.semantics?.[selectedFrame.id] ?? null : null
  );
  const collections = useStore((s) => s.collections);
  const collectionOrder = useStore((s) => s.collectionOrder);
  const [kind, setKind] = useState<"tag" | "collection">("tag");
  const [draft, setDraft] = useState("");

  if (!selectedFrame) return null;

  const manuals = collectionOrder
    .map((id) => collections[id])
    .filter((c): c is NonNullable<typeof c> => c?.type === "manual");

  function bind() {
    if (!selectedFrame) return;
    const st = useStore.getState();
    if (kind === "tag") {
      const tag = draft.trim();
      if (!tag) return;
      st.setCanvasSemantic(canvasId, selectedFrame.id, { kind: "tag", value: tag, label: tag });
      editor.updateShape({ id: selectedFrame.id, type: "frame", props: { name: `§ #${tag}` } });
    } else {
      const col = manuals.find((c) => c.id === draft);
      if (!col) return;
      st.setCanvasSemantic(canvasId, selectedFrame.id, {
        kind: "collection",
        value: col.id,
        label: col.name,
      });
      editor.updateShape({ id: selectedFrame.id, type: "frame", props: { name: `§ ${col.name}` } });
    }
    setDraft("");
  }

  return (
    <div
      className="absolute top-12 right-3 z-[300] w-60 rounded border border-accent/40 bg-panel/95 backdrop-blur shadow-cardHover p-2.5 font-mono"
      onPointerDown={stopEventPropagation}
      // Typing a tag name must not trigger tldraw's single-key tool
      // shortcuts (t = text, f = frame…) — the editor listens on its
      // container, so stopping propagation here is sufficient.
      onKeyDown={(e) => e.stopPropagation()}
      onKeyUp={(e) => e.stopPropagation()}
    >
      <div className="text-[10px] uppercase tracking-[0.12em] text-muted mb-1.5">
        Semantic section
      </div>
      {semantic ? (
        <div className="flex items-center justify-between gap-2 text-[11px]">
          <span className="truncate text-ink/85">
            § {semantic.kind === "tag" ? `#${semantic.label}` : semantic.label}
          </span>
          <button
            onClick={() => {
              useStore.getState().setCanvasSemantic(canvasId, selectedFrame.id, null);
              editor.updateShape({ id: selectedFrame.id, type: "frame", props: { name: "" } });
            }}
            className="shrink-0 text-muted hover:text-ink underline decoration-dotted"
          >
            unbind
          </button>
        </div>
      ) : (
        <>
          <p className="text-[10px] text-muted/80 mb-1.5 leading-snug">
            Objects dropped into this frame get this metadata.
          </p>
          <div className="flex gap-1 mb-1.5">
            {(["tag", "collection"] as const).map((k) => (
              <button
                key={k}
                onClick={() => {
                  setKind(k);
                  setDraft("");
                }}
                className={[
                  "flex-1 px-1.5 py-1 rounded border text-[10px] capitalize",
                  kind === k
                    ? "border-accent/50 bg-accent/5 text-ink"
                    : "border-line text-muted hover:text-ink",
                ].join(" ")}
              >
                {k}
              </button>
            ))}
          </div>
          {kind === "tag" ? (
            <input
              value={draft}
              onChange={(e) => setDraft(e.target.value)}
              onKeyDown={(e) => e.key === "Enter" && bind()}
              placeholder="tag name…"
              className="w-full rounded border border-line px-2 py-1 text-[11px] outline-none focus:border-accent mb-1.5"
            />
          ) : (
            <select
              value={draft}
              onChange={(e) => setDraft(e.target.value)}
              className="w-full rounded border border-line px-1.5 py-1 text-[11px] outline-none focus:border-accent mb-1.5 bg-panel"
            >
              <option value="">pick a collection…</option>
              {manuals.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.name}
                </option>
              ))}
            </select>
          )}
          <button
            onClick={bind}
            disabled={!draft.trim()}
            className="w-full px-2 py-1 rounded bg-ink text-white text-[11px] disabled:opacity-40"
          >
            Bind
          </button>
        </>
      )}
    </div>
  );
}

export function CanvasView({ canvasId }: { canvasId: string }) {
  const doc = useStore((s) => s.canvases[canvasId]);
  const saveTimer = useRef<number | null>(null);
  const editorRef = useRef<Editor | null>(null);
  const [savingAs, setSavingAs] = useState(false);
  const [collectionDraft, setCollectionDraft] = useState("");

  const handleMount = useCallback(
    (editor: Editor) => {
      editorRef.current = editor;
      const { canvases, saveCanvasSnapshot, addObjectRelation } = useStore.getState();
      const current = canvases[canvasId];
      if (current?.snapshot) {
        loadSnapshot(editor.store, current.snapshot as TLEditorSnapshot);
      } else if (
        current?.seedObjectIds?.length &&
        // Idempotence guard: under StrictMode's dev double-mount the same
        // in-memory tldraw store survives the remount, so seeding blindly
        // planted every object TWICE (the reported duplicate cards).
        !editor.getCurrentPageShapes().some((sh) => sh.type === "org-object")
      ) {
        seedShapes(editor, current.seedObjectIds.filter((id) => useStore.getState().objects[id]));
      }

      const unlisten = editor.store.listen(
        (entry) => {
          const changed = [
            ...Object.values(entry.changes.added),
            ...Object.values(entry.changes.updated).map(([, to]) => to),
          ];
          for (const rec of changed) {
            // Knowledge extraction 1: arrows between object shapes persist
            // a relationship (deduped store-side; outlives the canvas).
            if ((rec as { typeName?: string }).typeName === "binding") {
              const binding = rec as { type: string; fromId: string };
              if (binding.type !== "arrow") continue;
              const arrow = editor.getShape(binding.fromId as Parameters<Editor["getShape"]>[0]);
              if (!arrow || arrow.type !== "arrow") continue;
              const bindings = getArrowBindings(editor, arrow as TLArrowShape);
              if (!bindings.start || !bindings.end) continue;
              const startShape = editor.getShape(bindings.start.toId);
              const endShape = editor.getShape(bindings.end.toId);
              if (startShape?.type !== "org-object" || endShape?.type !== "org-object") continue;
              addObjectRelation({
                sourceObjectId: (startShape as OrgShape).props.objectId,
                targetObjectId: (endShape as OrgShape).props.objectId,
                relationType: "related",
                canvasId,
              });
            }
          }

          // Knowledge extraction 2 (semantic sections, §7): an object shape
          // whose parent BECOMES a bound frame gets that meaning applied.
          // Leaving a frame keeps the metadata (the notes' default).
          for (const [from, to] of Object.values(entry.changes.updated)) {
            const rec = to as { typeName?: string; type?: string; parentId?: string };
            if (rec.typeName !== "shape" || rec.type !== "org-object") continue;
            const prev = from as { parentId?: string };
            if (!rec.parentId || rec.parentId === prev.parentId) continue;
            const semantics = useStore.getState().canvases[canvasId]?.semantics;
            const semantic = semantics?.[rec.parentId];
            if (!semantic) continue;
            const objectId = (to as OrgShape).props.objectId;
            const st = useStore.getState();
            if (semantic.kind === "tag") {
              st.addObjectTag(objectId, semantic.value);
              st.setFlashNotice(`#${semantic.label} → "${st.objects[objectId]?.title ?? ""}"`);
            } else {
              st.assignToManualCollection(objectId, semantic.value);
              st.setFlashNotice(
                `Filed "${st.objects[objectId]?.title ?? ""}" into ${semantic.label}`
              );
            }
          }

          if (saveTimer.current) window.clearTimeout(saveTimer.current);
          saveTimer.current = window.setTimeout(() => {
            saveCanvasSnapshot(canvasId, getSnapshot(editor.store));
          }, 500);
        },
        { scope: "document", source: "user" }
      );

      // Universal drag (N22): dropping Organizer objects onto the canvas
      // places them as shapes at the drop point — references, not copies.
      const container = editor.getContainer();
      const onDragOver = (e: DragEvent) => {
        if (e.dataTransfer?.types.includes(DRAG_MIME)) e.preventDefault();
      };
      const onDrop = (e: DragEvent) => {
        const raw = e.dataTransfer?.getData(DRAG_MIME);
        if (!raw) return;
        e.preventDefault();
        e.stopPropagation();
        let ids: string[] = [];
        try {
          const parsed = JSON.parse(raw);
          ids = Array.isArray(parsed) ? parsed : [];
        } catch {
          return;
        }
        const point = editor.screenToPage({ x: e.clientX, y: e.clientY });
        editor.createShapes(
          ids
            .filter((id) => useStore.getState().objects[id])
            .map((objectId, i) => ({
              id: createShapeId(),
              type: "org-object" as const,
              x: point.x + i * 24,
              y: point.y + i * 24,
              props: { w: 168, h: 190, objectId },
            }))
        );
      };
      container.addEventListener("dragover", onDragOver);
      container.addEventListener("drop", onDrop);

      return () => {
        unlisten();
        container.removeEventListener("dragover", onDragOver);
        container.removeEventListener("drop", onDrop);
        if (saveTimer.current) window.clearTimeout(saveTimer.current);
        // Unconditional flush — closing (or switching canvases) must never
        // lose layout, timer pending or not.
        useStore.getState().saveCanvasSnapshot(canvasId, getSnapshot(editor.store));
        editorRef.current = null;
      };
    },
    [canvasId]
  );

  /** Canvas → collection (follow-up #3): gather every object on the
   * canvas into a new manual collection. The canvas stays a canvas —
   * this formalizes its contents, it doesn't convert the document. */
  function saveAsCollection() {
    const editor = editorRef.current;
    const name = collectionDraft.trim();
    if (!editor || !name) return;
    const st = useStore.getState();
    const ids = editor
      .getCurrentPageShapes()
      .filter((sh): sh is OrgShape => sh.type === "org-object")
      .map((sh) => sh.props.objectId)
      .filter((id, i, arr) => st.objects[id] && arr.indexOf(id) === i);
    if (ids.length === 0) return;
    const colId = st.addManualCollection(name);
    for (const id of ids) st.assignToManualCollection(id, colId);
    st.setFlashNotice(
      `Saved ${ids.length} canvas object${ids.length === 1 ? "" : "s"} to "${name}"`
    );
    setSavingAs(false);
    setCollectionDraft("");
  }

  if (!doc) return null;

  return (
    <div className="h-full w-full relative">
      <Tldraw
        shapeUtils={[OrganizerShapeUtil]}
        onMount={handleMount}
        components={{ PageMenu: null, MainMenu: null, DebugMenu: null, StylePanel: null }}
      >
        <SemanticSectionPanel canvasId={canvasId} />
      </Tldraw>
      {/* Canvas header — Organizer-styled (mono/sharp/accent) vs tldraw's
          stock tools: anything that triggers an Organizer function wears
          Organizer's register (follow-up #6). */}
      <div className="absolute top-2 left-1/2 -translate-x-1/2 z-[300] flex items-center gap-1.5 rounded border border-line/70 bg-panel/90 backdrop-blur px-2.5 py-1 shadow-card font-mono text-[11px]">
        <span className="uppercase tracking-[0.12em] text-muted">Canvas</span>
        <span className="text-ink/85 max-w-[14rem] truncate">{doc.name}</span>
        <span className="text-muted/40">·</span>
        {savingAs ? (
          <form
            onSubmit={(e) => {
              e.preventDefault();
              saveAsCollection();
            }}
            className="flex items-center gap-1"
          >
            <input
              autoFocus
              value={collectionDraft}
              onChange={(e) => setCollectionDraft(e.target.value)}
              onKeyDown={(e) => e.key === "Escape" && setSavingAs(false)}
              placeholder="collection name…"
              className="w-36 rounded border border-line px-1.5 py-0.5 text-[11px] outline-none focus:border-accent"
            />
            <button type="submit" className="text-accent hover:underline">
              save
            </button>
          </form>
        ) : (
          <button
            onClick={() => setSavingAs(true)}
            className="text-ink/70 hover:text-ink hover:underline decoration-dotted underline-offset-2"
            title="Gather every object on this canvas into a new manual collection"
          >
            save as collection
          </button>
        )}
        <button
          onClick={() => useStore.getState().openCanvas(null)}
          className="w-5 h-5 flex items-center justify-center rounded text-muted hover:text-ink hover:bg-line/40"
          aria-label="Close canvas"
          title="Close canvas — the layout is saved; relationships live in the archive either way"
        >
          <X size={11} />
        </button>
      </div>
    </div>
  );
}
