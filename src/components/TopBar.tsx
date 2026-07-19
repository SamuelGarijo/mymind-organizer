import { useEffect, useRef, useState } from "react";
import { AnimatePresence, motion } from "motion/react";
import { useStore } from "../store";
import { MOTION, surfaceVariants } from "../lib/chrome";
import { useShallow } from "zustand/react/shallow";
import {
  computeFieldValueFrequency,
  searchTags,
  type TagFrequency,
  type TypeFrequency,
} from "../lib/quickFilter";
import { norm } from "../lib/ruleEngine";
import { colorForGroup } from "../lib/tagGroupColor";
import { TOLERANCE_MAX, TOLERANCE_MIN, type ColorFilter } from "../lib/colorSearch";
import { ITEM_TYPE_GROUP, rankableFacetColumns } from "../lib/grouping";
import type { DesignObject, FacetField } from "../types";

type Category = "tag" | "type" | "role" | "field" | "color" | "group";

/** One active filter, regardless of which underlying store slice it comes
 * from — every condition reads as one combinable list ("Type: Article",
 * "NOT: agua", "Genre: Environmental") instead of living in 4 separate,
 * disconnected controls (issue #120). */
type Pill = { key: string; label: string; tone: "include" | "exclude"; onRemove: () => void };

/** The φφφ sliders glyph from Samuel's sketch — the filter summon. */
function FilterIcon({ active }: { active: boolean }) {
  return (
    <svg viewBox="0 0 16 16" width="15" height="15" fill="none" className="shrink-0">
      {[
        { y: 3.5, knob: 10.5 },
        { y: 8, knob: 5.5 },
        { y: 12.5, knob: 11.5 },
      ].map(({ y, knob }) => (
        <g key={y}>
          <line x1="1.5" y1={y} x2="14.5" y2={y} stroke="currentColor" strokeWidth="1.2" />
          <circle
            cx={knob}
            cy={y}
            r="2.2"
            fill={active ? "currentColor" : "#ffffff"}
            stroke="currentColor"
            strokeWidth="1.2"
          />
        </g>
      ))}
    </svg>
  );
}

/**
 * The single resident band (design-philosophy N1): an are.na-style
 * breadcrumb line — `Organizer / <view> · count` on the left, then search
 * and the filter summon on the right. Everything else that used to stack
 * here (tag wall, curated piles, primary facets, hero) either became
 * content that scrolls with the grid (CollectionLedger) or lives behind
 * the filter popover.
 *
 * A second row exists ONLY while filters are active (summoned by state,
 * recedes with it — N5): the active-filter pills, match mode, clear-all.
 */
export function TopBar({
  title,
  count,
  isCollection,
  boardOpen,
  onClassifyClick,
  topTags,
  objectTypes,
  roleTypes,
  facetColumns,
  fieldFilterPool,
  colorFilter,
  setColorFilter,
}: {
  title: string;
  count: number;
  /** Collection views get the ✦ Classify affordance — it must stay reachable
   * even once the ledger has scrolled away, so it lives here, not there. */
  isCollection: boolean;
  boardOpen: boolean;
  onClassifyClick: () => void;
  /** Empty-query suggestions inside the popover's Tag category — the old
   * resident tag wall, demoted to summoned (choreography, not subtraction). */
  topTags: TagFrequency[];
  objectTypes: TypeFrequency[];
  roleTypes: TypeFrequency[];
  facetColumns: FacetField[];
  fieldFilterPool: DesignObject[];
  colorFilter: ColorFilter | null;
  setColorFilter: (filter: ColorFilter | null) => void;
}) {
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
    groupBy,
    setGroupBy,
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
      groupBy: s.groupBy,
      setGroupBy: s.setGroupBy,
    }))
  );

  const [menuOpen, setMenuOpen] = useState(false);
  const [category, setCategory] = useState<Category>("tag");
  const [query, setQuery] = useState("");
  // Field category is a two-step pick (field, then value) — kept separate
  // from the committed store filter so choosing a field doesn't filter
  // anything until a value is also chosen.
  const [pendingField, setPendingField] = useState<string | null>(null);
  // Color category's own draft (issue #69) — dragging a picker/slider fires
  // many onChange events; only the committed store filter re-runs the
  // palette distance check over every object.
  const [pendingHex, setPendingHex] = useState(colorFilter?.hex ?? "#6a5cff");
  const [pendingTolerance, setPendingTolerance] = useState(colorFilter?.tolerance ?? 20);
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
  if (colorFilter) {
    pills.push({
      key: "color",
      label: `Color: ${colorFilter.hex} (±${colorFilter.tolerance})`,
      tone: "include",
      onRemove: () => setColorFilter(null),
    });
  }
  if (groupBy) {
    pills.push({
      key: "group",
      label: `Group: ${groupBy === ITEM_TYPE_GROUP ? "Item type" : groupBy}`,
      tone: "include",
      onRemove: () => setGroupBy(null),
    });
  }

  const hasAnyFilter = pills.length > 0;
  const groupableColumns = rankableFacetColumns(fieldFilterPool, facetColumns);
  const hasRoles = fieldFilterPool.some((o) => o.role);
  const fieldValueOptions = pendingField ? computeFieldValueFrequency(fieldFilterPool, pendingField) : [];
  const tagResults = category === "tag" ? searchTags(fieldFilterPool, query) : [];
  // Empty query → the view's top tags as suggestions, so the tag universe
  // stays discoverable without a resident wall of chips.
  const tagSuggestions = topTags.filter(
    ({ tag }) => !facetTags.includes(tag) && !excludedTags.includes(tag)
  );
  const tagList = query === "" ? tagSuggestions.slice(0, 24) : tagResults;

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
    <div className="shrink-0">
      {/* No band, no border — breadcrumb sits directly on the canvas and the
          controls float as pills (the "breathing" register: elements, not
          sections). */}
      <div className="px-5 pt-3.5 pb-1.5 flex items-center gap-3">
        <div className="flex items-baseline gap-2 min-w-0 font-mono">
          <span className="text-[13px] text-muted shrink-0">Organizer</span>
          <span className="text-[13px] text-muted/60 shrink-0">/</span>
          <h1 className="text-[13px] font-bold truncate">{title}</h1>
          <span className="text-[11px] text-muted shrink-0">{count.toLocaleString()}</span>
        </div>

        <div className="flex-1" />

        <div className="relative shrink-0">
          <input
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            placeholder="Search…"
            title="Fuzzy search — title matches outrank tag/summary matches"
            className="w-72 focus:w-[26rem] transition-[width,box-shadow] duration-200 rounded-full border border-line/60 bg-panel shadow-card pl-4 pr-8 py-2 text-[13px] font-mono outline-none focus:border-accent/40 focus:shadow-cardHover"
          />
          {searchQuery !== "" && (
            <button
              onClick={() => setSearchQuery("")}
              className="absolute right-3 top-1/2 -translate-y-1/2 text-muted hover:text-ink"
              aria-label="Clear search"
            >
              ×
            </button>
          )}
        </div>

        <div className="relative shrink-0" ref={menuRef}>
          <button
            onClick={() => setMenuOpen((v) => !v)}
            className={[
              "w-9 h-9 flex items-center justify-center rounded-full border bg-panel shadow-card transition-[box-shadow,color,border-color] hover:shadow-cardHover",
              hasAnyFilter || menuOpen
                ? "border-accent/50 text-accent"
                : "border-line/60 text-muted hover:text-ink",
            ].join(" ")}
            title="Filter — tags, types, fields, color, grouping"
            aria-label="Filter"
          >
            <FilterIcon active={hasAnyFilter} />
          </button>
          <AnimatePresence>
          {menuOpen && (
            <motion.div
              custom={{ x: 0, y: -8 }}
              variants={surfaceVariants}
              initial="hidden"
              animate="visible"
              exit="exit"
              className="absolute z-40 top-full mt-2 right-0 w-80 rounded-2xl border border-line/70 bg-panel/95 backdrop-blur shadow-cardHover overflow-hidden">
              <div className="px-3 pt-3 pb-2 flex items-center gap-1 flex-wrap font-mono">
                {(
                  [
                    ["tag", "Tag"],
                    ["type", "Type"],
                    ["role", "Item type"],
                    ["field", "Field"],
                    ["color", "Color"],
                    ["group", "Group"],
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
                      "tag-chip shrink-0",
                      category === c ? "border-accent/40 bg-accent/5 text-ink" : "",
                    ].join(" ")}
                  >
                    {label}
                  </button>
                ))}
              </div>

              {category === "tag" && (
                <div className="px-3 pb-3">
                  <input
                    autoFocus
                    value={query}
                    onChange={(e) => setQuery(e.target.value)}
                    placeholder="Search any tag…"
                    className="w-full rounded-lg border border-line/70 bg-canvas/50 px-2.5 py-1.5 font-mono text-[12px] outline-none focus:border-accent/40 focus:bg-panel mb-1.5"
                  />
                  <div className="max-h-56 overflow-y-auto flex flex-col gap-0.5">
                    {tagList.map(({ tag, count: tagCount }) => (
                      <div
                        key={tag}
                        className="group/tagrow flex items-center justify-between gap-1 pl-2 pr-1 py-1 rounded-lg hover:bg-line/30"
                      >
                        <span className="font-mono text-[12px] truncate text-ink/85">
                          {tag} <span className="text-muted/60">{tagCount}</span>
                        </span>
                        <div className="flex gap-0.5 shrink-0 opacity-0 group-hover/tagrow:opacity-100 transition-opacity">
                          <button
                            onClick={() => {
                              toggleFacetTag(tag);
                              closeMenu();
                            }}
                            className="w-6 h-6 rounded-md font-mono text-[13px] text-muted hover:text-accent hover:bg-accent/10"
                            title="Include this tag"
                          >
                            +
                          </button>
                          <button
                            onClick={() => {
                              toggleExcludeTag(tag);
                              closeMenu();
                            }}
                            className="w-6 h-6 rounded-md font-mono text-[13px] text-muted hover:text-red-600 hover:bg-red-50"
                            title="Exclude this tag"
                          >
                            −
                          </button>
                        </div>
                      </div>
                    ))}
                  </div>
                </div>
              )}

              {category === "type" && (
                <div className="max-h-56 overflow-y-auto px-2 pb-2.5">
                  {objectTypes
                    .filter(({ type }) => norm(type).includes(norm(query)))
                    .map(({ type, count: typeCount }) => (
                      <button
                        key={type}
                        onClick={() => {
                          setTypeFilter(type);
                          closeMenu();
                        }}
                        className="w-full text-left px-2.5 py-1 rounded-lg font-mono text-[12px] text-ink/85 hover:bg-line/30"
                      >
                        {type} <span className="text-muted">{typeCount}</span>
                      </button>
                    ))}
                </div>
              )}

              {category === "role" && (
                <div className="max-h-56 overflow-y-auto px-2 pb-2.5">
                  {roleTypes
                    .filter(({ type }) => norm(type).includes(norm(query)))
                    .map(({ type, count: roleCount }) => (
                      <button
                        key={type}
                        onClick={() => {
                          setRoleFilter(type);
                          closeMenu();
                        }}
                        className="w-full text-left px-2.5 py-1 rounded-lg font-mono text-[12px] text-ink/85 hover:bg-line/30"
                      >
                        {type} <span className="text-muted">{roleCount}</span>
                      </button>
                    ))}
                </div>
              )}

              {category === "field" &&
                (!pendingField ? (
                  <div className="max-h-56 overflow-y-auto px-2 pb-2.5">
                    {facetColumns.map((f) => (
                      <button
                        key={f.name}
                        onClick={() => setPendingField(f.name)}
                        className="w-full text-left px-2.5 py-1 rounded-lg font-mono text-[12px] text-ink/85 hover:bg-line/30"
                      >
                        {f.name}
                      </button>
                    ))}
                  </div>
                ) : (
                  <div className="px-2 pb-2.5">
                    <button
                      onClick={() => setPendingField(null)}
                      className="font-mono text-[11px] text-muted hover:text-ink px-1 py-0.5"
                    >
                      ← {pendingField}
                    </button>
                    <div className="max-h-48 overflow-y-auto">
                      {fieldValueOptions.map(({ tag: value, count: valueCount }) => (
                        <button
                          key={value}
                          onClick={() => {
                            setFacetFieldFilter({ field: pendingField, value });
                            closeMenu();
                          }}
                          className="w-full text-left px-2.5 py-1 rounded-lg font-mono text-[12px] text-ink/85 hover:bg-line/30"
                        >
                          {value} <span className="text-muted">{valueCount}</span>
                        </button>
                      ))}
                    </div>
                  </div>
                ))}

              {category === "group" && (
                <div className="max-h-56 overflow-y-auto px-2 pb-2.5">
                  <button
                    onClick={() => {
                      setGroupBy(null);
                      closeMenu();
                    }}
                    className={[
                      "w-full text-left px-2.5 py-1 rounded-lg font-mono text-[12px] text-ink/85 hover:bg-line/30",
                      groupBy === null ? "text-accent" : "",
                    ].join(" ")}
                  >
                    None
                  </button>
                  {hasRoles && (
                    <button
                      onClick={() => {
                        setGroupBy(ITEM_TYPE_GROUP);
                        closeMenu();
                      }}
                      className={[
                        "w-full text-left px-2.5 py-1 rounded-lg font-mono text-[12px] text-ink/85 hover:bg-line/30",
                        groupBy === ITEM_TYPE_GROUP ? "text-accent" : "",
                      ].join(" ")}
                    >
                      Item type
                    </button>
                  )}
                  {groupableColumns.map((f) => (
                    <button
                      key={f.name}
                      onClick={() => {
                        setGroupBy(f.name);
                        closeMenu();
                      }}
                      className={[
                        "w-full text-left px-2.5 py-1 rounded-lg font-mono text-[12px] text-ink/85 hover:bg-line/30",
                        groupBy === f.name ? "text-accent" : "",
                      ].join(" ")}
                    >
                      {f.name}
                    </button>
                  ))}
                </div>
              )}

              {category === "color" && (
                <div className="px-3 pb-3 flex flex-col gap-2">
                  <div className="flex items-center gap-2">
                    <input
                      type="color"
                      value={pendingHex}
                      onChange={(e) => setPendingHex(e.target.value)}
                      className="w-9 h-9 rounded border border-line cursor-pointer shrink-0"
                      title="Target color — matched against mymind's own per-image palette, not a local color analysis"
                    />
                    <span className="text-[12px] text-muted uppercase">{pendingHex}</span>
                  </div>
                  <label className="text-[11px] text-muted flex flex-col gap-1">
                    Tolerance ({pendingTolerance})
                    <input
                      type="range"
                      min={TOLERANCE_MIN}
                      max={TOLERANCE_MAX}
                      value={pendingTolerance}
                      onChange={(e) => setPendingTolerance(Number(e.target.value))}
                    />
                  </label>
                  <div className="flex gap-1.5">
                    <button
                      onClick={() => {
                        setColorFilter({ hex: pendingHex, tolerance: pendingTolerance });
                        closeMenu();
                      }}
                      className="flex-1 rounded-lg border border-line px-2 py-1 text-[12px] bg-ink text-white hover:opacity-90"
                    >
                      Apply
                    </button>
                    {colorFilter && (
                      <button
                        onClick={() => {
                          setColorFilter(null);
                          closeMenu();
                        }}
                        className="text-[12px] text-muted hover:text-ink px-2"
                      >
                        Clear
                      </button>
                    )}
                  </div>
                </div>
              )}
            </motion.div>
          )}
          </AnimatePresence>
        </div>

        {isCollection && (
          <button
            onClick={onClassifyClick}
            className={[
              "shrink-0 font-mono text-[12px] px-3.5 py-2 rounded-full border bg-panel shadow-card transition-[box-shadow,color,border-color] hover:shadow-cardHover",
              boardOpen
                ? "border-accent/50 text-ink"
                : "border-line/60 text-muted hover:text-ink",
            ].join(" ")}
            title="Open this collection's folders — sets up a type and starter facets automatically if none exist yet"
          >
            {boardOpen ? "✦ Classifying" : "✦ Classify"}
          </button>
        )}
      </div>

      {/* Summoned by state, recedes with it — exists only while filtering. */}
      <AnimatePresence initial={false}>
      {hasAnyFilter && (
        <motion.div
          initial={{ height: 0, opacity: 0 }}
          animate={{ height: "auto", opacity: 1, transition: { duration: MOTION.reveal, ease: MOTION.easeOut } }}
          exit={{ height: 0, opacity: 0, transition: { duration: MOTION.micro, ease: MOTION.easeIn } }}
          className="overflow-hidden"
        >
        <div className="px-5 pb-1.5 flex flex-wrap items-center gap-2">
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

          <button
            onClick={() => {
              setTypeFilter("");
              setRoleFilter("");
              setFacetFieldFilter(null);
              clearFacetTags();
              clearExcludedTags();
              setColorFilter(null);
              setGroupBy(null);
            }}
            className="text-[11px] text-muted hover:text-ink underline decoration-dotted"
          >
            clear all
          </button>
        </div>
        </motion.div>
      )}
      </AnimatePresence>
    </div>
  );
}
