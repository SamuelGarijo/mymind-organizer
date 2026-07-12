import { useState } from "react";
import { useStore } from "../store";
import { useShallow } from "zustand/react/shallow";
import { computeFieldValueFrequency, type TagFrequency, type TypeFrequency } from "../lib/quickFilter";
import { norm } from "../lib/ruleEngine";
import { colorForGroup } from "../lib/tagGroupColor";
import type { DesignObject, FacetField } from "../types";

export function FilterBar({
  topTags,
  objectTypes,
  facetColumns,
  fieldFilterPool,
}: {
  topTags: TagFrequency[];
  objectTypes: TypeFrequency[];
  facetColumns: FacetField[];
  fieldFilterPool: DesignObject[];
}) {
  // Shallow-selected — this bar legitimately re-renders on every keystroke
  // (it's the input itself), but a bare useStore() also re-rendered it on
  // every unrelated store change (syncs, tag edits, opening a detail panel),
  // which this avoids.
  const {
    searchQuery,
    facetTags,
    facetMode,
    excludedTags,
    facetFieldFilter,
    typeFilter,
    tagGroups,
    setSearchQuery,
    toggleFacetTag,
    setFacetMode,
    clearFacetTags,
    toggleExcludeTag,
    clearExcludedTags,
    setFacetFieldFilter,
    setTypeFilter,
  } = useStore(
    useShallow((s) => ({
      searchQuery: s.searchQuery,
      facetTags: s.facetTags,
      facetMode: s.facetMode,
      excludedTags: s.excludedTags,
      facetFieldFilter: s.facetFieldFilter,
      typeFilter: s.typeFilter,
      tagGroups: s.tagGroups,
      setSearchQuery: s.setSearchQuery,
      toggleFacetTag: s.toggleFacetTag,
      setFacetMode: s.setFacetMode,
      clearFacetTags: s.clearFacetTags,
      toggleExcludeTag: s.toggleExcludeTag,
      clearExcludedTags: s.clearExcludedTags,
      setFacetFieldFilter: s.setFacetFieldFilter,
      setTypeFilter: s.setTypeFilter,
    }))
  );

  // The field picker and its value picker are two dependent selects — kept
  // as local UI state distinct from the committed store filter so picking a
  // field doesn't itself filter anything until a value is also chosen.
  const [pendingField, setPendingField] = useState(facetFieldFilter?.field ?? "");
  const fieldValueOptions = pendingField
    ? computeFieldValueFrequency(fieldFilterPool, pendingField)
    : [];

  return (
    <div className="border-b border-line bg-panel">
      <div className="px-5 py-3 flex flex-wrap items-center gap-3">
        <div className="relative">
          <input
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            placeholder="Search title, tags, summary…"
            title="Fuzzy search — title matches outrank tag/summary matches"
            className="w-56 rounded-lg border border-line pl-3 pr-7 py-1.5 text-[13px] outline-none focus:border-accent"
          />
          {searchQuery !== "" && (
            <button
              onClick={() => setSearchQuery("")}
              className="absolute right-2 top-1/2 -translate-y-1/2 text-muted hover:text-ink"
              aria-label="Clear search"
            >
              ×
            </button>
          )}
        </div>

        {objectTypes.length > 0 && (
          <select
            value={typeFilter}
            onChange={(e) => setTypeFilter(e.target.value)}
            title="Filter by object type — separate from the text search above"
            className="rounded-lg border border-line px-2 py-1.5 text-[13px] bg-panel outline-none focus:border-accent"
          >
            <option value="">All types</option>
            {objectTypes.map(({ type, count }) => (
              <option key={type} value={type}>
                {type} ({count})
              </option>
            ))}
          </select>
        )}

        {facetColumns.length > 0 && (
          <>
            <div className="h-4 w-px bg-line" />
            <div className="flex items-center gap-1 text-[11px]">
              <select
                value={pendingField}
                onChange={(e) => {
                  const field = e.target.value;
                  setPendingField(field);
                  setFacetFieldFilter(null);
                }}
                title="Filter by an item-type field's value, e.g. Author or Genre"
                className="rounded-lg border border-line px-2 py-1 text-[12px] bg-panel outline-none focus:border-accent"
              >
                <option value="">Any field</option>
                {facetColumns.map((f) => (
                  <option key={f.name} value={f.name}>
                    {f.name}
                  </option>
                ))}
              </select>
              {pendingField && (
                <select
                  value={facetFieldFilter?.field === pendingField ? facetFieldFilter.value : ""}
                  onChange={(e) =>
                    setFacetFieldFilter(e.target.value ? { field: pendingField, value: e.target.value } : null)
                  }
                  className="rounded-lg border border-line px-2 py-1 text-[12px] bg-panel outline-none focus:border-accent"
                >
                  <option value="">Any value</option>
                  {fieldValueOptions.map(({ tag: value, count }) => (
                    <option key={value} value={value}>
                      {value} ({count})
                    </option>
                  ))}
                </select>
              )}
            </div>
          </>
        )}

        {topTags.length > 0 && (
          <>
            <div className="h-4 w-px bg-line" />

            <div className="flex items-center gap-1 text-[11px]">
              <span className="text-muted mr-0.5">Match</span>
              <div className="inline-flex rounded-lg border border-line overflow-hidden">
                {(["AND", "OR"] as const).map((m) => (
                  <button
                    key={m}
                    onClick={() => setFacetMode(m)}
                    className={[
                      "px-2 py-0.5",
                      facetMode === m ? "bg-ink text-white" : "bg-panel hover:bg-line/40",
                    ].join(" ")}
                    title={m === "AND" ? "Must have all selected tags" : "Match any selected tag"}
                  >
                    {m === "AND" ? "all" : "any"}
                  </button>
                ))}
              </div>
            </div>

            {(facetTags.length > 0 || excludedTags.length > 0) && (
              <button
                onClick={() => {
                  clearFacetTags();
                  clearExcludedTags();
                }}
                className="text-[11px] text-muted hover:text-ink underline decoration-dotted"
              >
                clear ({facetTags.length + excludedTags.length})
              </button>
            )}
          </>
        )}
      </div>

      {topTags.length > 0 &&
        (() => {
          // Active/excluded tags render outside the scrollable region,
          // pinned to the left — otherwise a selected tag can scroll
          // partway out of view (half-clipped at the edge, looking broken)
          // while browsing the rest of the row, with no indication it's
          // still applied.
          const activeTags = topTags.filter(({ tag }) => facetTags.includes(tag));
          const excludedChips = topTags.filter(({ tag }) => excludedTags.includes(tag));
          const inactiveTags = topTags.filter(
            ({ tag }) => !facetTags.includes(tag) && !excludedTags.includes(tag)
          );

          function renderChip({ tag, count }: TagFrequency) {
            const active = facetTags.includes(tag);
            const excluded = excludedTags.includes(tag);
            const group = tagGroups[norm(tag)];
            const color = group ? colorForGroup(group) : null;
            return (
              <button
                key={tag}
                onClick={(e) => (e.altKey ? toggleExcludeTag(tag) : toggleFacetTag(tag))}
                className="tag-chip gap-1 shrink-0"
                style={
                  excluded
                    ? {
                        backgroundColor: "rgba(220, 38, 38, 0.08)",
                        borderColor: "rgba(220, 38, 38, 0.3)",
                        color: "#dc2626",
                        textDecoration: "line-through",
                      }
                    : active
                    ? color
                      ? { backgroundColor: color.bg, borderColor: color.border, color: color.text }
                      : {
                          backgroundColor: "rgba(106, 92, 255, 0.1)",
                          borderColor: "rgba(106, 92, 255, 0.3)",
                          color: "#6a5cff",
                        }
                    : undefined
                }
                title={
                  (group ? `${tag} · ${group} — ` : `${tag} — `) +
                  "click to filter, option/alt-click to exclude"
                }
              >
                {tag}
                <span className={active || excluded ? "opacity-60" : "text-muted"}>{count}</span>
              </button>
            );
          }

          return (
            <div className="px-5 pb-3 flex items-center gap-1.5">
              {(activeTags.length > 0 || excludedChips.length > 0) && (
                <div className="flex items-center gap-1.5 shrink-0">
                  {activeTags.map(renderChip)}
                  {excludedChips.map(renderChip)}
                </div>
              )}
              {(activeTags.length > 0 || excludedChips.length > 0) && inactiveTags.length > 0 && (
                <div className="h-4 w-px bg-line shrink-0" />
              )}
              {inactiveTags.length > 0 && (
                <div className="flex items-center gap-1.5 overflow-x-auto whitespace-nowrap min-w-0">
                  {inactiveTags.map(renderChip)}
                </div>
              )}
            </div>
          );
        })()}
    </div>
  );
}
