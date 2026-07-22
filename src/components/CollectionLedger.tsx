import { useMemo, useState } from "react";
import { useShallow } from "zustand/react/shallow";
import { allObjectsOf, useStore } from "../store";
import { computeFieldValueFrequency, type TagFrequency } from "../lib/quickFilter";
import {
  classifyFacetEmphasis,
  computeFacetStrength,
  computeValueUserShare,
  distinctRoleKeys,
  resolveActiveRole,
} from "../lib/primaryFacets";
import { realKindKeys } from "../lib/kinds";
import { addMymindTag } from "../lib/mymindWrite";
import { norm } from "../lib/textNorm";
import { DRAG_MIME } from "../lib/objectDrag";
import { AskGemini } from "./AskGemini";
import {
  AUTO_APPLY_CONFIDENCE,
  ClassifierUnavailable,
  classifierProvider,
  previewProviders,
  proposeOptionsFromMembers,
  proposeWithProvider,
} from "../lib/fieldExtraction";
import type { Collection, DesignObject, FacetField, RoleDefinition } from "../types";

const VISIBLE_VALUES = 6;

/** Ceiling on one classifier round. Four batches, so a mistaken taxonomy
 * costs a little and is caught early rather than billed across an archive. */
const CLASSIFY_LIMIT = 100;

/** The composition of a collection read as plain words (Samuel,
 * 2026-07-21: "Entity type" was internal vocabulary leaking into the UI;
 * the user-facing question is "what can I find here?").
 *
 * Lowercased only. Naive pluralization used to be applied here and it made
 * the reading WORSE, not better: "European" became "europeans" — which
 * reads as people from Europe rather than European-something — and
 * "photographies" is not a word anyone writes. English plurals of an
 * open-ended, user-invented vocabulary cannot be guessed; the name the
 * user chose is the honest thing to show. */
export function roleWord(name: string): string {
  return name.toLowerCase();
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
    // Adds to this category, keeping any the object already belongs to
    // (2026-07-21) — addFieldValue records the hand-picked provenance too.
    useStore.getState().addFieldValue(ids, field.name, value);
  }

  // Only real kinds appear here — the junk tag-roles the old "discover
  // kinds" left behind (sign, facade, hungary, 1970s) are filtered out of
  // "Here you can find" and out of active-role resolution (Samuel,
  // 2026-07-22). See lib/kinds.ts.
  const realKinds = realKindKeys(roles, useStore.getState().collections);
  const roleKeys = new Set(Array.from(distinctRoleKeys(objects)).filter((k) => realKinds.has(k)));
  const activeRole = resolveActiveRole(objects, roles, roleFilter, realKinds);

  const roleCounts = new Map<string, number>();
  for (const o of objects) {
    if (!o.role) continue;
    const key = norm(o.role);
    if (!realKinds.has(key)) continue;
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
  // "Here you can find" moved up into the top entity nav (§3, 2026-07-22) —
  // one place answers "what's in here", not two. The ledger now carries the
  // Info column and the property columns only.
  const hasAnything = hasInfo || orderedPinned.length > 0;
  if (!hasAnything) return null;

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

  // A property with no declared options can never be filled by tag
  // matching — so offer it the vocabulary its own members already carry
  // (Samuel, 2026-07-21: Photographer sat empty while #Todd Hido and
  // #Bernd and Hilla Becher were right there on the objects).
  const suggested =
    !best && !(field.options ?? []).length
      ? proposeOptionsFromMembers(objects, allObjectsOf(useStore.getState().objects), field.name)
      : [];

  function seedFromTags() {
    const st = useStore.getState();
    st.pushUndo(`give ${field.name} its categories`);
    for (const { value } of suggested) st.addFieldOption(field.name, value);
    // The options now exist, so the ordinary tag→value extractor can do
    // the rest — one shared path, no special case.
    const withOptions: FacetField = {
      ...field,
      options: suggested.map((s) => s.value),
    };
    const provider = previewProviders(objects, field.name, withOptions).find(
      (p) => p.provider.id === "tag-vocabulary"
    );
    if (provider) {
      st.applyProposals(proposeWithProvider(provider.provider, objects, field.name, withOptions));
    }
    st.setFlashNotice(
      `"${field.name}" now has ${suggested.length} categories, taken from these items' own tags.`
    );
  }

  /** What no amount of counting will reach: still empty after the best free
   * provider has had its turn. Capped, because this is the one offer with a
   * bill attached and "ask about 4,000" is not a thing anyone should be able
   * to click by accident. */
  const unreachable = useMemo(() => {
    if ((field.options ?? []).length < 2) return [];
    const derivable = new Set(
      best ? proposeWithProvider(best.provider, missing, field.name, field).map((p) => p.objectId) : []
    );
    return missing.filter((o) => !derivable.has(o.id)).slice(0, CLASSIFY_LIMIT);
  }, [missing, best, field]);

  const [asking, setAsking] = useState(false);
  const [error, setError] = useState<string | null>(null);

  function askClassifier() {
    const st = useStore.getState();
    st.requestConfirm({
      title: `Have ${field.name} read?`,
      // Said plainly because it is the one place the app spends money and
      // sends anything anywhere. The user should know both before clicking.
      body: `${unreachable.length} item${unreachable.length > 1 ? "s" : ""} nothing here can work out for itself. Their titles, tags and summaries go to Gemini, which answers with one of ${field.name}'s own categories — it can't invent new ones. Confident answers are applied, the rest are left for you. One ⌘Z undoes all of it.`,
      action: "Read them",
      onConfirm: async () => {
        setAsking(true);
        setError(null);
        try {
          const proposals =
            (await classifierProvider.proposeAsync?.(unreachable, field.name, { field })) ?? [];
          if (proposals.length === 0) {
            setError("nothing it could defend");
            return;
          }
          // No pushUndo here: applyProposals pushes its own, and a second
          // one would silently make this the only action in the app that
          // needs ⌘Z twice.
          const state = useStore.getState();
          state.applyProposals(proposals);
          const sure = proposals.filter((p) => p.confidence >= AUTO_APPLY_CONFIDENCE).length;
          state.setFlashNotice(
            `${field.name}: ${proposals.length} read, ${sure} confidently. Values it wasn't sure of stay marked as not yet yours.`
          );
        } catch (err) {
          setError(
            err instanceof ClassifierUnavailable ? "no key yet" : (err as Error).message || "failed"
          );
        } finally {
          setAsking(false);
        }
      },
    });
  }

  return (
    // Hover-summoned, never resident: a standing "412 empty · fill" on every
    // column multiplied into exactly the kind of chrome wall the design
    // philosophy bans. The offer appears when attention arrives at the
    // column and recedes with it.
    <div className="font-mono text-[10px] text-muted/60 mt-0.5 opacity-0 group-hover/facet:opacity-100 transition-opacity">
      {empty} empty
      {suggested.length > 0 && (
        <>
          {" · "}
          <button
            onClick={seedFromTags}
            className="text-accent/80 hover:text-accent hover:underline decoration-dotted underline-offset-2"
            title={`Take its categories from these items' own tags: ${suggested
              .slice(0, 6)
              .map((s) => s.value)
              .join(", ")}`}
          >
            suggest {suggested.length} categories
          </button>
        </>
      )}
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
      {/* Last, and only after everything free has been offered: the ones
          nothing can derive. This is the serif-vs-sans case exactly — the
          measured 3.3% — and the only honest answer to it is to look. */}
      {unreachable.length > 0 && (
        <>
          {" · "}
          <AskGemini
            label={`ask about ${unreachable.length}`}
            busy={asking}
            onAsk={askClassifier}
            detail={`Looks at ${unreachable.length} item${unreachable.length > 1 ? "s" : ""} one by one and picks from ${field.name}'s own categories, using`}
          />
        </>
      )}
      {error && <span className="ml-1 text-muted/80">{error}</span>}
    </div>
  );
}
