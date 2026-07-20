import { useEffect, useMemo, useRef, useState } from "react";
import { useShallow } from "zustand/react/shallow";
import { useStore } from "../store";
import { getKnownFields } from "../lib/fieldCatalog";
import {
  orderVocabulary,
  previewProviders,
  proposeWithProvider,
  type ProviderPreview,
} from "../lib/fieldExtraction";
import type { DesignObject, FacetField, FacetFieldType } from "../types";

/**
 * "I'd also like to organize these fonts by colour."
 *
 * That thought happens inside a collection, so the gesture starts there. It
 * used to start six indirections away: open an object → find its role → open
 * the field-package modal → invent the entire option vocabulary up front as a
 * comma-separated string → pin it ★ → save → then classify hundreds of things
 * by hand. The property arrived empty and stayed empty.
 *
 * The inversion here: **the data proposes the vocabulary**. Type a name and
 * the enrichment providers say what they could fill and with what values —
 * "image palette · 412 of 480 · Beige 162 · Grey 113 · Black 84…". One
 * confirmation creates the field, seeds its options, pins it to the ledger
 * and writes the values. The column is born populated.
 *
 * Deliberately a popover and not a modal (design-philosophy N21): it is
 * summoned by intent, sits beside the work, and recedes — it never takes the
 * screen hostage the way RolePackageModal does.
 */
export function AddPropertyPopover({
  roleName,
  objects,
  onClose,
}: {
  roleName: string;
  /** The objects this property would describe — the role's members in this
   * collection. Coverage counts are quoted against exactly this set, so the
   * number the user sees is the number they'll get. */
  objects: DesignObject[];
  onClose: () => void;
}) {
  const state = useStore(
    useShallow((s) => ({
      roles: s.roles,
      collections: s.collections,
      addRoleField: s.addRoleField,
      applyProposals: s.applyProposals,
    }))
  );
  const [name, setName] = useState("");
  const [type, setType] = useState<FacetFieldType>("select");
  const [chosen, setChosen] = useState<string | null>(null);
  const [manualOptions, setManualOptions] = useState("");
  const rootRef = useRef<HTMLDivElement>(null);

  const knownFields = useMemo(
    () => getKnownFields(state.collections, state.roles),
    [state.collections, state.roles]
  );

  // Recomputed as the user types. Pure and cheap by construction — every
  // deterministic provider is a single pass over already-loaded fields.
  const previews = useMemo(
    () => previewProviders(objects, name, { name, type }),
    [objects, name, type]
  );

  // Default to the highest-coverage source rather than making the user pick
  // the obvious one; still switchable.
  useEffect(() => {
    const best = [...previews].sort((a, b) => b.filled - a.filled)[0];
    setChosen(best && best.filled > 0 ? best.provider.id : null);
  }, [previews]);

  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape") onClose();
    }
    function onDown(e: MouseEvent) {
      if (!rootRef.current?.contains(e.target as Node)) onClose();
    }
    window.addEventListener("keydown", onKey);
    window.addEventListener("mousedown", onDown);
    return () => {
      window.removeEventListener("keydown", onKey);
      window.removeEventListener("mousedown", onDown);
    };
  }, [onClose]);

  const selected = previews.find((p) => p.provider.id === chosen);

  function create() {
    const fieldName = name.trim();
    if (!fieldName) return;

    const options = selected
      ? orderVocabulary(fieldName, selected.vocabulary).map((v) => v.value)
      : manualOptions
          .split(",")
          .map((o) => o.trim())
          .filter(Boolean);

    const field: FacetField = { name: fieldName, type, ...(options.length ? { options } : {}) };
    state.addRoleField(roleName, field, true);

    if (selected) {
      state.applyProposals(
        proposeWithProvider(selected.provider, objects, fieldName, field)
      );
    }
    onClose();
  }

  return (
    <div
      ref={rootRef}
      className="absolute z-40 top-0 left-0 w-[340px] rounded-xl border border-line bg-panel shadow-cardHover p-3.5"
      role="dialog"
      aria-label="Add a property"
    >
      <div className="font-mono text-[10px] uppercase tracking-[0.12em] text-muted mb-2">
        Organize by…
      </div>

      <div className="flex gap-1.5">
        <input
          autoFocus
          list="known-property-names"
          value={name}
          onChange={(e) => {
            const value = e.target.value;
            setName(value);
            const known = knownFields.find(
              (f) => f.name.toLowerCase() === value.trim().toLowerCase()
            );
            if (known) setType(known.type);
          }}
          onKeyDown={(e) => e.key === "Enter" && create()}
          placeholder="Colour, Orientation, Foundry…"
          className="flex-1 min-w-0 rounded-lg border border-line px-2.5 py-1.5 font-mono text-[12px] outline-none focus:border-accent"
        />
        <datalist id="known-property-names">
          {knownFields.map((f) => (
            <option key={`${f.name}::${f.type}`} value={f.name} />
          ))}
        </datalist>
        <select
          value={type}
          onChange={(e) => setType(e.target.value as FacetFieldType)}
          className="rounded-lg border border-line bg-panel px-1.5 py-1.5 font-mono text-[11px] shrink-0"
          title="One value per item, or several"
        >
          <option value="select">one</option>
          <option value="multi-select">many</option>
          <option value="date">date</option>
        </select>
      </div>

      {name.trim() !== "" && type !== "date" && (
        <div className="mt-3">
          <div className="font-mono text-[10px] uppercase tracking-[0.12em] text-muted mb-1.5">
            {previews.some((p) => p.filled > 0) ? "Found in your data" : "Nothing to fill it from"}
          </div>
          <div className="flex flex-col gap-0.5">
            {previews.map((preview) => (
              <SourceRow
                key={preview.provider.id}
                preview={preview}
                fieldName={name}
                total={objects.length}
                active={chosen === preview.provider.id}
                onPick={() => setChosen(preview.provider.id)}
              />
            ))}
            <button
              onClick={() => setChosen(null)}
              className={[
                "text-left rounded-lg px-2 py-1.5 font-mono text-[11px]",
                chosen === null ? "bg-line/50 text-ink" : "text-muted hover:bg-line/25",
              ].join(" ")}
            >
              {chosen === null ? "● " : "○ "}leave empty — I'll fill it myself
            </button>
          </div>
          {chosen === null && (
            <input
              value={manualOptions}
              onChange={(e) => setManualOptions(e.target.value)}
              onKeyDown={(e) => e.key === "Enter" && create()}
              placeholder="Options, comma-separated (optional)"
              className="mt-1.5 w-full rounded-lg border border-line px-2.5 py-1.5 font-mono text-[11px] outline-none focus:border-accent"
            />
          )}
        </div>
      )}

      <div className="mt-3 flex items-center justify-end gap-2">
        <button
          onClick={onClose}
          className="font-mono text-[11px] px-2 py-1 rounded-lg text-muted hover:text-ink"
        >
          cancel
        </button>
        <button
          onClick={create}
          disabled={!name.trim()}
          className="font-mono text-[11px] px-3 py-1.5 rounded-lg bg-ink text-white disabled:opacity-30"
        >
          {selected && selected.filled > 0 ? `add · fills ${selected.filled}` : "add property"}
        </button>
      </div>
    </div>
  );
}

/** One candidate source, with the count it would fill and a taste of the
 * vocabulary it proposes — enough to judge the rule before accepting it. */
function SourceRow({
  preview,
  fieldName,
  total,
  active,
  onPick,
}: {
  preview: ProviderPreview;
  fieldName: string;
  total: number;
  active: boolean;
  onPick: () => void;
}) {
  const vocabulary = orderVocabulary(fieldName, preview.vocabulary).slice(0, 5);
  return (
    <button
      onClick={onPick}
      className={[
        "text-left rounded-lg px-2 py-1.5",
        active ? "bg-line/50" : "hover:bg-line/25",
      ].join(" ")}
    >
      <div className="font-mono text-[11px] text-ink/85 flex items-baseline gap-1.5">
        <span>{active ? "●" : "○"}</span>
        <span>{preview.provider.label}</span>
        <span className="text-muted ml-auto shrink-0">
          {preview.filled > 0 ? `${preview.filled} of ${total}` : "no values"}
        </span>
      </div>
      {vocabulary.length > 0 && (
        <div className="font-mono text-[10px] text-muted/80 mt-0.5 pl-4 truncate">
          {vocabulary.map((v) => `${v.value} ${v.count}`).join(" · ")}
        </div>
      )}
    </button>
  );
}
