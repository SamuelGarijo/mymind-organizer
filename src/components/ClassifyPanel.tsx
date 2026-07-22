import { useEffect, useMemo, useState } from "react";
import { useStore } from "../store";
import { orderedFacetBuckets } from "../lib/primaryFacets";
import { UNCLASSIFIED_VALUE } from "../lib/quickFilter";
import { rankByHybridSimilarity } from "../lib/hybridSimilarity";
import { UNGROUPED_LABEL } from "../lib/grouping";
import { norm } from "../lib/textNorm";
import { asFieldString } from "../lib/mymindSync";
import { resolveCollectionFields } from "../lib/fieldCatalog";
import { DRAG_MIME, objectDragProps } from "../lib/objectDrag";
import {
  AUTO_APPLY_CONFIDENCE,
  ClassifierUnavailable,
  classifierProvider,
} from "../lib/fieldExtraction";
import { AskGemini } from "./AskGemini";
import type { Collection, DesignObject, RoleDefinition } from "../types";

/** Same ceiling the ledger uses — one round is at most four batches, so a
 * wrong taxonomy is caught cheaply instead of billed across an archive. */
const CLASSIFY_LIMIT = 100;

/** Roles / mymind types that read as *text* — the cross-category bridge:
 * when a collection's things are images, related reading links out to the
 * written side of the library (and vice versa, the same set works). */
const TEXTUAL_KEYS = new Set(
  ["article", "note", "text", "writing", "document", "pdf", "webpage", "content", "post"].map(norm)
);

function isTextual(object: DesignObject): boolean {
  if (object.role && TEXTUAL_KEYS.has(norm(object.role))) return true;
  const entity = asFieldString(object.fields.entity_type);
  return entity ? TEXTUAL_KEYS.has(norm(entity)) : false;
}

function PanelLabel({ children }: { children: React.ReactNode }) {
  return (
    <div className="font-mono text-[10px] uppercase tracking-[0.12em] text-muted">{children}</div>
  );
}

/** Tiny thumbnail used in folder peeks and the similar strip — a failed
 * image falls back to the title, never a broken-image glyph. */
function Peek({
  object,
  onOpen,
  onRemove,
}: {
  object: DesignObject;
  onOpen: (id: string) => void;
  /** Present inside a category: the explicit way OUT, since dropping into
   * another category now adds rather than moves (2026-07-21). */
  onRemove?: () => void;
}) {
  const [failed, setFailed] = useState(false);
  return (
    <span className="relative shrink-0 group/peek">
    {onRemove && (
      <button
        onClick={(e) => {
          e.stopPropagation();
          onRemove();
        }}
        className="absolute -top-1 -right-1 z-10 w-4 h-4 rounded-full bg-panel border border-line text-muted hover:text-ink hover:border-ink/40 text-[10px] leading-none flex items-center justify-center opacity-0 group-hover/peek:opacity-100 transition-opacity shadow-card"
        title="Remove from this category (keeps every other one)"
        aria-label={`Remove ${object.title} from this category`}
      >
        ×
      </button>
    )}
    <button
      onClick={() => onOpen(object.id)}
      title={object.title}
      // Universal drag (issue #132): a folder-sample or similar-outside
      // peek is a full object — pick it up and drop it on the bench, a
      // collection, or another folder, no navigation needed.
      {...objectDragProps([object.id])}
      className="block w-12 h-12 rounded-md overflow-hidden border border-line bg-line/20 hover:border-accent/50 cursor-grab active:cursor-grabbing"
    >
      {object.imageUrl && !failed ? (
        <img
          src={object.imageUrl}
          alt=""
          className="w-full h-full object-cover pointer-events-none"
          onError={() => setFailed(true)}
        />
      ) : (
        <span className="block w-full h-full p-1 text-[7px] leading-tight text-muted text-left overflow-hidden pointer-events-none">
          {object.title}
        </span>
      )}
    </button>
    </span>
  );
}

/**
 * The classification core for ONE (role, field): the reservoir note + its
 * "ask Gemini" offer, the half-naked folder rows that let their contents
 * peek through, and the "+ add category" seed. Owns nothing about position
 * or chrome — the parent decides whether this sits alone in the drawer
 * (`ClassifyPanel`) or stacked one-per-kind under "All objects"
 * (`StackedClassifyPanel`). Extracting it is what lets those two surfaces
 * share a single definition of "classify these things by this property",
 * instead of the drag/drop/seed logic living in two places.
 *
 * `members` are the objects this block classifies (already scoped to the
 * collection + role); the reservoir count is derived from them, never from
 * whatever subset the grid is currently narrowed to.
 */
function FacetFolders({
  role,
  members,
  fieldName,
  onFilterValue,
  activeFilterValue,
  onOpen,
}: {
  role: RoleDefinition;
  members: DesignObject[];
  fieldName: string;
  onFilterValue: (value: string | null) => void;
  activeFilterValue: string | null;
  onOpen: (id: string) => void;
}) {
  const activeField = role.fields.find((f) => f.name === fieldName);
  const [dragOverLabel, setDragOverLabel] = useState<string | null>(null);
  // Folders created by hand this session that have no members yet — they
  // exist to be dropped into ("+ new folder" in the sketch). Reset per facet.
  const [draftFolders, setDraftFolders] = useState<string[]>([]);
  const [draftName, setDraftName] = useState("");
  useEffect(() => setDraftFolders([]), [fieldName, role.name]);

  const [asking, setAsking] = useState(false);
  const [askError, setAskError] = useState<string | null>(null);
  useEffect(() => setAskError(null), [fieldName, role.name]);

  /** The pile this block exists to empty — and the classifier only ever
   * touches it, never anything already answered. */
  const unclassified = useMemo(
    () =>
      members.filter((o) => {
        const v = o.fields[fieldName];
        return Array.isArray(v) ? v.length === 0 : !v;
      }),
    [members, fieldName]
  );

  async function askClassifier() {
    if (!activeField) return;
    const batch = unclassified.slice(0, CLASSIFY_LIMIT);
    useStore.getState().requestConfirm({
      title: `Have ${fieldName} read?`,
      body: `${batch.length} item${batch.length > 1 ? "s" : ""} with no ${fieldName} yet. Their titles, tags and summaries go to Gemini, which answers with one of ${fieldName}'s own categories — it can't invent new ones. Confident answers are applied, the rest are left for you. One ⌘Z undoes all of it.`,
      action: "Read them",
      onConfirm: async () => {
        setAsking(true);
        setAskError(null);
        try {
          const proposals =
            (await classifierProvider.proposeAsync?.(batch, fieldName, { field: activeField })) ??
            [];
          if (proposals.length === 0) {
            setAskError("nothing it could defend");
            return;
          }
          const state = useStore.getState();
          state.applyProposals(proposals);
          const sure = proposals.filter((p) => p.confidence >= AUTO_APPLY_CONFIDENCE).length;
          state.setFlashNotice(
            `${fieldName}: ${proposals.length} read, ${sure} confidently. Values it wasn't sure of stay marked as not yet yours.`
          );
        } catch (err) {
          setAskError(
            err instanceof ClassifierUnavailable ? "no key yet" : (err as Error).message || "failed"
          );
        } finally {
          setAsking(false);
        }
      },
    });
  }

  const buckets = useMemo(
    () => (activeField ? orderedFacetBuckets(members, activeField) : []),
    [members, activeField]
  );
  const valueBuckets = buckets.filter((b) => b.label !== UNGROUPED_LABEL);
  const existingLabels = new Set(valueBuckets.map((b) => norm(b.label)));
  const drafts = draftFolders.filter((d) => !existingLabels.has(norm(d)));

  function handleDrop(e: React.DragEvent, label: string) {
    e.preventDefault();
    setDragOverLabel(null);
    const raw = e.dataTransfer.getData(DRAG_MIME);
    if (!raw) return;
    const ids: string[] = JSON.parse(raw);
    const st = useStore.getState();
    // A "+ new folder" IS a new option on this property — dropping into it
    // must add the option to the field's definition (shared vocabulary,
    // issue #96), not just write values that no other surface knows about.
    // Table's grouped view already did both; this was the missing half.
    if (!activeField!.options?.some((opt) => norm(opt) === norm(label))) {
      st.addFieldOption(activeField!.name, label);
    }
    // Filing something here ADDS it here — it keeps whatever categories it
    // already belonged to (Samuel, 2026-07-21). Leaving one is the explicit
    // × on the item, never a side effect of joining another.
    st.addFieldValue(ids, activeField!.name, label);
  }

  function folderRow(label: string, folderMembers: DesignObject[]) {
    const over = dragOverLabel === label;
    const filtering = activeFilterValue === label;
    return (
      <div
        key={label}
        onDragOver={(e) => {
          e.preventDefault();
          setDragOverLabel(label);
        }}
        onDragLeave={() => setDragOverLabel((cur) => (cur === label ? null : cur))}
        onDrop={(e) => handleDrop(e, label)}
        className={[
          "rounded-xl border bg-canvas/70 px-3 py-2 transition-shadow",
          over ? "border-accent ring-2 ring-accent/30 shadow-cardHover" : "border-line",
        ].join(" ")}
      >
        <div className="flex items-baseline justify-between mb-1.5">
          {/* A category is NAVIGABLE, not a static pile (§1): clicking it
           * narrows the main grid to exactly this subset, beside the panel,
           * on top of whatever collection/filters are already active. */}
          <button
            onClick={() => onFilterValue(filtering ? null : label)}
            className={[
              "font-mono text-[12px] truncate text-left hover:underline decoration-dotted underline-offset-2",
              filtering ? "text-accent" : "text-ink/85",
            ].join(" ")}
            title={
              filtering
                ? "Showing only these — click to show the whole collection again"
                : `Show only ${label} in the grid`
            }
          >
            {filtering ? "● " : ""}
            {label}
          </button>
          <span className="font-mono text-[11px] text-muted shrink-0">{folderMembers.length}</span>
        </div>
        {folderMembers.length > 0 ? (
          <div className="flex gap-1.5 overflow-x-auto pb-0.5">
            {folderMembers.slice(0, 14).map((o) => (
              <Peek
                key={o.id}
                object={o}
                onOpen={onOpen}
                onRemove={() =>
                  useStore.getState().removeFieldValue([o.id], activeField!.name, label)
                }
              />
            ))}
            {folderMembers.length > 14 && (
              <span className="shrink-0 self-center font-mono text-[10px] text-muted px-1">
                +{folderMembers.length - 14}
              </span>
            )}
          </div>
        ) : (
          <div className="h-12 rounded-md border border-dashed border-line/80 flex items-center justify-center font-mono text-[10px] text-muted/70">
            drop things here
          </div>
        )}
      </div>
    );
  }

  if (!activeField) {
    return (
      <p className="text-[12px] text-muted leading-relaxed">
        "{role.name}" has no properties to classify by in this collection — add one from the
        entity nav's field sub-row.
      </p>
    );
  }

  return (
    <>
      {unclassified.length > 0 && (
        <div className="flex flex-wrap items-baseline gap-x-2 gap-y-1">
          <button
            onClick={() => onFilterValue(UNCLASSIFIED_VALUE)}
            className="font-mono text-[10px] text-muted/80 hover:text-ink hover:underline decoration-dotted underline-offset-2 text-left"
            title={`Show only the objects with no ${fieldName} yet`}
          >
            {unclassified.length.toLocaleString()} not yet classified by {fieldName} — drag them in,
            or click to see them
          </button>
          {/* The third and most obvious touchpoint (Samuel, 2026-07-21:
           * "haz más obvios los puntos de contacto"), and the one that
           * needed it most: this drawer is where classifying actually
           * happens, staring at a pile that has to be dragged one by one.
           *
           * Same conditions as everywhere else: only with categories
           * already declared, only on the unclassified, never automatic. */}
          {(activeField.options ?? []).length >= 2 && (
            <AskGemini
              label={`ask about ${Math.min(unclassified.length, CLASSIFY_LIMIT)}`}
              busy={asking}
              onAsk={askClassifier}
              detail={`Looks at ${Math.min(unclassified.length, CLASSIFY_LIMIT)} of them one by one and picks from ${fieldName}'s own categories, using`}
            />
          )}
          {askError && <span className="font-mono text-[10px] text-muted/70">{askError}</span>}
        </div>
      )}

      <div className="flex flex-col gap-2">
        {valueBuckets.map((b) => folderRow(b.label, b.objects))}
        {drafts.map((d) => folderRow(d, []))}

        <form
          onSubmit={(e) => {
            e.preventDefault();
            const name = draftName.trim();
            if (!name || existingLabels.has(norm(name))) return;
            setDraftFolders((cur) => [...cur, name]);
            setDraftName("");
          }}
          className="flex items-center gap-1.5 pt-0.5"
        >
          {/* Not a folder — a new VALUE of this property (§2): the category
           * becomes a real option on the field the moment something lands
           * in it, shared everywhere this property appears. */}
          <input
            value={draftName}
            onChange={(e) => setDraftName(e.target.value)}
            placeholder={`+ add ${fieldName} category`}
            className="flex-1 rounded-lg border border-dashed border-line bg-transparent px-2.5 py-1.5 font-mono text-[11px] outline-none focus:border-accent placeholder:text-muted/60"
          />
          {draftName.trim() !== "" && (
            <button type="submit" className="font-mono text-[11px] text-accent hover:underline shrink-0">
              add
            </button>
          )}
        </form>
      </div>
    </>
  );
}

/**
 * The conditional floating panel from Samuel's sketch ("this is like a
 * conditional floating panel with tabs… modular pieces that come and go
 * depending on context"). Summoned by ✦ Classify, recedes on close (N21).
 * Rendered when a SINGLE entity is active — one role, its folders, and the
 * two cross-pollination modules below.
 *
 * The inversion that matters (design-philosophy N8): the *unclassified
 * reservoir stays in the main grid* — the sacred space — and the classified
 * values live here as half-naked folder rows that let their content peek
 * through. Drag a thing from the grid onto a folder to classify it.
 *
 * Below the folders, two cross-pollination modules:
 * - Related reading — textual objects from the wider library whose tags
 *   match this facet's values (cross-category: images link to words).
 * - Similar outside — hybrid-similarity neighbours of this collection that
 *   live OUTSIDE it, so the world's edges stay porous.
 */
export function ClassifyPanel({
  roleObjects,
  collectionIds,
  allObjects,
  activeRole,
  fieldName,
  onFieldChange,
  fieldOptions,
  onFilterValue,
  activeFilterValue,
  onOpen,
}: {
  /** Collection members carrying the active role — the folders' population. */
  roleObjects: DesignObject[];
  /** Every id in the current collection — the outside/inside boundary. */
  collectionIds: Set<string>;
  /** Whole library (stable reference — feeds the similarity corpus cache). */
  allObjects: DesignObject[];
  activeRole: RoleDefinition;
  fieldName: string;
  onFieldChange: (name: string) => void;
  /** Which properties this drawer can switch between. Aligned to the
   * collection's own field VIEW (resolveCollectionFields), so the drawer
   * tabs and the By-X sub-row never disagree about what a collection shows
   * (Samuel, 2026-07-21/22). Falls back to the role's pinned facets outside
   * a collection. */
  fieldOptions?: string[];
  /** §1 — categories are navigable: called with a value (or
   * UNCLASSIFIED_VALUE) to narrow the main grid to that subset, null to
   * clear back to the whole collection. */
  onFilterValue: (value: string | null) => void;
  /** The value currently narrowing the grid, so the active category can
   * read as selected here. */
  activeFilterValue: string | null;
  onOpen: (id: string) => void;
}) {
  const primaryFacets = fieldOptions ?? activeRole.primaryFacets ?? [];
  const activeField = activeRole.fields.find((f) => f.name === fieldName);

  const valueBuckets = useMemo(
    () =>
      (activeField ? orderedFacetBuckets(roleObjects, activeField) : []).filter(
        (b) => b.label !== UNGROUPED_LABEL
      ),
    [roleObjects, activeField]
  );

  // Cross-category: textual library objects (outside this collection) whose
  // tags/title mention one of this facet's values — "articles about the
  // tones these images have".
  const relatedReading = useMemo(() => {
    const values = valueBuckets.map((b) => ({ raw: b.label, key: norm(b.label) }));
    if (values.length === 0) return [];
    const hits: { object: DesignObject; matches: string[] }[] = [];
    for (const object of allObjects) {
      if (collectionIds.has(object.id) || !isTextual(object)) continue;
      const tagKeys = new Set(object.tags.map(norm));
      const titleKey = norm(object.title);
      const matches = values
        .filter((v) => tagKeys.has(v.key) || titleKey.includes(v.key))
        .map((v) => v.raw);
      if (matches.length > 0) hits.push({ object, matches });
    }
    return hits.sort((a, b) => b.matches.length - a.matches.length).slice(0, 5);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [allObjects, collectionIds, valueBuckets.map((b) => b.label).join("|")]);

  // Similar things OUTSIDE the collection — a handful of spread-out seeds
  // from the role's members, each ranked against the outside pool with the
  // hybrid engine (#23), merged by best score. Computed once per panel
  // open/facet switch; the corpus cache keys on the allObjects reference.
  const similarOutside = useMemo(() => {
    if (roleObjects.length === 0) return [];
    const step = Math.max(1, Math.floor(roleObjects.length / 5));
    const seeds = [0, 1, 2, 3, 4]
      .map((i) => roleObjects[i * step])
      .filter((o): o is DesignObject => Boolean(o));
    const candidates = allObjects.filter((o) => !collectionIds.has(o.id));
    const best = new Map<string, number>();
    for (const seed of seeds) {
      for (const r of rankByHybridSimilarity(seed, candidates, allObjects, 30)) {
        if ((best.get(r.id) ?? 0) < r.score) best.set(r.id, r.score);
      }
    }
    const byId = new Map(candidates.map((o) => [o.id, o]));
    return Array.from(best.entries())
      .sort((a, b) => b[1] - a[1])
      .slice(0, 10)
      .map(([id]) => byId.get(id))
      .filter((o): o is DesignObject => Boolean(o));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [roleObjects, allObjects, collectionIds]);

  if (!activeField) {
    return (
      <aside className="h-full flex flex-col px-5 pb-5" aria-label="Classification">
        <div className="mb-3">
          <PanelLabel>Classifying · {activeRole.name}</PanelLabel>
        </div>
        <p className="text-[12px] text-muted leading-relaxed">
          "{activeRole.name}" has no primary facets pinned yet — pin some in its entity-type
          fields (★ next to a field) to lay out categories here.
        </p>
      </aside>
    );
  }

  return (
    // Membrane content (§6, 2026-07-21): Classify is a compartment of the
    // workshop like the Workbench — it opens inward from the right edge and
    // the main surface yields space. The Membrane owns position, depth and
    // reveal (inner shadow, recessed canvas tone); this is just the
    // cavity's content, no chrome of its own.
    <aside
      className="h-full flex flex-col overflow-hidden"
      aria-label="Classification categories"
    >
      <div className="shrink-0 px-4 pb-3 border-b border-line/70">
        {/* Conversational, not architectural (§3): say what's happening in
         * terms of the entity and property, never internal nouns. The
         * membrane's tab row owns the close. */}
        <div className="mb-2">
          <PanelLabel>
            Classifying {activeRole.name} by {fieldName}
          </PanelLabel>
        </div>
        {primaryFacets.length > 1 && (
          <div className="flex items-center gap-1 flex-wrap">
            {primaryFacets.map((name) => (
              <button
                key={name}
                onClick={() => onFieldChange(name)}
                className={[
                  "tag-chip font-mono shrink-0",
                  name === fieldName ? "border-accent/40 bg-accent/5 text-ink" : "",
                ].join(" ")}
              >
                {name}
              </button>
            ))}
          </div>
        )}
      </div>

      <div className="flex-1 overflow-y-auto px-4 py-3 flex flex-col gap-2">
        <FacetFolders
          role={activeRole}
          members={roleObjects}
          fieldName={fieldName}
          onFilterValue={onFilterValue}
          activeFilterValue={activeFilterValue}
          onOpen={onOpen}
        />

        {relatedReading.length > 0 && (
          <div className="mt-3">
            <PanelLabel>Related reading</PanelLabel>
            <div className="mt-1.5 flex flex-col gap-1">
              {relatedReading.map(({ object, matches }) => (
                <button
                  key={object.id}
                  onClick={() => onOpen(object.id)}
                  {...objectDragProps([object.id])}
                  className="text-left group cursor-grab active:cursor-grabbing"
                  title={object.title}
                >
                  <span className="text-[12px] text-ink/80 group-hover:underline decoration-dotted underline-offset-2 line-clamp-1">
                    {object.title}
                  </span>
                  <span className="font-mono text-[10px] text-muted">
                    {matches.join(" · ")}
                  </span>
                </button>
              ))}
            </div>
          </div>
        )}
      </div>

      {similarOutside.length > 0 && (
        <div className="shrink-0 border-t border-line/70 px-4 py-3">
          <PanelLabel>Similar · outside this collection</PanelLabel>
          <div className="mt-2 flex gap-1.5 overflow-x-auto pb-0.5">
            {similarOutside.map((o) => (
              <Peek key={o.id} object={o} onOpen={onOpen} />
            ))}
          </div>
        </div>
      )}
    </aside>
  );
}

/** One kind's block inside the stacked "All objects" drawer — its own field
 * tabs (drawn from the collection's field VIEW for THIS kind), its own
 * reservoir, its own folders. Selecting a folder narrows the shared grid by
 * this block's field; only one block's narrowing can be active at a time
 * (the grid carries a single facet filter), which reads correctly. */
function StackedBlock({
  role,
  members,
  collection,
  onOpen,
}: {
  role: RoleDefinition;
  members: DesignObject[];
  collection: Collection | undefined;
  onOpen: (id: string) => void;
}) {
  const fieldNames = useMemo(
    () =>
      resolveCollectionFields(collection, role)
        .filter((f) => f.type === "select" || f.type === "multi-select")
        .map((f) => f.name),
    [collection, role]
  );
  const [field, setField] = useState(fieldNames[0] ?? "");
  useEffect(() => {
    if (!fieldNames.some((n) => norm(n) === norm(field))) setField(fieldNames[0] ?? "");
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [fieldNames.join("|")]);

  const facetFieldFilter = useStore((s) => s.facetFieldFilter);
  const activeFilterValue =
    facetFieldFilter && norm(facetFieldFilter.field) === norm(field) ? facetFieldFilter.value : null;

  return (
    <div className="flex flex-col gap-2">
      <div className="flex items-baseline justify-between gap-2">
        <PanelLabel>
          Classify {role.name} by {field || "…"}
        </PanelLabel>
        <span className="font-mono text-[10px] text-muted/70 shrink-0">{members.length}</span>
      </div>
      {fieldNames.length > 1 && (
        <div className="flex items-center gap-1 flex-wrap">
          {fieldNames.map((name) => (
            <button
              key={name}
              onClick={() => setField(name)}
              className={[
                "tag-chip font-mono shrink-0",
                norm(name) === norm(field) ? "border-accent/40 bg-accent/5 text-ink" : "",
              ].join(" ")}
            >
              {name}
            </button>
          ))}
        </div>
      )}
      <FacetFolders
        role={role}
        members={members}
        fieldName={field}
        onFilterValue={(value) =>
          useStore
            .getState()
            .setFacetFieldFilter(value === null ? null : { field, value })
        }
        activeFilterValue={activeFilterValue}
        onOpen={onOpen}
      />
    </div>
  );
}

/**
 * "All objects" in a MULTI-kind collection: never one entity's
 * classification forced across everything (the bug from the screenshots —
 * "CLASSIFYING ARTICLE BY TOPIC" over a 1,203-item Typography collection).
 * Instead, one classification block per real kind, stacked — "Classify
 * Photo by…", "Classify Post by…" — each speaking only for its own kind.
 * The grid stays flat (App keeps it un-narrowed while no single entity is
 * active); this drawer is where the multi-kind pile gets sorted.
 */
export function StackedClassifyPanel({
  kinds,
  members,
  collection,
  onOpen,
}: {
  /** The real kinds present in the collection (junk roles already filtered). */
  kinds: RoleDefinition[];
  /** Every collection member — split per kind here. */
  members: DesignObject[];
  collection: Collection | undefined;
  onOpen: (id: string) => void;
}) {
  const byKind = useMemo(() => {
    const map = new Map<string, DesignObject[]>();
    for (const o of members) {
      if (!o.role) continue;
      const k = norm(o.role);
      const arr = map.get(k);
      if (arr) arr.push(o);
      else map.set(k, [o]);
    }
    return map;
  }, [members]);

  return (
    <aside className="h-full flex flex-col overflow-hidden" aria-label="Classification by kind">
      <div className="shrink-0 px-4 pb-3 pt-1 border-b border-line/70">
        <PanelLabel>All objects · classify each kind on its own</PanelLabel>
      </div>
      <div className="flex-1 overflow-y-auto px-4 py-3 flex flex-col gap-6 divide-y divide-line/50">
        {kinds.map((role) => (
          <div key={role.name} className="pt-3 first:pt-0">
            <StackedBlock
              role={role}
              members={byKind.get(norm(role.name)) ?? []}
              collection={collection}
              onOpen={onOpen}
            />
          </div>
        ))}
      </div>
    </aside>
  );
}
