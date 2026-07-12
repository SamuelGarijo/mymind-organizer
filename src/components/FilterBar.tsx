import { useEffect, useRef, useState } from "react";
import { useStore } from "../store";
import { useShallow } from "zustand/react/shallow";
import {
  computeFieldValueFrequency,
  searchTags,
  type TagFrequency,
  type TypeFrequency,
} from "../lib/quickFilter";
import { norm } from "../lib/ruleEngine";
import { colorForGroup } from "../lib/tagGroupColor";
import type { DesignObject, FacetField } from "../types";

type Category = "tag" | "type" | "role" | "field";

/** One active filter, regardless of which underlying store slice it comes
 * from — the whole point of this redesign (issue #120) is that every
 * condition reads as one combinable list ("Type: Article", "NOT: agua",
 * "Genre: Environmental") instead of living in 4 separate, disconnected
 * controls the way it did before. */
type Pill = { key: string; label: string; tone: "include" | "exclude"; onRemove: () => void };

export function FilterBar({
  topTags,
  objectTypes,
  roleTypes,
  facetColumns,
  fieldFilterPool,
}: {
  topTags: TagFrequency[];
  objectTypes: TypeFrequency[];
  roleTypes: TypeFrequency[];
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
    roleFilter,
    tagGroups,
    setSearchQuery,
    toggleFacetTag,
    setFacetMode,
    clearFacetTags,
    toggleExcludeTag,
    clearExcludedTags,
    setFacetFieldFilter,
    setTypeFilter,
    setRoleFilter,
  } = useStore(
    useShallow((s) => ({
      searchQuery: s.searchQuery,
      facetTags: s.facetTags,
      facetMode: s.facetMode,
      excludedTags: s.excludedTags,
      facetFieldFilter: s.facetFieldFilter,
      typeFilter: s.typeFilter,
      roleFilter: s.roleFilter,
      tagGroups: s.tagGroups,
      setSearchQuery: s.setSearchQuery,
      toggleFacetTag: s.toggleFacetTag,
      setFacetMode: s.setFacetMode,
      clearFacetTags: s.clearFacetTags,
      toggleExcludeTag: s.toggleExcludeTag,
      clearExcludedTags: s.clearExcludedTags,
      setFacetFieldFilter: s.setFacetFieldFilter,
      setTypeFilter: s.setTypeFilter,
      setRoleFilter: s.setRoleFilter,
    }))
  );

  const [menuOpen, setMenuOpen] = useState(false);
  const [category, setCategory] = useState<Category>("tag");
  const [query, setQuery] = useState("");
  // Field category is a two-step pick (field, then value) — kept separate
  // from the committed store filter so choosing a field doesn't filter
  // anything until a value is also chosen.
  const [pendingField, setPendingField] = useState<string | null>(null);
  const menuRef = useRef<HTMLDivElement>(null);

  function closeMenu() {
    setMenuOpen(false);
    setQuery("");
    setPendingField(null);
  }

  useEffect(() => {
    if (!menuOpen) return;
    function handleClick(e: MouseEvent) {
      if (menuRef.current && !menuRef.current.contains(e.target as Node)) closeMenu();
    }
    function handleKey(e: KeyboardEvent) {
      if (e.key === "Escape") closeMenu();
    }
    document.addEventListener("mousedown", handleClick);
    document.addEventListener("keydown", handleKey);
    return () => {
      document.removeEventListener("mousedown", handleClick);
      document.removeEventListener("keydown", handleKey);
    };
  }, [menuOpen]);

  const pills: Pill[] = [];
  if (typeFilter) {
    pills.push({
      key: "type",
      label: `Type: ${typeFilter}`,
      tone: "include",
      onRemove: () => setTypeFilter(""),
    });
  }
  if (roleFilter) {
    pills.push({
      key: "role",
      label: `Item type: ${roleFilter}`,
      tone: "include",
      onRemove: () => setRoleFilter(""),
    });
  }
  if (facetFieldFilter) {
    pills.push({
      key: "field",
      label: `${facetFieldFilter.field}: ${facetFieldFilter.value}`,
      tone: "include",
      onRemove: () => setFacetFieldFilter(null),
    });
  }
  for (const tag of facetTags) {
    pills.push({ key: `tag:${tag}`, label: tag, tone: "include", onRemove: () => toggleFacetTag(tag) });
  }
  for (const tag of excludedTags) {
    pills.push({
      key: `exclude:${tag}`,
      label: `NOT: ${tag}`,
      tone: "exclude",
      onRemove: () => toggleExcludeTag(tag),
    });
  }

  const hasAnyFilter = pills.length > 0;
  const inactiveSuggestions = topTags.filter(
    ({ tag }) => !facetTags.includes(tag) && !excludedTags.includes(tag)
  );
  const fieldValueOptions = pendingField ? computeFieldValueFrequency(fieldFilterPool, pendingField) : [];
  const tagResults = category === "tag" ? searchTags(fieldFilterPool, query) : [];

  function renderPill({ key, label, tone, onRemove }: Pill) {
    const group = tone === "include" ? tagGroups[norm(label)] : undefined;
    const color = group ? colorForGroup(group) : null;
    return (
      <span
        key={key}
        className="tag-chip gap-1"
        style={
          tone === "exclude"
            ? {
                backgroundColor: "rgba(220, 38, 38, 0.08)",
                borderColor: "rgba(220, 38, 38, 0.3)",
                color: "#dc2626",
              }
            : color
            ? { backgroundColor: color.bg, borderColor: color.border, color: color.text }
            : {
                backgroundColor: "rgba(106, 92, 255, 0.1)",
                borderColor: "rgba(106, 92, 255, 0.3)",
                color: "#6a5cff",
              }
        }
      >
        {label}
        <button onClick={onRemove} className="opacity-60 hover:opacity-100" aria-label={`Remove filter: ${label}`}>
          ×
        </button>
      </span>
    );
  }

  return (
    <div className="border-b border-line bg-panel">
      <div className="px-5 py-3 flex flex-wrap items-center gap-2">
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

        <div className="relative" ref={menuRef}>
          <button
            onClick={() => setMenuOpen((v) => !v)}
            className="rounded-lg border border-line px-2.5 py-1.5 text-[13px] bg-panel hover:bg-line/40"
          >
            + Filter
          </button>
          {menuOpen && (
            <div className="absolute z-20 top-full mt-1 left-0 w-64 rounded-lg border border-line bg-panel shadow-lg overflow-hidden">
              <div className="flex border-b border-line text-[11px]">
                {(
                  [
                    ["tag", "Tag"],
                    ["type", "Type"],
                    ["role", "Item type"],
                    ["field", "Field"],
                  ] as const
                ).map(([c, label]) => (
                  <button
                    key={c}
                    onClick={() => {
                      setCategory(c);
                      setQuery("");
                      setPendingField(null);
                    }}
                    className={[
                      "flex-1 px-2 py-1.5",
                      category === c ? "bg-ink text-white" : "hover:bg-line/40",
                    ].join(" ")}
                  >
                    {label}
                  </button>
                ))}
              </div>

              {category === "tag" && (
                <div className="p-2">
                  <input
                    autoFocus
                    value={query}
                    onChange={(e) => setQuery(e.target.value)}
                    placeholder="Search any tag…"
                    className="w-full rounded-lg border border-line px-2 py-1 text-[12px] outline-none focus:border-accent mb-1.5"
                  />
                  <div className="max-h-48 overflow-y-auto flex flex-col gap-0.5">
                    {query === "" && (
                      <p className="text-[11px] text-muted px-1 py-1">Type to search every tag in this view.</p>
                    )}
                    {tagResults.map(({ tag, count }) => (
                      <div key={tag} className="flex items-center justify-between gap-1 px-1 py-0.5 rounded hover:bg-line/40">
                        <span className="text-[12px] truncate">
                          {tag} <span className="text-muted">{count}</span>
                        </span>
                        <div className="flex gap-1 shrink-0">
                          <button
                            onClick={() => {
                              toggleFacetTag(tag);
                              closeMenu();
                            }}
                            className="text-[11px] text-accent hover:underline"
                            title="Include this tag"
                          >
                            include
                          </button>
                          <button
                            onClick={() => {
                              toggleExcludeTag(tag);
                              closeMenu();
                            }}
                            className="text-[11px] text-red-600 hover:underline"
                            title="Exclude this tag"
                          >
                            exclude
                          </button>
                        </div>
                      </div>
                    ))}
                  </div>
                </div>
              )}

              {category === "type" && (
                <div className="max-h-56 overflow-y-auto p-1">
                  {objectTypes
                    .filter(({ type }) => norm(type).includes(norm(query)))
                    .map(({ type, count }) => (
                      <button
                        key={type}
                        onClick={() => {
                          setTypeFilter(type);
                          closeMenu();
                        }}
                        className="w-full text-left px-2 py-1 rounded text-[12px] hover:bg-line/40"
                      >
                        {type} <span className="text-muted">{count}</span>
                      </button>
                    ))}
                </div>
              )}

              {category === "role" && (
                <div className="max-h-56 overflow-y-auto p-1">
                  {roleTypes
                    .filter(({ type }) => norm(type).includes(norm(query)))
                    .map(({ type, count }) => (
                      <button
                        key={type}
                        onClick={() => {
                          setRoleFilter(type);
                          closeMenu();
                        }}
                        className="w-full text-left px-2 py-1 rounded text-[12px] hover:bg-line/40"
                      >
                        {type} <span className="text-muted">{count}</span>
                      </button>
                    ))}
                </div>
              )}

              {category === "field" &&
                (!pendingField ? (
                  <div className="max-h-56 overflow-y-auto p-1">
                    {facetColumns.map((f) => (
                      <button
                        key={f.name}
                        onClick={() => setPendingField(f.name)}
                        className="w-full text-left px-2 py-1 rounded text-[12px] hover:bg-line/40"
                      >
                        {f.name}
                      </button>
                    ))}
                  </div>
                ) : (
                  <div className="p-1">
                    <button
                      onClick={() => setPendingField(null)}
                      className="text-[11px] text-muted hover:text-ink px-1 py-0.5"
                    >
                      ← {pendingField}
                    </button>
                    <div className="max-h-48 overflow-y-auto">
                      {fieldValueOptions.map(({ tag: value, count }) => (
                        <button
                          key={value}
                          onClick={() => {
                            setFacetFieldFilter({ field: pendingField, value });
                            closeMenu();
                          }}
                          className="w-full text-left px-2 py-1 rounded text-[12px] hover:bg-line/40"
                        >
                          {value} <span className="text-muted">{count}</span>
                        </button>
                      ))}
                    </div>
                  </div>
                ))}
            </div>
          )}
        </div>

        {pills.map(renderPill)}

        {facetTags.length > 1 && (
          <div className="flex items-center gap-1 text-[11px]">
            <span className="text-muted">Match</span>
            <div className="inline-flex rounded-lg border border-line overflow-hidden">
              {(["AND", "OR"] as const).map((m) => (
                <button
                  key={m}
                  onClick={() => setFacetMode(m)}
                  className={[
                    "px-2 py-0.5",
                    facetMode === m ? "bg-ink text-white" : "bg-panel hover:bg-line/40",
                  ].join(" ")}
                  title={m === "AND" ? "Must have all included tags" : "Match any included tag"}
                >
                  {m === "AND" ? "all" : "any"}
                </button>
              ))}
            </div>
          </div>
        )}

        {hasAnyFilter && (
          <button
            onClick={() => {
              setTypeFilter("");
              setRoleFilter("");
              setFacetFieldFilter(null);
              clearFacetTags();
              clearExcludedTags();
            }}
            className="text-[11px] text-muted hover:text-ink underline decoration-dotted"
          >
            clear all
          </button>
        )}
      </div>

      {inactiveSuggestions.length > 0 && (
        <div className="px-5 pb-3 flex items-center gap-1.5 overflow-x-auto whitespace-nowrap">
          {inactiveSuggestions.map(({ tag, count }) => {
            const group = tagGroups[norm(tag)];
            const color = group ? colorForGroup(group) : null;
            return (
              <button
                key={tag}
                onClick={(e) => (e.altKey ? toggleExcludeTag(tag) : toggleFacetTag(tag))}
                className="tag-chip gap-1 shrink-0"
                style={color ? { borderColor: color.border } : undefined}
                title={
                  (group ? `${tag} · ${group} — ` : `${tag} — `) +
                  "click to filter, option/alt-click to exclude"
                }
              >
                {tag}
                <span className="text-muted">{count}</span>
              </button>
            );
          })}
        </div>
      )}
    </div>
  );
}
