import type { DesignObject, FacetField } from "../types";
import { ITEM_TYPE_GROUP, rankableFacetColumns } from "../lib/grouping";

/** Shared "Group by" control — used identically by Table (#85) and Grid
 * (#98) so both views group the same way from the same dropdown, instead
 * of each hand-rolling its own (and inevitably drifting). Renders nothing
 * when there's nothing to group by. */
export function GroupBySelect({
  value,
  onChange,
  hasRoles,
  facetColumns,
  objects,
}: {
  value: string | null;
  onChange: (value: string | null) => void;
  hasRoles: boolean;
  facetColumns: FacetField[];
  objects: DesignObject[];
}) {
  const rankedColumns = rankableFacetColumns(objects, facetColumns);
  if (rankedColumns.length === 0 && !hasRoles) return null;
  return (
    <div className="shrink-0 flex items-center gap-1.5 mb-2 text-[12px]">
      <span className="text-muted">Group by</span>
      <select
        value={value ?? ""}
        onChange={(e) => onChange(e.target.value || null)}
        className="rounded-lg border border-line px-2 py-1 text-[12px] bg-panel outline-none focus:border-accent"
      >
        <option value="">None</option>
        {hasRoles && <option value={ITEM_TYPE_GROUP}>Item type</option>}
        {rankedColumns.map((f) => (
          <option key={f.name} value={f.name}>
            {f.name}
          </option>
        ))}
      </select>
    </div>
  );
}
