import { useEffect, useRef, useState } from "react";
import { useStore } from "../store";

/**
 * Adaptive Chrome — the one shared interaction system for how interface
 * chrome appears and recedes (docs/design-philosophy.md: summoned by
 * intent, receding on completion, space as a first-class feature).
 *
 * Everything here is deliberately small: shared motion tokens so no
 * component invents its own timing, and one hook that resolves the
 * sidebar's chrome mode from intent signals. Transient interaction state
 * (peek, timers) lives HERE, never in the persisted store — the store
 * keeps only the two primitives that already existed: `sidebarCollapsed`
 * (the user's explicit pin) and `dragRevealSidebar` (an in-flight drag).
 */

// ---------------------------------------------------------------------------
// Motion tokens — restrained, no springs. Entrances ease out (arrive and
// settle), exits ease in (leave with intent). Durations in seconds.
// ---------------------------------------------------------------------------

export const MOTION = {
  micro: 0.12, // hover feedback, tiny reveals
  reveal: 0.18, // popovers, flyouts, row menus
  panel: 0.22, // sidebar overlay, classify panel, larger surfaces
  easeOut: [0.22, 1, 0.36, 1] as const,
  easeIn: [0.55, 0, 0.55, 0.2] as const,
} as const;

/** Popover/flyout presence — a short slide from its anchor direction plus
 * fade, so motion says where the surface came from. Use with
 * `custom={{ x?, y? }}` to point back at the anchor. */
export const surfaceVariants = {
  hidden: (offset?: { x?: number; y?: number }) => ({
    opacity: 0,
    x: offset?.x ?? 0,
    y: offset?.y ?? -6,
  }),
  visible: {
    opacity: 1,
    x: 0,
    y: 0,
    transition: { duration: MOTION.reveal, ease: MOTION.easeOut },
  },
  exit: (offset?: { x?: number; y?: number }) => ({
    opacity: 0,
    x: (offset?.x ?? 0) / 2,
    y: (offset?.y ?? -6) / 2,
    transition: { duration: MOTION.micro, ease: MOTION.easeIn },
  }),
};

/** Larger panels (sidebar overlay, classify panel) — same idea, panel
 * timing. `custom` is the resting-edge offset, e.g. { x: -24 } for a
 * left-edge surface. */
export const panelVariants = {
  hidden: (offset?: { x?: number; y?: number }) => ({
    opacity: 0,
    x: offset?.x ?? 0,
    y: offset?.y ?? 0,
  }),
  visible: {
    opacity: 1,
    x: 0,
    y: 0,
    transition: { duration: MOTION.panel, ease: MOTION.easeOut },
  },
  exit: (offset?: { x?: number; y?: number }) => ({
    opacity: 0,
    x: (offset?.x ?? 0) * 0.6,
    y: (offset?.y ?? 0) * 0.6,
    transition: { duration: MOTION.reveal, ease: MOTION.easeIn },
  }),
};

// ---------------------------------------------------------------------------
// Sidebar chrome resolution
// ---------------------------------------------------------------------------

/** Grace before a temporary surface actually closes after the pointer
 * leaves — forgiving hover boundaries, no flicker while crossing gaps. */
const CLOSE_GRACE_MS = 300;
/** Small intent delay before a hover opens the peek, so skimming the left
 * edge doesn't flash the overlay. */
const OPEN_INTENT_MS = 120;
/** Accumulated downward wheel travel (px) in the content area that reads
 * as "diving into the things" and closes a temporary peek. */
const SCROLL_CLOSE_THRESHOLD = 90;

export type SidebarChromeMode = "compact" | "peek" | "drag-reveal" | "pinned";

export function useWorkspaceChrome() {
  const pinned = useStore((s) => !s.sidebarCollapsed);
  const dragReveal = useStore((s) => s.dragRevealSidebar);
  const setSidebarCollapsed = useStore((s) => s.setSidebarCollapsed);

  const [peek, setPeek] = useState(false);
  const openTimer = useRef<number | null>(null);
  const closeTimer = useRef<number | null>(null);
  const wheelAccum = useRef(0);
  const prevDragReveal = useRef(dragReveal);

  function clearTimers() {
    if (openTimer.current) window.clearTimeout(openTimer.current);
    if (closeTimer.current) window.clearTimeout(closeTimer.current);
    openTimer.current = null;
    closeTimer.current = null;
  }

  function openPeek(immediate = false) {
    if (closeTimer.current) {
      window.clearTimeout(closeTimer.current);
      closeTimer.current = null;
    }
    if (immediate) {
      setPeek(true);
      return;
    }
    if (openTimer.current) return;
    openTimer.current = window.setTimeout(() => {
      openTimer.current = null;
      setPeek(true);
    }, OPEN_INTENT_MS);
  }

  function cancelOpen() {
    if (openTimer.current) {
      window.clearTimeout(openTimer.current);
      openTimer.current = null;
    }
  }

  function scheduleClose() {
    cancelOpen();
    if (closeTimer.current) window.clearTimeout(closeTimer.current);
    closeTimer.current = window.setTimeout(() => {
      closeTimer.current = null;
      setPeek(false);
    }, CLOSE_GRACE_MS);
  }

  function closePeek() {
    clearTimers();
    setPeek(false);
  }

  function holdOpen() {
    // Pointer arrived inside the overlay — cancel any pending close.
    if (closeTimer.current) {
      window.clearTimeout(closeTimer.current);
      closeTimer.current = null;
    }
  }

  // A drag that revealed the sidebar shouldn't vanish it the instant the
  // drop happens — hand off to a short peek that closes on its own grace,
  // so the surface recedes rather than blinking out.
  useEffect(() => {
    if (prevDragReveal.current && !dragReveal && !pinned) {
      setPeek(true);
      scheduleClose();
    }
    prevDragReveal.current = dragReveal;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [dragReveal, pinned]);

  // Deliberate downward scrolling in the content = diving into the things —
  // close a temporary peek (never a pin, never mid-drag). Accumulates so a
  // single tick doesn't count as intent.
  useEffect(() => {
    if (!peek) return;
    function onWheel(e: WheelEvent) {
      if (e.deltaY <= 0) {
        wheelAccum.current = 0;
        return;
      }
      // Scrolling inside the overlay itself is browsing the collections,
      // not leaving them.
      if ((e.target as HTMLElement | null)?.closest?.("[data-sidebar-overlay]")) return;
      wheelAccum.current += e.deltaY;
      if (wheelAccum.current > SCROLL_CLOSE_THRESHOLD) {
        wheelAccum.current = 0;
        closePeek();
      }
    }
    document.addEventListener("wheel", onWheel, { passive: true });
    return () => {
      wheelAccum.current = 0;
      document.removeEventListener("wheel", onWheel);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [peek]);

  // Escape dismisses the temporary surface (never the pin).
  useEffect(() => {
    if (!peek) return;
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape") closePeek();
    }
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [peek]);

  useEffect(() => clearTimers, []);

  const mode: SidebarChromeMode = pinned
    ? "pinned"
    : dragReveal
    ? "drag-reveal"
    : peek
    ? "peek"
    : "compact";

  return {
    mode,
    pinned,
    /** The temporary overlay is visible (peek or an in-flight drag). */
    overlayVisible: !pinned && (peek || dragReveal),
    openPeek,
    cancelOpen,
    scheduleClose,
    holdOpen,
    closePeek,
    pin: () => {
      closePeek();
      setSidebarCollapsed(false);
    },
    unpin: () => setSidebarCollapsed(true),
  };
}
