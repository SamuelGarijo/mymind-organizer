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
import type { Collection, DesignObject, FacetField, RoleDefinition } from "../types";

const VISIBLE_VALUES = 6;

/** "typographies, articles, pictures" — the composition of a collection
 * read as plain words (Samuel, 2026-07-21: "Entity type" was internal
 * vocabulary leaking into the UI; the user-facing question is "what can I
 * find here?"). Naive pluralization is fine for display: it never touches
 * the stored role name. */
export function pluralizeRole(name: string): string {
  const lower = name.toLowerCase();
  if (/s$/.test(lower)) return lower;
  if (/[^aeiou]y$/.test(lower)) return lower.slice(0, -1) + "ies";
  return lower + "s";
}

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
 * editorial columns — Info, "Here you can find", one per pinned property.
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
  suppressField,
  showProperties = true,
}: {
  collection: Collection;
  heroObject?: DesignObject;
  /** The collection's full membership (baseObjects) — the ledger describes
   * the world, so it must not reshuffle as quick-filters narrow the view. */
  objects: DesignObject[];
  roles: Record<string, RoleDefinition>;
  roleFilter: string;
  localUserTags: Record<string, string[]>;
  /** The property currently being classified in the right membrane, if any.
   * Its column is dropped here: the membrane is already showing that exact
   * value list, with drop targets and counts, and two live copies of one
   * property in two visual languages is precisely the duplication this
   * refactor set out to remove (Samuel, 2026-07-21). */
  suppressField?: string | null;
  /** False on the "Organize by" page: that page IS one property, rendered
   * as chapters, so repeating the property columns here would state the
   * same thing twice. The entity-type list ("Here you can find") still
   * renders — it's navigation the published page needs. */
  showProperties?: boolean;
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
    .filter((f): f is FacetField => Boolean(f))
    .filter((f) => !suppressField || norm(f.name) !== norm(suppressField))
    .filter(() => showProperties);

  const description = collection.description;

  const hasInfo = Boolean(description || heroObject?.imageUrl);
  const hasAnything = hasInfo || roleKeys.size > 0;
  if (!hasAnything) {
    return (
      <div className="pb-5 font-mono text-[12px] text-muted/80">
        Nothing here has a kind yet — open Classify (right panel) and this world sets itself
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
          {/* Plain words, not schema vocabulary (2026-07-21): the question
           * this column answers is "what's in here?" — with "everything"
           * as a real, first-class answer, never only the narrowed lens. */}
          <ColumnLabel>Here you can find</ColumnLabel>
          <div className="flex flex-col gap-0.5">
            <button
              onClick={() => state.setRoleFilter("")}
              className={[
                "text-left font-mono text-[12px] leading-5 hover:underline decoration-dotted underline-offset-2",
                roleFilter === "" ? "text-ink" : "text-muted hover:text-ink",
              ].join(" ")}
              title="Show everything in this collection, all kinds together"
            >
              {roleFilter === "" ? "● " : ""}everything{" "}
              <span className="text-muted/60">{objects.length}</span>
            </button>
            {roleOptions.map((role) => {
              const active = roleFilter !== "" && norm(role.name) === norm(roleFilter);
              return (
                <button
                  key={role.name}
                  onClick={() => state.setRoleFilter(roleFilter === role.name ? "" : role.name)}
                  className={[
                    "text-left font-mono text-[12px] leading-5 hover:underline decoration-dotted underline-offset-2",
                    active ? "text-ink" : "text-muted hover:text-ink",
                  ].join(" ")}
                  title={
                    active
                      ? "Showing only these — click to see everything again"
                      : `Show only the ${pluralizeRole(role.name)}`
                  }
                >
                  {active ? "● " : ""}
                  {pluralizeRole(role.name)}{" "}
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

      {/* "+ property" moved to the property strip above the page (the
          All-objects / By-X tabs row, 2026-07-21): the existing properties
          and the gesture to add one now live in ONE place, so it's always
          clear what the collection already has. */}
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
