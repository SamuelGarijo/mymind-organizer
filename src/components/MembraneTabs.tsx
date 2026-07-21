import { Sparkle, Tray } from "@phosphor-icons/react";
import { readDraggedIds } from "../lib/objectDrag";
import { useStore } from "../store";

/**
 * The right membrane names its own tenants (Samuel, 2026-07-21).
 *
 * Bench and Classify used to float as two pills at the top-right of the
 * workspace, one command-bar width from colliding with it — two loose
 * controls hovering over the sacred space, exactly the "death by features"
 * this app refuses. They belong to the compartment they open, so they live
 * inside it as its two tabs: the membrane opens, and its header says what
 * it currently is and what else it could be.
 *
 * Drop targets too: dragging a card onto the Bench tab adds it, same
 * contract the old floating pill carried (issue #132) — the tab is the
 * bench's handle, not just its label.
 */
export function MembraneTabs({
  active,
  benchCount,
  canClassify,
  onSelect,
  onClose,
}: {
  active: "bench" | "classify";
  benchCount: number;
  /** Classify is collection-scoped; the tab is simply absent elsewhere. */
  canClassify: boolean;
  onSelect: (tab: "bench" | "classify") => void;
  onClose: () => void;
}) {
  const tabClass = (isActive: boolean) =>
    [
      "font-mono text-[11px] px-2 py-1 rounded-md transition-colors",
      isActive ? "bg-line/50 text-ink" : "text-muted hover:text-ink hover:bg-line/25",
    ].join(" ");

  return (
    <div className="shrink-0 px-3 pt-3 pb-2 flex items-center gap-1">
      <button
        onClick={() => onSelect("bench")}
        onDragOver={(e) => {
          e.preventDefault();
          if (active !== "bench") onSelect("bench");
        }}
        onDrop={(e) => {
          e.preventDefault();
          const ids = readDraggedIds(e);
          if (ids.length > 0) useStore.getState().addToWorkbench(ids);
        }}
        className={tabClass(active === "bench")}
        aria-pressed={active === "bench"}
        title="A temporary worktable for gathering references before they mean anything (⌘J)"
      >
        <Tray size={12} className="inline -mt-0.5 mr-1" />
        Bench{benchCount > 0 ? ` ${benchCount}` : ""}
      </button>
      {canClassify && (
        <button
          onClick={() => onSelect("classify")}
          className={tabClass(active === "classify")}
          aria-pressed={active === "classify"}
          title="Sort this collection's things into the values of one property"
        >
          <Sparkle size={12} weight={active === "classify" ? "fill" : "regular"} className="inline -mt-0.5 mr-1" />
          Classify
        </button>
      )}
      <span className="flex-1" />
      <button
        onClick={onClose}
        className="w-6 h-6 flex items-center justify-center rounded-md text-muted hover:text-ink hover:bg-line/40 text-[14px] leading-none"
        aria-label="Close panel"
        title="Close (⌘J)"
      >
        ×
      </button>
    </div>
  );
}
