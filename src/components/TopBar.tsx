import { useEffect, useRef, useState } from "react";
import { AnimatePresence, motion } from "motion/react";
import { MagnifyingGlass, SlidersHorizontal } from "@phosphor-icons/react";
import { useStore } from "../store";
import { surfaceVariants } from "../lib/chrome";
import { useShallow } from "zustand/react/shallow";
import {
  computeFieldValueFrequency,
  searchTags,
  UNCLASSIFIED_VALUE,
  type TagFrequency,
  type TypeFrequency,
} from "../lib/quickFilter";
import { norm } from "../lib/ruleEngine";
import { colorForGroup } from "../lib/tagGroupColor";
import { TOLERANCE_MAX, TOLERANCE_MIN, type ColorFilter } from "../lib/colorSearch";
import { ITEM_TYPE_GROUP, rankableFacetColumns } from "../lib/grouping";
import { makeId } from "../lib/id";
import { roleWord } from "./CollectionLedger";
import type { DesignObject, FacetField, FilterCondition } from "../types";

type Category = "tag" | "type" | "role" | "field" | "color" | "group";

/** One active filter, regardless of which underlying store slice it comes
 * from — every condition reads as one combinable list ("Type: Article",
 * "NOT: agua", "Genre: Environmental") instead of living in 4 separate,
 * disconnected controls (issue #120). */
type Pill = { key: string; label: string; tone: "include" | "exclude"; onRemove: () => void };

/** The φφφ sliders from Samuel's sketch — Phosphor's own glyph for it. */
function FilterIcon({ active }: { active: boolean }) {
  return <SlidersHorizontal size={16} weight={active ? "fill" : "regular"} />;
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
  topTags,
  objectTypes,
  roleTypes,
  facetColumns,
  fieldFilterPool,
  colorFilter,
  setColorFilter,
}: {
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
    collections,
    collectionOrder,
    setSelectedView,
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
      collections: s.collections,
      collectionOrder: s.collectionOrder,
      setSelectedView: s.setSelectedView,
    }))
  );

  const [menuOpen, setMenuOpen] = useState(false);
  const [suggestOpen, setSuggestOpen] = useState(false);
  // §7 (2026-07-21): the overflow surface for active filters — pills live
  // INSIDE the command bar's single row; past the first few, "More" reveals
  // the complete active query plus match mode / clear / save-as-collection.
  const [moreOpen, setMoreOpen] = useState(false);
  // Deliberate downward scrolling compacts the bar (diving into the
  // things); any upward intent restores it. Focus always wins.
  const [compact, setCompact] = useState(false);
  const wheelAccum = useRef(0);
  useEffect(() => {
    function onWheel(e: WheelEvent) {
      if ((e.target as HTMLElement | null)?.closest?.("[data-command-bar]")) return;
      if (e.deltaY > 0) {
        wheelAccum.current += e.deltaY;
        if (wheelAccum.current > 80) setCompact(true);
      } else if (e.deltaY < 0) {
        wheelAccum.current = 0;
        setCompact(false);
      }
    }
    document.addEventListener("wheel", onWheel, { passive: true });
    return () => document.removeEventListener("wheel", onWheel);
  }, []);
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
    setSuggestOpen(false);
    setMoreOpen(false);
    setQuery("");
    setPendingField(null);
  }

  useEffect(() => {
    if (!menuOpen && !suggestOpen && !moreOpen) return;
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
  }, [menuOpen, suggestOpen, moreOpen]);

  const pills: Pill[] = [];
  if (typeFilter) {
    pills.push({
      key: "type",
      label: `Format: ${typeFilter}`,
      tone: "include",
      onRemove: () => setTypeFilter(""),
    });
  }
  if (roleFilter) {
    pills.push({
      key: "role",
      // Plain words, matching the ledger's "Here you can find" (2026-07-21)
      // — the chip reads "only typographies", never a schema noun.
      label: `only ${roleWord(roleFilter)}`,
      tone: "include",
      onRemove: () => setRoleFilter(""),
    });
  }
  if (facetFieldFilter) {
    pills.push({
      key: "field",
      label:
        facetFieldFilter.value === UNCLASSIFIED_VALUE
          ? `${facetFieldFilter.field}: not yet classified`
          : `${facetFieldFilter.field}: ${facetFieldFilter.value}`,
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
      label: `Group: ${groupBy === ITEM_TYPE_GROUP ? "Entity type" : groupBy}`,
      tone: "include",
      onRemove: () => setGroupBy(null),
    });
  }

  const hasAnyFilter = pills.length > 0;

  /** How many pills ride inline in the bar row before "More +N" takes over
   * — a fixed budget, not a measurement: the bar's structure must never
   * change shape as filters accumulate (§7). */
  const INLINE_PILLS = 3;

  // §7: any meaningful query+filter combination can be kept. Everything the
  // rule engine can express maps in; what it can't (colour, entity-type
  // filter, "not yet classified") simply isn't offered rather than saved
  // wrong.
  const savableAsCollection =
    (searchQuery.trim() !== "" ||
      facetTags.length > 0 ||
      excludedTags.length > 0 ||
      typeFilter !== "" ||
      (facetFieldFilter !== null && facetFieldFilter.value !== UNCLASSIFIED_VALUE));

  function saveAsSmartCollection() {
    const children: FilterCondition[] = [];
    if (searchQuery.trim() !== "") {
      children.push({ kind: "condition", id: makeId("cond"), field: "text", operator: "contains", value: searchQuery.trim() });
    }
    for (const tag of facetTags) {
      children.push({ kind: "condition", id: makeId("cond"), field: "tag", operator: "includes", value: tag });
    }
    for (const tag of excludedTags) {
      children.push({ kind: "condition", id: makeId("cond"), field: "tag", operator: "notEquals", value: tag });
    }
    if (typeFilter !== "") {
      children.push({ kind: "condition", id: makeId("cond"), field: "entity_type", operator: "equals", value: typeFilter });
    }
    if (facetFieldFilter && facetFieldFilter.value !== UNCLASSIFIED_VALUE) {
      children.push({ kind: "condition", id: makeId("cond"), field: facetFieldFilter.field, operator: "equals", value: facetFieldFilter.value });
    }
    if (children.length === 0) return;
    const name =
      searchQuery.trim() ||
      pills
        .slice(0, 2)
        .map((p) => p.label.split(": ").pop())
        .join(" · ") ||
      "Saved search";
    const st = useStore.getState();
    // Tag matching in saved rules is AND by construction (every condition
    // must pass) — matches the bar's "all" mode; "any" combinations keep
    // their live behavior in the bar but save as all-of.
    const id = st.addSmartCollection(name, {
      kind: "group",
      id: makeId("group"),
      combinator: facetMode === "OR" && facetTags.length > 1 ? "OR" : "AND",
      children,
    });
    setMoreOpen(false);
    st.setSelectedView({ kind: "collection", collectionId: id });
    st.setFlashNotice(`Saved as "${name}" — it fills itself and updates live. Rename via ⋯ in the sidebar.`);
  }
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

  // Adaptive suggestions — the bar reads intent from the query: empty =
  // a calm overview of this view's vocabulary; typed = matches across
  // tags, types, item types and collections. Chips act (click = include,
  // alt-click = exclude for tags); Enter is always plain text search.
  const q = norm(query || searchQuery);
  const collectionList = collectionOrder
    .map((id) => collections[id])
    .filter((c): c is NonNullable<typeof c> => Boolean(c));
  const suggestTags = (q === "" ? topTags.slice(0, 8) : searchTags(fieldFilterPool, q).slice(0, 8)).filter(
    ({ tag }) => !facetTags.includes(tag) && !excludedTags.includes(tag)
  );
  // Count-desc, never alphabetical: computeObjectTypes sorts by name, and
  // an alphabetical cap hid the single biggest format (Image, ~7k) behind
  // Article…FacebookReel (the reported bug).
  const suggestTypes = [...objectTypes]
    .filter(({ type }) => q === "" || norm(type).includes(q))
    .sort((a, b) => b.count - a.count)
    .slice(0, 8);
  const suggestRoles = [...roleTypes]
    .filter(({ type }) => q === "" || norm(type).includes(q))
    .sort((a, b) => b.count - a.count)
    .slice(0, 8);
  const suggestCollections = collectionList
    .filter((c) => (q === "" ? true : norm(c.name).includes(q)))
    .slice(0, 6);

  return (
    <div className="absolute top-0 left-0 right-0 z-20 pointer-events-none">
      {/* The command bar is the primary instrument — centered, adaptive,
          quiet while scrolling, prominent under intent. It FLOATS over the
          workspace with a transparent background, so the things visibly
          slide away beneath it on scroll (the mymind reference). Breadcrumb
          context lives in the sidebar rail. */}
      <div className="px-5 pt-3 pb-1.5 flex justify-center relative" data-command-bar>
        <div
          ref={menuRef}
          className="relative w-full transition-[max-width] duration-200 ease-out pointer-events-auto"
          style={{ maxWidth: suggestOpen || menuOpen ? 760 : compact ? 460 : 720 }}
        >
          {/* Active filters live INSIDE the bar (second row) — the bar is
              the single search instrument: query + conditions in one
              element, nothing loose floating over the workspace. */}
          <div
            className={[
              "border bg-panel transition-[box-shadow,border-color,padding] duration-200",
              hasAnyFilter ? "rounded-3xl" : "rounded-full",
              suggestOpen || menuOpen
                ? "border-accent/40 shadow-cardHover"
                : "border-line/60 shadow-card",
              compact && !suggestOpen ? "pl-4 pr-1 py-0.5" : "pl-5 pr-1.5 py-1.5",
            ].join(" ")}
          >
            {/* §7 (2026-07-21): ONE row, always the same structure —
                Search…  [pills]  More  φ — never a second band underneath.
                Past the first few pills, "More" reveals the complete
                active query (plus match mode / clear / save). */}
            <div className="flex items-center gap-1">
            <MagnifyingGlass size={14} className="shrink-0 text-muted mr-2" />
            <input
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              onFocus={() => {
                setSuggestOpen(true);
                setMoreOpen(false);
                setCompact(false);
              }}
              onKeyDown={(e) => {
                if (e.key === "Escape") closeMenu();
                if (e.key === "Enter") setSuggestOpen(false);
              }}
              placeholder="Search…"
              title="Fuzzy search — title matches outrank tag/summary matches. Click a suggestion chip to filter."
              className="flex-1 min-w-[110px] bg-transparent font-mono text-[13px] outline-none py-1"
            />
            {searchQuery !== "" && (
              <button
                onClick={() => setSearchQuery("")}
                className="shrink-0 text-muted hover:text-ink px-1"
                aria-label="Clear search"
              >
                ×
              </button>
            )}
            {hasAnyFilter && (
              <div className="flex items-center gap-1.5 shrink min-w-0 overflow-hidden">
                {pills.slice(0, INLINE_PILLS).map(renderPill)}
              </div>
            )}
            {hasAnyFilter && (
              <button
                onClick={() => {
                  setMoreOpen((v) => !v);
                  setSuggestOpen(false);
                  setMenuOpen(false);
                }}
                className={[
                  "shrink-0 font-mono text-[11px] px-1.5 py-0.5 rounded-lg",
                  moreOpen ? "text-accent" : "text-muted hover:text-ink hover:bg-line/40",
                ].join(" ")}
                title="The complete active query — every filter, match mode, save as collection"
                aria-expanded={moreOpen}
              >
                {pills.length > INLINE_PILLS ? `More +${pills.length - INLINE_PILLS}` : "More"}
              </button>
            )}
            <button
              onClick={() => {
                setMenuOpen((v) => !v);
                setSuggestOpen(false);
                setMoreOpen(false);
              }}
              className={[
                "shrink-0 w-8 h-8 flex items-center justify-center rounded-full transition-colors",
                hasAnyFilter || menuOpen
                  ? "text-accent"
                  : "text-muted hover:text-ink hover:bg-line/40",
              ].join(" ")}
              title="Advanced filters — tags, types, fields, color, grouping"
              aria-label="Filter"
              aria-expanded={menuOpen}
            >
              <FilterIcon active={hasAnyFilter} />
            </button>
            </div>
          </div>

          <AnimatePresence>
            {moreOpen && hasAnyFilter && (
              <motion.div
                custom={{ x: 0, y: -8 }}
                variants={surfaceVariants}
                initial="hidden"
                animate="visible"
                exit="exit"
                className="absolute z-40 top-full mt-2 left-0 right-0 rounded-2xl border border-line/70 bg-panel/95 backdrop-blur shadow-cardHover p-3"
              >
                <div className="flex flex-wrap items-center gap-1.5">
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
                </div>
                <div className="mt-2.5 pt-2 border-t border-line/60 flex items-center gap-3 font-mono text-[11px]">
                  {savableAsCollection && (
                    <button
                      onClick={saveAsSmartCollection}
                      className="text-accent hover:underline decoration-dotted underline-offset-2"
                      title="Keep this exact query as a smart collection — it fills itself and updates live"
                    >
                      Save as Smart Collection
                    </button>
                  )}
                  <span className="flex-1" />
                  <button
                    onClick={() => {
                      setTypeFilter("");
                      setRoleFilter("");
                      setFacetFieldFilter(null);
                      clearFacetTags();
                      clearExcludedTags();
                      setColorFilter(null);
                      setGroupBy(null);
                      setMoreOpen(false);
                    }}
                    className="text-muted hover:text-ink underline decoration-dotted"
                  >
                    clear all
                  </button>
                </div>
              </motion.div>
            )}
          </AnimatePresence>

          <AnimatePresence>
            {suggestOpen && !menuOpen && !moreOpen && (
              <motion.div
                custom={{ x: 0, y: -8 }}
                variants={surfaceVariants}
                initial="hidden"
                animate="visible"
                exit="exit"
                className="absolute z-40 top-full mt-2 left-0 right-0 rounded-2xl border border-line/70 bg-panel/95 backdrop-blur shadow-cardHover p-3"
              >
                {suggestTags.length > 0 && (
                  <div className="mb-2.5">
                    <div className="font-mono text-[10px] uppercase tracking-[0.12em] text-muted mb-1.5">
                      Tags
                    </div>
                    <div className="flex flex-wrap gap-1.5">
                      {suggestTags.map(({ tag, count: c }) => (
                        <button
                          key={tag}
                          onClick={(e) =>
                            e.altKey ? toggleExcludeTag(tag) : toggleFacetTag(tag)
                          }
                          className="tag-chip gap-1 font-mono hover:border-accent/40"
                          title={`${tag} — click to filter, option/alt-click to exclude`}
                        >
                          {tag}
                          <span className="text-muted/60">{c}</span>
                        </button>
                      ))}
                    </div>
                  </div>
                )}
                {suggestCollections.length > 0 && (
                  <div className="mb-2.5">
                    <div className="font-mono text-[10px] uppercase tracking-[0.12em] text-muted mb-1.5">
                      Collections
                    </div>
                    <div className="flex flex-wrap gap-1.5">
                      {suggestCollections.map((c) => (
                        <button
                          key={c.id}
                          onClick={() => {
                            setSelectedView({ kind: "collection", collectionId: c.id });
                            closeMenu();
                          }}
                          className="tag-chip gap-1 font-mono hover:border-accent/40"
                          title={`Open ${c.name}`}
                        >
                          {c.type === "smart" ? "⚡" : "▤"} {c.name}
                        </button>
                      ))}
                    </div>
                  </div>
                )}
                <div className="flex flex-wrap gap-x-6 gap-y-2.5">
                  {suggestTypes.length > 0 && (
                    <div>
                      <div className="font-mono text-[10px] uppercase tracking-[0.12em] text-muted mb-1.5">
                        Format
                      </div>
                      <div className="flex flex-wrap gap-1.5">
                        {suggestTypes.map(({ type, count: c }) => (
                          <button
                            key={type}
                            onClick={() => setTypeFilter(typeFilter === type ? "" : type)}
                            className={[
                              "tag-chip gap-1 font-mono",
                              typeFilter === type ? "border-accent/40 bg-accent/5 text-ink" : "hover:border-accent/40",
                            ].join(" ")}
                          >
                            {type}
                            <span className="text-muted/60">{c}</span>
                          </button>
                        ))}
                      </div>
                    </div>
                  )}
                  {suggestRoles.length > 0 && (
                    <div>
                      <div className="font-mono text-[10px] uppercase tracking-[0.12em] text-muted mb-1.5">
                        Role
                      </div>
                      <div className="flex flex-wrap gap-1.5">
                        {suggestRoles.map(({ type, count: c }) => (
                          <button
                            key={type}
                            onClick={() => setRoleFilter(roleFilter === type ? "" : type)}
                            className={[
                              "tag-chip gap-1 font-mono",
                              roleFilter === type ? "border-accent/40 bg-accent/5 text-ink" : "hover:border-accent/40",
                            ].join(" ")}
                          >
                            {type}
                            <span className="text-muted/60">{c}</span>
                          </button>
                        ))}
                      </div>
                    </div>
                  )}
                </div>
                <div className="mt-2.5 font-mono text-[10px] text-muted/60">
                  enter to search · click a chip to filter · alt-click a tag to exclude · esc to close
                </div>
              </motion.div>
            )}
          </AnimatePresence>
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
                    ["type", "Format"],
                    ["role", "Role"],
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
                            className="w-6 h-6 rounded-md font-mono text-[13px] text-muted hover:text-red-600 hover:bg-danger/10"
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
                      Entity type
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

        {/* Bench / Classify used to float here as two pills, one command-bar
            width away from colliding with it (Samuel, 2026-07-21). They now
            live INSIDE the right membrane as its two tabs — the compartment
            names its own tenants; nothing floats over the workspace. */}
      </div>

    </div>
  );
}
