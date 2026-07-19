import { useCallback, useRef } from "react";
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
  type Editor,
  type TLArrowShape,
  type TLEditorSnapshot,
  type TLShape,
} from "tldraw";
import "tldraw/tldraw.css";
import { ArrowSquareOut, X } from "@phosphor-icons/react";
import { useStore } from "../store";
import { DRAG_MIME } from "../lib/objectDrag";

/**
 * The infinite canvas (issue #133) — tldraw as the ENGINE (pan/zoom/
 * selection/arrows/undo), Organizer as the KNOWLEDGE MODEL. Everything on
 * the canvas is a reference to an existing object by id, never a copy;
 * spatial state (positions, sizes, visual edges) lives in the canvas
 * document's snapshot; connecting two objects with an arrow persists a
 * knowledge relationship in the store that outlives this canvas.
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
      <div className="w-full h-full flex flex-col rounded overflow-hidden border border-line bg-panel shadow-card">
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

export function CanvasView({ canvasId }: { canvasId: string }) {
  const doc = useStore((s) => s.canvases[canvasId]);
  const saveTimer = useRef<number | null>(null);

  const handleMount = useCallback(
    (editor: Editor) => {
      const { canvases, saveCanvasSnapshot, addObjectRelation } = useStore.getState();
      const current = canvases[canvasId];
      if (current?.snapshot) {
        loadSnapshot(editor.store, current.snapshot as TLEditorSnapshot);
      } else if (current?.seedObjectIds?.length) {
        seedShapes(editor, current.seedObjectIds.filter((id) => useStore.getState().objects[id]));
      }

      // Presentation persistence: debounced full-snapshot save on any user
      // document change (positions, arrows, resizes…).
      const unlisten = editor.store.listen(
        (entry) => {
          // Knowledge extraction: an arrow whose BOTH terminals are bound
          // to object shapes persists a relationship in Organizer — the
          // whole point of #133. Deduped store-side; deleting the visual
          // edge later deliberately does NOT remove the relationship.
          const changed = [
            ...Object.values(entry.changes.added),
            ...Object.values(entry.changes.updated).map(([, to]) => to),
          ];
          for (const rec of changed) {
            if ((rec as { typeName?: string }).typeName !== "binding") continue;
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

          if (saveTimer.current) window.clearTimeout(saveTimer.current);
          saveTimer.current = window.setTimeout(() => {
            saveCanvasSnapshot(canvasId, getSnapshot(editor.store));
          }, 800);
        },
        { scope: "document", source: "user" }
      );

      // Universal drag (N22): dropping Organizer objects onto the canvas
      // places them as shapes at the drop point — references, not copies.
      const container = editor.getContainer();
      const onDragOver = (e: DragEvent) => {
        if (e.dataTransfer?.types.includes(DRAG_MIME)) {
          e.preventDefault();
        }
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
        if (saveTimer.current) {
          window.clearTimeout(saveTimer.current);
          // Flush the pending save so closing never loses layout.
          useStore.getState().saveCanvasSnapshot(canvasId, getSnapshot(editor.store));
        }
      };
    },
    [canvasId]
  );

  if (!doc) return null;

  return (
    <div className="h-full w-full relative">
      <Tldraw
        shapeUtils={[OrganizerShapeUtil]}
        onMount={handleMount}
        components={{ PageMenu: null, MainMenu: null, DebugMenu: null, StylePanel: null }}
      />
      {/* Canvas header — name + close, floating over tldraw's own chrome. */}
      <div className="absolute top-2 left-1/2 -translate-x-1/2 z-[300] flex items-center gap-1.5 rounded border border-line/70 bg-panel/90 backdrop-blur px-2.5 py-1 shadow-card font-mono text-[11px]">
        <span className="uppercase tracking-[0.12em] text-muted">Canvas</span>
        <span className="text-ink/85 max-w-[16rem] truncate">{doc.name}</span>
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
