import { useEffect, useState } from "react";
import { motion } from "motion/react";
import { MOTION } from "../lib/chrome";
import { DRAG_MIME } from "../lib/objectDrag";

/**
 * The membrane pattern (issue #134): a recessed boundary in the worktable
 * that opens INWARD to reveal a hidden compartment — never a floating
 * panel placed on top. Participates in the flex layout (the main surface
 * genuinely yields space), carries inner shadow instead of drop shadow
 * (the surface casts shadow INTO the cavity), and keeps a narrow resident
 * seam at its edge when closed, so the cavity stays discoverable.
 *
 * States: closed (seam only) · hinted (an object drag is in flight — the
 * seam brightens to advertise itself) · opening/open (the cavity expands
 * from the edge, MOTION.panel timing) · drag-active (handled by the
 * compartment's own content, e.g. Workbench's surface highlight).
 *
 * One pattern, any edge: `edge="right"` (Workbench) and `edge="bottom"`
 * (Discovery) today; the seam+cavity flex arrangement generalizes.
 * Keyboard: the seam is a real button (aria-expanded/aria-controls,
 * Enter toggles). Reduced motion inherits the global MotionConfig.
 */
export function Membrane({
  edge,
  open,
  onToggle,
  size,
  seamLabel,
  id,
  children,
}: {
  edge: "right" | "bottom";
  open: boolean;
  onToggle: () => void;
  /** Cavity extent (px) when open — width for right, height for bottom. */
  size: number;
  seamLabel: string;
  id: string;
  children: React.ReactNode;
}) {
  const isRight = edge === "right";

  // Hinted state: any Organizer-object drag anywhere brightens the seam.
  const [dragHint, setDragHint] = useState(false);
  useEffect(() => {
    function onDragOver(e: DragEvent) {
      if (e.dataTransfer?.types.includes(DRAG_MIME)) setDragHint(true);
    }
    function clear() {
      setDragHint(false);
    }
    document.addEventListener("dragover", onDragOver);
    document.addEventListener("dragend", clear);
    document.addEventListener("drop", clear);
    return () => {
      document.removeEventListener("dragover", onDragOver);
      document.removeEventListener("dragend", clear);
      document.removeEventListener("drop", clear);
    };
  }, []);

  return (
    <div className={isRight ? "h-full flex shrink-0" : "w-full flex flex-col shrink-0"}>
      {/* The seam — a permanent slit at the edge. Clicking toggles; dragging
          an object onto it opens the cavity so the drop can land inside. */}
      <button
        onClick={onToggle}
        onDragOver={(e) => {
          if (!e.dataTransfer.types.includes(DRAG_MIME)) return;
          e.preventDefault();
          if (!open) onToggle();
        }}
        aria-expanded={open}
        aria-controls={id}
        aria-label={seamLabel}
        title={seamLabel}
        className={[
          isRight
            ? "h-full w-3 flex flex-col items-center justify-center border-l"
            : "w-full h-3 flex items-center justify-center border-t",
          "shrink-0 transition-colors",
          dragHint && !open
            ? "bg-accent/10 border-accent/50"
            : "bg-canvas border-line/80 hover:bg-line/40",
          // The slit reads as depth, not as a control bar: an inner shadow
          // cast from the main surface into the seam.
          isRight
            ? "shadow-[inset_2px_0_3px_rgba(0,0,0,0.05)]"
            : "shadow-[inset_0_2px_3px_rgba(0,0,0,0.05)]",
        ].join(" ")}
      >
        <span
          className={[
            "rounded-full",
            isRight ? "w-0.5 h-8" : "h-0.5 w-8",
            dragHint && !open ? "bg-accent/70" : "bg-line",
          ].join(" ")}
        />
      </button>

      {/* The cavity — expands from the edge, recessed (canvas-toned, inner
          shadow from the surface side, no elevation). Content keeps its
          natural size inside so the reveal is a genuine opening, not a
          squash. */}
      <motion.div
        id={id}
        initial={false}
        animate={isRight ? { width: open ? size : 0 } : { height: open ? size : 0 }}
        transition={{ duration: MOTION.panel, ease: open ? MOTION.easeOut : MOTION.easeIn }}
        className={[
          "overflow-hidden bg-canvas",
          isRight
            ? "h-full shadow-[inset_10px_0_16px_-12px_rgba(0,0,0,0.3)]"
            : "w-full shadow-[inset_0_10px_16px_-12px_rgba(0,0,0,0.3)]",
        ].join(" ")}
        aria-hidden={!open}
      >
        <div style={isRight ? { width: size } : { height: size }} className={isRight ? "h-full" : "w-full"}>
          {children}
        </div>
      </motion.div>
    </div>
  );
}
