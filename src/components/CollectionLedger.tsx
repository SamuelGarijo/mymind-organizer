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
  const [expandedField, setExpandedField] = useState<string | null>(null);

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
          <ColumnLabel>Type</ColumnLabel>
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
        const emphasis = classifyFacetEmphasis(strength);
        if (emphasis === "hidden") return null;
        const values = computeFieldValueFrequency(roleObjects, field.name);
        if (values.length === 0) return null;
        const expanded = expandedField === field.name;
        const shown = expanded ? values : values.slice(0, VISIBLE_VALUES);
        const hiddenCount = values.length - shown.length;
        return (
          <div key={field.name} className={emphasis === "muted" ? "opacity-60" : ""}>
            <ColumnLabel>{field.name}</ColumnLabel>
            <div className="flex flex-col gap-0.5">
              {shown.map((v) => {
                const active =
                  state.facetFieldFilter?.field === field.name &&
                  state.facetFieldFilter.value === v.tag;
                const userShare = computeValueUserShare(roleObjects, field, v.tag, localUserTags);
                return (
                  <button
                    key={v.tag}
                    onClick={() =>
                      state.setFacetFieldFilter(active ? null : { field: field.name, value: v.tag })
                    }
                    className={[
                      "text-left font-mono text-[12px] leading-5 hover:underline decoration-dotted underline-offset-2",
                      active ? "text-accent" : userShare < 0.5 ? "text-muted/70" : "text-ink/80",
                    ].join(" ")}
                    title={
                      (active ? "Filtering — click to clear. " : "") +
                      (userShare >= 0.5 ? "Hand-confirmed here" : "From mymind/AI, not yet hand-confirmed")
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
            </div>
          </div>
        );
      })}

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
