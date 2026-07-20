import { useState } from "react";
import { useShallow } from "zustand/react/shallow";
import { useStore } from "../store";
import { computeFieldValueFrequency, type TagFrequency } from "../lib/quickFilter";
import {
  classifyFacetEmphasis,
  computeFacetStrength,
  computeValueUserShare,
  distinctRoleKeys,
  resolveActiveRole,
} from "../lib/primaryFacets";
import { addMymindTag } from "../lib/mymindWrite";
import { norm } from "../lib/textNorm";
import { DRAG_MIME } from "../lib/objectDrag";
import { previewProviders, proposeWithProvider } from "../lib/fieldExtraction";
import { AddPropertyPopover } from "./AddPropertyPopover";
import type { Collection, DesignObject, FacetField, RoleDefinition } from "../types";

const VISIBLE_VALUES = 6;

function ColumnLabel({ children }: { children: React.ReactNode }) {
  return (
    <div className="font-mono text-[10px] uppercase tracking-[0.12em] text-muted mb-1.5">
      {children}
    </div>
  );
}

/**
 * The collection's own workspace header (design-philosophy Principle 8 —
 * "every collection is a world"), rendered are.na-channel style: quiet
 * editorial columns — Info, Type, one column per pinned facet, Piles.
 *
 * Deliberately NOT chrome: this renders INSIDE the grid's scroll container,
 * so it occupies zero resting-state band budget (N1) and recedes by the most
 * natural gesture there is — scrolling into the things. No collapse buttons,
 * no toggles; the scroll IS the recede.
 */
export function CollectionLedger({
  collection,
  heroObject,
  objects,
  roles,
  roleFilter,
  localUserTags,
  piles,
}: {
  collection: Collection;
  heroObject?: DesignObject;
  /** The collection's full membership (baseObjects) — the ledger describes
   * the world, so it must not reshuffle as quick-filters narrow the view. */
  objects: DesignObject[];
  roles: Record<string, RoleDefinition>;
  roleFilter: string;
  localUserTags: Record<string, string[]>;
  piles: TagFrequency[];
}) {
  const state = useStore(
    useShallow((s) => ({
      facetFieldFilter: s.facetFieldFilter,
      setFacetFieldFilter: s.setFacetFieldFilter,
      setRoleFilter: s.setRoleFilter,
    }))
  );
  const justCreatedField = useStore((s) => s.justCreatedFieldName);
  const [expandedField, setExpandedField] = useState<string | null>(null);
  const [dropTarget, setDropTarget] = useState<string | null>(null);
  const [addingProperty, setAddingProperty] = useState(false);

  /** Dropping cards onto a value assigns it — and records it as hand-picked,
   * because a deliberate drag IS a hand-confirmation (unlike an extractor's
   * guess, which deliberately stays unconfirmed). */
  function assignValue(ids: string[], field: FacetField, value: string) {
    const st = useStore.getState();
    st.assignFieldValue(ids, field.name, value, field.type === "multi-select" ? "append" : "replace");
    for (const id of ids) st.recordUserValue(id, value);
  }

  const roleKeys = distinctRoleKeys(objects);
  const activeRole = resolveActiveRole(objects, roles, roleFilter);

  const roleCounts = new Map<string, number>();
  for (const o of objects) {
    if (!o.role) continue;
    const key = norm(o.role);
    roleCounts.set(key, (roleCounts.get(key) ?? 0) + 1);
  }
  const roleOptions = Array.from(roleKeys)
    .map((key) => roles[key])
    .filter((def): def is RoleDefinition => Boolean(def))
    .sort((a, b) => (roleCounts.get(norm(b.name)) ?? 0) - (roleCounts.get(norm(a.name)) ?? 0));

  // Coverage/value counts scored against objects that actually carry the
  // active role — not the whole (possibly heterogeneous) collection.
  const roleObjects = activeRole
    ? objects.filter((o) => o.role && norm(o.role) === norm(activeRole.name))
    : [];

  const pinnedByName = activeRole ? new Map(activeRole.fields.map((f) => [f.name, f])) : new Map();
  const orderedPinned: FacetField[] = (activeRole?.primaryFacets ?? [])
    .map((name) => pinnedByName.get(name))
    .filter((f): f is FacetField => Boolean(f));

  const description = collection.description;

  const hasInfo = Boolean(description || heroObject?.imageUrl);
  const hasAnything = hasInfo || roleKeys.size > 0 || piles.length > 0;
  if (!hasAnything) {
    return (
      <div className="pb-5 font-mono text-[12px] text-muted/80">
        No item types assigned in this collection yet — ✦ Classify (top right) sets this world
        up.
      </div>
    );
  }

  return (
    <div className="pb-6 flex flex-wrap items-start gap-x-12 gap-y-5">
      {hasInfo && (
        <div className="max-w-xs">
          <ColumnLabel>Info</ColumnLabel>
          <div className="flex items-start gap-3">
            {heroObject?.imageUrl && (
              <img
                src={heroObject.imageUrl}
                alt=""
                className="w-14 h-14 rounded-lg object-cover shrink-0"
              />
            )}
            {description && (
              <p className="text-[12px] text-ink/75 leading-relaxed">{description}</p>
            )}
          </div>
        </div>
      )}

      {roleKeys.size >= 2 && (
        <div>
          <ColumnLabel>Format</ColumnLabel>
          <div className="flex flex-col gap-0.5">
            {roleOptions.map((role) => {
              const active = activeRole && norm(role.name) === norm(activeRole.name);
              return (
                <button
                  key={role.name}
                  onClick={() => state.setRoleFilter(roleFilter === role.name ? "" : role.name)}
                  className={[
                    "text-left font-mono text-[12px] leading-5 hover:underline decoration-dotted underline-offset-2",
                    active ? "text-ink" : "text-muted hover:text-ink",
                  ].join(" ")}
                  title={
                    roleFilter === role.name
                      ? "Showing only this type — click to clear"
                      : "Focus this type's facets"
                  }
                >
                  {active ? "● " : ""}
                  {role.name}{" "}
                  <span className="text-muted/60">{roleCounts.get(norm(role.name)) ?? 0}</span>
                </button>
              );
            })}
          </div>
        </div>
      )}

      {orderedPinned.map((field) => {
        const strength = computeFacetStrength(roleObjects, field, localUserTags);
        // Only the property just created via "+ property" is exempt from
        // coverage-hiding — it must appear even at 0% or the gesture reads
        // as failed. Every OTHER low-coverage facet stays hidden: the
        // resting ledger is content, not a wall of half-empty columns.
        const emphasis = classifyFacetEmphasis(
          strength,
          justCreatedField !== null && norm(field.name) === norm(justCreatedField)
        );
        if (emphasis === "hidden") return null;
        const values = computeFieldValueFrequency(roleObjects, field.name);
        const expanded = expandedField === field.name;
        const shown = expanded ? values : values.slice(0, VISIBLE_VALUES);
        const hiddenCount = values.length - shown.length;
        const emptyCount = roleObjects.length - Math.round(strength.coveragePct * roleObjects.length);
        return (
          <div key={field.name} className={["group/facet", emphasis === "muted" ? "opacity-60" : ""].join(" ")}>
            <ColumnLabel>{field.name}</ColumnLabel>
            <div className="flex flex-col gap-0.5">
              {values.length === 0 && (
                <span className="font-mono text-[11px] text-muted/70 italic">
                  nothing filled yet
                </span>
              )}
              {shown.map((v) => {
                const active =
                  state.facetFieldFilter?.field === field.name &&
                  state.facetFieldFilter.value === v.tag;
                const userShare = computeValueUserShare(roleObjects, field, v.tag, localUserTags);
                const over = dropTarget === `${field.name}::${v.tag}`;
                return (
                  <button
                    key={v.tag}
                    onClick={() =>
                      state.setFacetFieldFilter(active ? null : { field: field.name, value: v.tag })
                    }
                    // Inline assignment without leaving the collection: drop
                    // cards straight onto a value. Same universal drag
                    // contract Piles and the Classify folders already use —
                    // a new gesture would be new chrome; this is none.
                    onDragOver={(e) => {
                      e.preventDefault();
                      setDropTarget(`${field.name}::${v.tag}`);
                    }}
                    onDragLeave={() =>
                      setDropTarget((cur) => (cur === `${field.name}::${v.tag}` ? null : cur))
                    }
                    onDrop={(e) => {
                      e.preventDefault();
                      setDropTarget(null);
                      const raw = e.dataTransfer.getData(DRAG_MIME);
                      if (!raw) return;
                      assignValue(JSON.parse(raw) as string[], field, v.tag);
                    }}
                    className={[
                      "text-left font-mono text-[12px] leading-5 hover:underline decoration-dotted underline-offset-2 rounded",
                      active ? "text-accent" : userShare < 0.5 ? "text-muted/70" : "text-ink/80",
                      over ? "ring-2 ring-accent/60 bg-accent/5" : "",
                    ].join(" ")}
                    title={
                      (active ? "Filtering — click to clear. " : "") +
                      (userShare >= 0.5
                        ? "Hand-confirmed here"
                        : "Derived, not yet hand-confirmed") +
                      " · drop items here to give them this value"
                    }
                  >
                    {active ? "● " : ""}
                    {v.tag} <span className="text-muted/60">{v.count}</span>
                  </button>
                );
              })}
              {hiddenCount > 0 && (
                <button
                  onClick={() => setExpandedField(field.name)}
                  className="text-left font-mono text-[11px] text-muted hover:text-ink"
                >
                  +{hiddenCount} more
                </button>
              )}
              {expanded && (
                <button
                  onClick={() => setExpandedField(null)}
                  className="text-left font-mono text-[11px] text-muted hover:text-ink"
                >
                  less
                </button>
              )}
              {emptyCount > 0 && <FillRow field={field} objects={roleObjects} empty={emptyCount} />}
            </div>
          </div>
        );
      })}

      {activeRole && (
        <div className="relative self-start">
          <button
            onClick={() => setAddingProperty((v) => !v)}
            className="font-mono text-[10px] uppercase tracking-[0.12em] text-muted/50 hover:text-ink transition-colors"
            title={`Organize ${activeRole.name} by another property`}
          >
            + property
          </button>
          {addingProperty && (
            <AddPropertyPopover
              roleName={activeRole.name}
              objects={roleObjects}
              onClose={() => setAddingProperty(false)}
            />
          )}
        </div>
      )}

      {piles.length > 0 && (
        <div className="max-w-xs">
          <ColumnLabel>Piles</ColumnLabel>
          <PileChips piles={piles} />
        </div>
      )}
    </div>
  );
}

/**
 * The repeatable half of enrichment: "138 empty · fill 121".
 *
 * Only rendered when a provider can actually contribute something that isn't
 * already there — an offer with nothing behind it is noise, and a field the
 * data genuinely can't answer (serif vs sans) must stay quiet rather than
 * promise a fill it can't deliver. Re-running is safe by construction:
 * applyProposals never overwrites a hand-set value, and only replaces its own
 * earlier guesses, so this stays useful as the rules improve.
 */
function FillRow({
  field,
  objects,
  empty,
}: {
  field: FacetField;
  objects: DesignObject[];
  empty: number;
}) {
  const missing = objects.filter((o) => {
    const v = o.fields[field.name];
    return Array.isArray(v) ? v.length === 0 : !v;
  });
  const best = previewProviders(missing, field.name, field)
    .filter((p) => p.filled > 0)
    .sort((a, b) => b.filled - a.filled)[0];

  return (
    // Hover-summoned, never resident: a standing "412 empty · fill" on every
    // column multiplied into exactly the kind of chrome wall the design
    // philosophy bans. The offer appears when attention arrives at the
    // column and recedes with it.
    <div className="font-mono text-[10px] text-muted/60 mt-0.5 opacity-0 group-hover/facet:opacity-100 transition-opacity">
      {empty} empty
      {best && (
        <>
          {" · "}
          <button
            onClick={() =>
              useStore
                .getState()
                .applyProposals(proposeWithProvider(best.provider, missing, field.name, field))
            }
            className="text-accent/80 hover:text-accent hover:underline decoration-dotted underline-offset-2"
            title={`Derive ${best.filled} value${best.filled > 1 ? "s" : ""} from ${best.provider.label}. Never overwrites anything you set by hand.`}
          >
            fill {best.filled}
          </button>
        </>
      )}
    </div>
  );
}

/**
 * Curated piles — user-created tags as lightweight desk piles. Click to
 * filter, drop a card to tag it. Rendered inside the ledger for collections
 * and standalone above the grid for library-wide views; in both cases it's
 * content that scrolls, never a resident band.
 */
export function PileChips({ piles }: { piles: TagFrequency[] }) {
  const state = useStore(
    useShallow((s) => ({
      objects: s.objects,
      facetTags: s.facetTags,
      toggleFacetTag: s.toggleFacetTag,
      addObjectTag: s.addObjectTag,
    }))
  );
  const [expanded, setExpanded] = useState(false);
  const [dragOverPile, setDragOverPile] = useState<string | null>(null);

  function assignTag(objectId: string, tag: string) {
    const object = state.objects[objectId];
    if (!object || object.tags.includes(tag)) return;
    state.addObjectTag(objectId, tag);
    if (object.source === "mymind") void addMymindTag(objectId, tag);
  }

  const selectedSet = new Set(state.facetTags);
  // Selected piles pin first so an active filter never hides under "more".
  const ordered = [
    ...piles.filter((p) => selectedSet.has(p.tag)),
    ...piles.filter((p) => !selectedSet.has(p.tag)),
  ];
  const shown = expanded ? ordered : ordered.slice(0, 8);
  const hiddenCount = ordered.length - shown.length;

  return (
    <div className="flex flex-wrap items-center gap-1.5">
      {shown.map(({ tag, count }) => {
        const active = selectedSet.has(tag);
        const dragOver = dragOverPile === tag;
        return (
          <button
            key={tag}
            onClick={() => state.toggleFacetTag(tag)}
            onDragOver={(e) => {
              e.preventDefault();
              setDragOverPile(tag);
            }}
            onDragLeave={() => setDragOverPile(dragOverPile === tag ? null : dragOverPile)}
            onDrop={(e) => {
              e.preventDefault();
              setDragOverPile(null);
              const raw = e.dataTransfer.getData(DRAG_MIME);
              if (!raw) return;
              const ids: string[] = JSON.parse(raw);
              for (const id of ids) assignTag(id, tag);
            }}
            className={[
              "tag-chip gap-1 shrink-0 font-mono",
              active ? "bg-ink text-white border-ink" : "",
              dragOver ? "ring-2 ring-accent ring-offset-1 ring-offset-canvas" : "",
            ].join(" ")}
            title={`${tag} — click to filter, drop an item here to add this tag to it`}
          >
            {tag}
            <span className={active ? "text-white/60" : "text-muted"}>{count}</span>
          </button>
        );
      })}
      {(hiddenCount > 0 || expanded) && (
        <button
          onClick={() => setExpanded((v) => !v)}
          className="font-mono text-[11px] text-muted hover:text-ink shrink-0 px-1"
        >
          {expanded ? "less" : `+${hiddenCount} more`}
        </button>
      )}
    </div>
  );
}

/**
 * One-line role picker shown above the Board while classifying — the only
 * ledger piece that must stay visible in board mode (you switch roles while
 * boarding). Contextual chrome tied to the board intent: appears with it,
 * recedes with it (N21).
 */
export function RoleStrip({
  objects,
  roles,
  roleFilter,
}: {
  objects: DesignObject[];
  roles: Record<string, RoleDefinition>;
  roleFilter: string;
}) {
  const setRoleFilter = useStore((s) => s.setRoleFilter);
  const roleKeys = distinctRoleKeys(objects);
  const activeRole = resolveActiveRole(objects, roles, roleFilter);
  if (roleKeys.size < 2 || !activeRole) return null;

  const roleOptions = Array.from(roleKeys)
    .map((key) => roles[key])
    .filter((def): def is RoleDefinition => Boolean(def))
    .sort((a, b) => a.name.localeCompare(b.name));

  return (
    <div className="shrink-0 px-5 pt-3 flex items-center gap-1.5 flex-wrap">
      <span className="font-mono text-[10px] uppercase tracking-[0.12em] text-muted shrink-0">
        Type
      </span>
      {roleOptions.map((role) => (
        <button
          key={role.name}
          onClick={() => setRoleFilter(roleFilter === role.name ? "" : role.name)}
          className={[
            "tag-chip font-mono",
            norm(role.name) === norm(activeRole.name) ? "border-accent/40 bg-accent/5 text-ink" : "",
          ].join(" ")}
        >
          {role.name}
        </button>
      ))}
    </div>
  );
}
