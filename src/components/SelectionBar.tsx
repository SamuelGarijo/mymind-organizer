import { useStore } from "../store";
import type { Collection } from "../types";

/**
 * What you can do with a selection (Samuel, 2026-07-22: "quiero poder
 * eliminar elementos de una collection").
 *
 * Until now selecting cards did nothing but light them up and let you drag
 * them — there was no way to act on a group at all, and removing an item
 * from a collection meant opening its detail panel and doing it one at a
 * time.
 *
 * Summoned by intent, gone the moment nothing is selected: this is the
 * choreography the design philosophy asks for, not resident chrome. It also
 * sits centred at the bottom so it clears the back pill (bottom-left) and
 * the toast stack (bottom-right), both z-[60].
 *
 * Removing from a MANUAL collection drops the membership and nothing else —
 * the object stays in the archive, and ⌘Z puts it back. A SMART collection
 * has no membership to drop: it fills itself from its rule, so the honest
 * thing is to say so rather than silently do nothing or quietly rewrite the
 * rule under him (the app's standing norm for smart collections).
 */
export function SelectionBar({ collection }: { collection?: Collection }) {
  const selectedObjectIds = useStore((s) => s.selectedObjectIds);
  const setSelection = useStore((s) => s.setSelection);
  const count = selectedObjectIds.size;

  if (count === 0) return null;

  const isManual = collection?.type === "manual";
  const isSmart = collection?.type === "smart";

  function removeFromCollection() {
    if (!collection || !isManual) return;
    const ids = Array.from(selectedObjectIds);
    const state = useStore.getState();
    state.pushUndo(`remove ${ids.length} from ${collection.name}`);
    for (const id of ids) state.removeFromManualCollection(id, collection.id);
    state.setSelection(new Set(), null);
    state.setFlashNotice(
      `${ids.length.toLocaleString()} removed from "${collection.name}" — still in your archive. ⌘Z undoes it.`
    );
  }

  return (
    <div className="fixed bottom-4 left-1/2 -translate-x-1/2 z-[60] flex items-center gap-3 rounded-lg border border-line/70 bg-panel shadow-cardHover px-3 py-1.5 font-mono text-[11px]">
      <span className="text-muted">
        {count.toLocaleString()} selected
      </span>

      {isManual && collection && (
        <button
          onClick={removeFromCollection}
          className="text-ink hover:text-danger transition-colors"
          title={`Remove from "${collection.name}". They stay in your archive — this only drops them from this collection.`}
        >
          Remove from {collection.name}
        </button>
      )}

      {isSmart && (
        <span
          className="text-muted/70"
          title="A smart collection fills itself from its rule — change the rule to change what's in it."
        >
          smart collection · edit its rule to change what's in it
        </span>
      )}

      <button
        onClick={() => setSelection(new Set(), null)}
        className="text-muted hover:text-ink"
        title="Clear the selection (Esc)"
      >
        clear
      </button>
    </div>
  );
}
