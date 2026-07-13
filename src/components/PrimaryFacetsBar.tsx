import { useEffect, useState } from "react";
import { useShallow } from "zustand/react/shallow";
import { useStore } from "../store";
import { computeFieldValueFrequency } from "../lib/quickFilter";
import {
  classifyFacetEmphasis,
  computeFacetStrength,
  computeValueUserShare,
  distinctRoleKeys,
  resolveActiveRole,
} from "../lib/primaryFacets";
import { norm } from "../lib/textNorm";
import type { DesignObject, FacetField, RoleDefinition } from "../types";

const VISIBLE_VALUES = 6;

/**
 * Collection-workspace top bar (sits above FilterBar, not a replacement for
 * it): a role picker for heterogeneous collections, then whichever role is
 * active's pinned primaryFacets as clickable value chips. Every "what's
 * active/what's emphasized" decision is delegated to lib/primaryFacets.ts —
 * this component only renders what that module resolves.
 */
export function PrimaryFacetsBar({
  objects,
  roles,
  roleFilter,
  localUserTags,
  viewKey,
}: {
  objects: DesignObject[];
  roles: Record<string, RoleDefinition>;
  roleFilter: string;
  localUserTags: Record<string, string[]>;
  /** JSON.stringify(selectedView), same identity App.tsx already derives —
   * used only to reset a stale roleFilter when the collection changes. */
  viewKey: string;
}) {
  const { facetFieldFilter, setRoleFilter, setFacetFieldFilter, openClassificationPanel } =
    useStore(
      useShallow((s) => ({
        facetFieldFilter: s.facetFieldFilter,
        setRoleFilter: s.setRoleFilter,
        setFacetFieldFilter: s.setFacetFieldFilter,
        openClassificationPanel: s.openClassificationPanel,
      }))
    );
  const [expandedField, setExpandedField] = useState<string | null>(null);

  // setSelectedView doesn't clear roleFilter (only the other quick-filters)
  // — harmless before this feature, but now that role-filtering drives the
  // top bar directly, a stale role surviving a collection switch could
  // silently show "0 objects match" for a role this collection doesn't
  // even have. Reset locally rather than touching the shared reducer.
  useEffect(() => {
    setRoleFilter("");
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [viewKey]);

  const roleKeys = distinctRoleKeys(objects);
  const activeRole = resolveActiveRole(objects, roles, roleFilter);
  if (roleKeys.size === 0 || !activeRole) return null;

  const roleOptions = Array.from(roleKeys)
    .map((key) => roles[key])
    .filter((def): def is RoleDefinition => Boolean(def))
    .sort((a, b) => a.name.localeCompare(b.name));

  // Coverage/value counts must be scored against objects that actually carry
  // the active role — not the whole (possibly heterogeneous) collection, or
  // a field only ~10 of 175 objects could even have would always read as
  // near-zero coverage and get hidden regardless of how complete it really
  // is within its own role.
  const roleObjects = objects.filter((o) => o.role && norm(o.role) === norm(activeRole.name));

  const pinnedByName = new Map(activeRole.fields.map((f) => [f.name, f]));
  const orderedPinned = (activeRole.primaryFacets ?? [])
    .map((name) => pinnedByName.get(name))
    .filter((f): f is FacetField => Boolean(f));

  return (
    <div className="shrink-0 border-b border-line bg-panel px-5 py-2.5 flex flex-col gap-2">
      {roleKeys.size >= 2 && (
        <div className="flex items-center gap-1.5 flex-wrap">
          <span className="text-[11px] uppercase tracking-wide text-muted shrink-0">Type</span>
          {roleOptions.map((role) => (
            <button
              key={role.name}
              onClick={() => setRoleFilter(roleFilter === role.name ? "" : role.name)}
              className={[
                "tag-chip",
                norm(role.name) === norm(activeRole.name) ? "border-accent/40 bg-accent/5 text-ink" : "",
              ].join(" ")}
            >
              {role.name}
            </button>
          ))}
        </div>
      )}

      {orderedPinned.length > 0 && (
        <div className="flex items-start gap-3 flex-wrap">
          {orderedPinned.map((field) => {
            const strength = computeFacetStrength(roleObjects, field, localUserTags);
            const emphasis = classifyFacetEmphasis(strength);
            if (emphasis === "hidden") return null;
            const values = computeFieldValueFrequency(roleObjects, field.name);
            const expanded = expandedField === field.name;
            const shown = expanded ? values : values.slice(0, VISIBLE_VALUES);
            const hiddenCount = values.length - shown.length;
            return (
              <div
                key={field.name}
                className={["flex items-center gap-1 flex-wrap", emphasis === "muted" ? "opacity-60" : ""].join(
                  " "
                )}
              >
                <span className="text-[11px] text-muted shrink-0">{field.name}</span>
                {shown.map((v) => {
                  const active =
                    facetFieldFilter?.field === field.name && facetFieldFilter.value === v.tag;
                  const userShare = computeValueUserShare(roleObjects, field, v.tag, localUserTags);
                  return (
                    <button
                      key={v.tag}
                      onClick={() =>
                        setFacetFieldFilter(active ? null : { field: field.name, value: v.tag })
                      }
                      className={[
                        "tag-chip gap-1",
                        active ? "border-accent/40 bg-accent/5 text-ink" : "",
                        userShare < 0.5 ? "border-dashed text-muted" : "",
                      ].join(" ")}
                      title={
                        userShare >= 0.5
                          ? "Hand-confirmed here"
                          : "From mymind/AI, not yet hand-confirmed"
                      }
                    >
                      {v.tag} <span className="text-muted/70">{v.count}</span>
                    </button>
                  );
                })}
                {hiddenCount > 0 && (
                  <button
                    onClick={() => setExpandedField(field.name)}
                    className="tag-chip text-muted hover:text-ink"
                  >
                    +{hiddenCount} more
                  </button>
                )}
                {expanded && (
                  <button
                    onClick={() => setExpandedField(null)}
                    className="tag-chip text-muted hover:text-ink"
                  >
                    less
                  </button>
                )}
              </div>
            );
          })}
          <button
            onClick={openClassificationPanel}
            className="tag-chip ml-auto shrink-0 hover:border-accent hover:text-ink"
            title="Open the classification panel — drag items onto facet values to classify them"
          >
            Classify
          </button>
        </div>
      )}
    </div>
  );
}
