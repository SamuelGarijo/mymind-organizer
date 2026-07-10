import { useStore } from "../store";
import { useShallow } from "zustand/react/shallow";
import type { TagFrequency, TypeFrequency } from "../lib/quickFilter";
import { norm } from "../lib/ruleEngine";
import { colorForGroup } from "../lib/tagGroupColor";

export function FilterBar({
  topTags,
  objectTypes,
}: {
  topTags: TagFrequency[];
  objectTypes: TypeFrequency[];
}) {
  // Shallow-selected — this bar legitimately re-renders on every keystroke
  // (it's the input itself), but a bare useStore() also re-rendered it on
  // every unrelated store change (syncs, tag edits, opening a detail panel),
  // which this avoids.
  const {
    searchQuery,
    facetTags,
    facetMode,
    typeFilter,
    tagGroups,
    setSearchQuery,
    toggleFacetTag,
    setFacetMode,
    clearFacetTags,
    setTypeFilter,
  } = useStore(
    useShallow((s) => ({
      searchQuery: s.searchQuery,
      facetTags: s.facetTags,
      facetMode: s.facetMode,
      typeFilter: s.typeFilter,
      tagGroups: s.tagGroups,
      setSearchQuery: s.setSearchQuery,
      toggleFacetTag: s.toggleFacetTag,
      setFacetMode: s.setFacetMode,
      clearFacetTags: s.clearFacetTags,
      setTypeFilter: s.setTypeFilter,
    }))
  );

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

            {facetTags.length > 0 && (
              <button
                onClick={clearFacetTags}
                className="text-[11px] text-muted hover:text-ink underline decoration-dotted"
              >
                clear ({facetTags.length})
              </button>
            )}
          </>
        )}
      </div>

      {topTags.length > 0 &&
        (() => {
          // Active tags render outside the scrollable region, pinned to the
          // left — otherwise a selected tag can scroll partway out of view
          // (half-clipped at the edge, looking broken) while browsing the
          // rest of the row, with no indication it's still applied.
          const activeTags = topTags.filter(({ tag }) => facetTags.includes(tag));
          const inactiveTags = topTags.filter(({ tag }) => !facetTags.includes(tag));

          function renderChip({ tag, count }: TagFrequency) {
            const active = facetTags.includes(tag);
            const group = tagGroups[norm(tag)];
            const color = group ? colorForGroup(group) : null;
            return (
              <button
                key={tag}
                onClick={() => toggleFacetTag(tag)}
                className="tag-chip gap-1 shrink-0"
                style={
                  active
                    ? color
                      ? { backgroundColor: color.bg, borderColor: color.border, color: color.text }
                      : {
                          backgroundColor: "rgba(106, 92, 255, 0.1)",
                          borderColor: "rgba(106, 92, 255, 0.3)",
                          color: "#6a5cff",
                        }
                    : undefined
                }
                title={group ? `${tag} · ${group}` : tag}
              >
                {tag}
                <span className={active ? "opacity-60" : "text-muted"}>{count}</span>
              </button>
            );
          }

          return (
            <div className="px-5 pb-3 flex items-center gap-1.5">
              {activeTags.length > 0 && (
                <div className="flex items-center gap-1.5 shrink-0">
                  {activeTags.map(renderChip)}
                </div>
              )}
              {activeTags.length > 0 && inactiveTags.length > 0 && (
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
