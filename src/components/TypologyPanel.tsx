import { useMemo, useState } from "react";
import { allObjectsOf, useStore } from "../store";
import { getKnownFields } from "../lib/fieldCatalog";
import { proposeTypology, type TypologyProperty } from "../lib/collectionTypology";
import type { DesignObject, FacetField } from "../types";

/**
 * "What am I actually collecting here?" — asked at the moment a collection
 * is made, because that's the moment the answer is clearest.
 *
 * Curation is a stronger signal than counting: putting forty-seven things
 * together IS recognising a kind (Samuel, 2026-07-21). So instead of
 * discovering types from tag statistics — which produced "residentials"
 * and "germans" as species — this asks once, here, with the vocabulary
 * already sitting in the members' own tags as the evidence.
 *
 * Optional throughout. Skip it and the collection is just a folder, which
 * is what it always was.
 */
export function TypologyPanel({
  collectionName,
  members,
  onApply,
}: {
  collectionName: string;
  members: DesignObject[];
  /** Called on save with the chosen kind and properties, or null if the
   * user left this alone. */
  onApply: (typology: { name: string; fields: FacetField[] } | null) => void;
}) {
  const roles = useStore((s) => s.roles);
  const collections = useStore((s) => s.collections);
  const objects = useStore((s) => s.objects);

  const [enabled, setEnabled] = useState(false);
  const [nameDraft, setNameDraft] = useState("");
  const [chosen, setChosen] = useState<Set<string> | null>(null);

  const proposal = useMemo(() => {
    if (members.length === 0) return null;
    return proposeTypology({
      collectionName,
      members,
      roles,
      archive: allObjectsOf(objects),
      knownFields: getKnownFields(collections, roles),
    });
  }, [collectionName, members, roles, objects, collections]);

  // Everything worth knowing is pre-ticked: the proposal exists because it
  // would find values, so opting OUT is the rarer act.
  const selected =
    chosen ?? new Set((proposal?.properties ?? []).map((p) => p.field.name));
  const typeName = (nameDraft || proposal?.name || collectionName).trim();

  function toggle(fieldName: string) {
    const next = new Set(selected);
    if (next.has(fieldName)) next.delete(fieldName);
    else next.add(fieldName);
    setChosen(next);
  }

  function commit(on: boolean) {
    setEnabled(on);
    if (!on || !proposal) {
      onApply(null);
      return;
    }
    onApply({
      name: typeName,
      fields: proposal.properties.filter((p) => selected.has(p.field.name)).map((p) => p.field),
    });
  }

  // Re-publish on every change so the modal's Save always has the current
  // choice without a second confirmation step.
  function republish(nextName = typeName, nextSelected = selected) {
    if (!enabled || !proposal) return;
    onApply({
      name: nextName.trim(),
      fields: proposal.properties
        .filter((p) => nextSelected.has(p.field.name))
        .map((p) => p.field),
    });
  }

  if (!proposal || members.length === 0) return null;

  return (
    <div className="mt-3 rounded-xl border border-line/70 bg-canvas/50 p-3">
      <label className="flex items-start gap-2 cursor-pointer">
        <input
          type="checkbox"
          checked={enabled}
          onChange={(e) => commit(e.target.checked)}
          className="mt-0.5"
        />
        <span className="min-w-0">
          <span className="block text-[13px] text-ink">
            These are all a kind of thing
          </span>
          <span className="block font-mono text-[10px] text-muted leading-relaxed">
            Putting {members.length.toLocaleString()} things together is already deciding they
            belong to the same kind. Naming it here gives them shared properties everywhere in
            the archive, not only in this collection.
          </span>
        </span>
      </label>

      {enabled && (
        <div className="mt-3 space-y-2.5">
          <input
            value={nameDraft || proposal.name}
            onChange={(e) => {
              setNameDraft(e.target.value);
              republish(e.target.value);
            }}
            placeholder="Name this kind…"
            className="w-full rounded-lg border border-line px-2.5 py-1.5 text-sm outline-none focus:border-accent"
          />

          {proposal.replaces.length > 0 && (
            <p className="font-mono text-[10px] text-muted leading-relaxed">
              Replaces{" "}
              {proposal.replaces
                .map((r) => `${r.name.toLowerCase()} ${r.count}`)
                .join(" · ")}{" "}
              — their properties are kept below, so nothing described stops being described.
            </p>
          )}

          <div>
            <div className="font-mono text-[10px] uppercase tracking-[0.12em] text-muted mb-1.5">
              What's worth knowing about them
            </div>
            {proposal.properties.length === 0 ? (
              <p className="font-mono text-[11px] text-muted/80">
                Nothing to suggest yet — add properties later with + Property.
              </p>
            ) : (
              <div className="space-y-0.5">
                {proposal.properties.map((p) => (
                  <PropertyRow
                    key={p.field.name}
                    property={p}
                    checked={selected.has(p.field.name)}
                    onToggle={() => {
                      const next = new Set(selected);
                      if (next.has(p.field.name)) next.delete(p.field.name);
                      else next.add(p.field.name);
                      setChosen(next);
                      republish(typeName, next);
                    }}
                  />
                ))}
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
}

const SOURCE_LABEL: Record<TypologyProperty["source"], string> = {
  inherited: "already theirs",
  archive: "you use this elsewhere",
  derived: "from their own tags",
};

function PropertyRow({
  property,
  checked,
  onToggle,
}: {
  property: TypologyProperty;
  checked: boolean;
  onToggle: () => void;
}) {
  return (
    <button
      onClick={onToggle}
      className={[
        "w-full text-left flex items-start gap-2 px-2 py-1.5 rounded-lg border transition-colors",
        checked ? "border-accent/40 bg-accent/5" : "border-transparent hover:bg-line/25",
      ].join(" ")}
    >
      <span
        className={[
          "shrink-0 mt-0.5 w-3.5 h-3.5 rounded border flex items-center justify-center text-[9px]",
          checked ? "bg-ink border-ink text-white" : "border-line",
        ].join(" ")}
        aria-hidden
      >
        {checked ? "✓" : ""}
      </span>
      <span className="min-w-0 flex-1">
        <span className="block text-[12px] text-ink">
          {property.field.name}{" "}
          <span className="font-mono text-[10px] text-muted/70">
            · {SOURCE_LABEL[property.source]}
            {property.wouldFill > 0 && ` · ${property.wouldFill} already set`}
          </span>
        </span>
        {property.sampleValues.length > 0 && (
          <span className="block font-mono text-[10px] text-muted/80 truncate">
            {property.sampleValues.join(" · ")}
          </span>
        )}
      </span>
    </button>
  );
}
