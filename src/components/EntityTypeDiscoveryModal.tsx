import { useMemo, useState } from "react";
import { useStore } from "../store";
import {
  discoverEntityTypes,
  objectsForProposal,
  type EntityTypeProposal,
} from "../lib/entityTypeDiscovery";
import { allObjectsOf } from "../store";

/**
 * "What kinds of thing are in here?" — asked of the archive instead of
 * hand-written (Samuel, 2026-07-21: a photograph of a building had no
 * entity type because nobody had thought to define "architecture").
 *
 * Deliberately a proposal list, not an automation that runs. Tag frequency
 * finds real pockets of the library, but it cannot tell a KIND from an
 * ATTRIBUTE — measured, not assumed: ranking these by tag cohesion put
 * "spine" first and "architecture" last, because a facet of one kind is
 * more cohesive than the kind itself. That judgement is semantic, so it
 * stays with the person: glance at the counts and samples, tick what reads
 * true. Ticking a dozen boxes once is not librarian work; defining each
 * type by hand from nothing was.
 */
export function EntityTypeDiscoveryModal({ onClose }: { onClose: () => void }) {
  const objects = useStore((s) => s.objects);
  const roles = useStore((s) => s.roles);
  const all = allObjectsOf(objects);

  const proposals = useMemo(() => discoverEntityTypes(all, roles), [all, roles]);
  const [accepted, setAccepted] = useState<Set<string>>(new Set());

  const totalObjects = proposals
    .filter((p) => accepted.has(p.tag))
    .reduce((sum, p) => sum + p.untypedCount, 0);

  function toggle(tag: string) {
    setAccepted((cur) => {
      const next = new Set(cur);
      if (next.has(tag)) next.delete(tag);
      else next.add(tag);
      return next;
    });
  }

  function apply() {
    const st = useStore.getState();
    const pool = allObjectsOf(st.objects);
    const assignments: { objectId: string; role: string }[] = [];
    const chosen = proposals.filter((p) => accepted.has(p.tag));

    for (const proposal of chosen) {
      for (const object of objectsForProposal(pool, proposal)) {
        assignments.push({ objectId: object.id, role: proposal.name });
      }
    }
    if (assignments.length === 0) {
      onClose();
      return;
    }
    // bulkAssignRoles creates each definition (seeded from the curated
    // catalogue where the name is known) and promotes matching tags in one
    // atomic update.
    st.bulkAssignRoles(assignments);

    // Anything the curated catalogue didn't cover gets the derived starter
    // package — one property, out of the archive's own vocabulary.
    for (const proposal of chosen) {
      if (proposal.starterFields.length === 0) continue;
      const def = useStore.getState().roles[proposal.name.toLowerCase()];
      if (def && def.fields.length > 0) continue;
      st.updateRoleFields(
        proposal.name,
        proposal.starterFields,
        proposal.starterFields.slice(0, 3).map((f) => f.name)
      );
    }

    st.setFlashNotice(
      `Typed ${assignments.length.toLocaleString()} items across ${chosen.length} new kind${chosen.length === 1 ? "" : "s"}. Editable on any item.`
    );
    onClose();
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center">
      <div className="absolute inset-0 bg-black/30" onClick={onClose} />
      <div className="relative bg-panel rounded-card border border-line shadow-2xl w-full max-w-2xl max-h-[80vh] flex flex-col">
        <div className="shrink-0 p-5 pb-3">
          <div className="text-sm font-medium mb-1">What's in your archive</div>
          <p className="text-[12px] text-muted leading-relaxed">
            Found by reading the tags you already use — a word hundreds of things share is a
            kind of thing here, whether or not anyone codified it. Tick what reads true; a
            word that's really an attribute (a place, an era, a part) will be in this list
            too, because counting can't tell those apart.
          </p>
        </div>

        <div className="flex-1 min-h-0 overflow-y-auto px-5 space-y-1">
          {proposals.length === 0 && (
            <p className="text-[12px] text-muted py-6 text-center">
              Nothing new to propose — every recurring word here is already an entity type.
            </p>
          )}
          {proposals.map((p) => (
            <ProposalRow
              key={p.tag}
              proposal={p}
              objects={objects}
              checked={accepted.has(p.tag)}
              onToggle={() => toggle(p.tag)}
            />
          ))}
        </div>

        <div className="shrink-0 p-5 pt-3 flex items-center justify-between border-t border-line/60">
          <span className="font-mono text-[11px] text-muted">
            {accepted.size === 0
              ? "nothing selected"
              : `${accepted.size} kind${accepted.size === 1 ? "" : "s"} · ${totalObjects.toLocaleString()} items`}
          </span>
          <div className="flex gap-2">
            <button
              onClick={onClose}
              className="text-sm px-3 py-1.5 rounded-lg hover:bg-line/40 text-ink/70"
            >
              Cancel
            </button>
            <button
              onClick={apply}
              disabled={accepted.size === 0}
              className="text-sm px-3 py-1.5 rounded-lg bg-ink text-white disabled:opacity-30"
            >
              Create
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}

function ProposalRow({
  proposal,
  objects,
  checked,
  onToggle,
}: {
  proposal: EntityTypeProposal;
  objects: Record<string, import("../types").DesignObject>;
  checked: boolean;
  onToggle: () => void;
}) {
  const samples = proposal.sampleIds.map((id) => objects[id]).filter(Boolean);
  return (
    <button
      onClick={onToggle}
      className={[
        "w-full text-left flex items-center gap-3 px-2.5 py-2 rounded-lg border transition-colors",
        checked ? "border-accent/50 bg-accent/5" : "border-transparent hover:bg-line/25",
      ].join(" ")}
    >
      <span
        className={[
          "shrink-0 w-4 h-4 rounded border flex items-center justify-center text-[10px]",
          checked ? "bg-ink border-ink text-white" : "border-line",
        ].join(" ")}
        aria-hidden
      >
        {checked ? "✓" : ""}
      </span>
      <span className="flex-1 min-w-0">
        <span className="block text-[13px] text-ink truncate">{proposal.name}</span>
        <span className="block font-mono text-[10px] text-muted">
          {proposal.untypedCount.toLocaleString()} untyped
          {proposal.starterFields.length > 0 && (
            <> · starts with {proposal.starterFields.map((f) => f.name).join(", ")}</>
          )}
        </span>
      </span>
      <span className="shrink-0 flex gap-0.5">
        {samples.slice(0, 5).map((o) =>
          o.imageUrl ? (
            <img
              key={o.id}
              src={o.imageUrl}
              alt=""
              className="w-8 h-8 rounded object-cover border border-line"
            />
          ) : null
        )}
      </span>
    </button>
  );
}
