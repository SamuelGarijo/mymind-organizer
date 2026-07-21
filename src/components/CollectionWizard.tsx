import { useMemo, useState } from "react";
import { useStore } from "../store";
import { norm } from "../lib/textNorm";
import { resolveCollectionFields } from "../lib/fieldCatalog";
import { CURATED_ROLE_FIELDS, STARTER_KINDS } from "../lib/curatedRoleFields";
import { evaluateGroup } from "../lib/ruleEngine";
import { makeId } from "../lib/id";
import { HeroImagePicker } from "./HeroImagePicker";
import { AdmissionRules, newRow, type Row } from "./AdmissionRules";
import type { DesignObject, FacetField, FilterGroup } from "../types";

/**
 * One wizard for both kinds of collection (Samuel, 2026-07-22: "esta lógica
 * simplifica tanto el wizard de manual collection como el de smart
 * collection, solo que smart le añade las normas de admisión condicional").
 *
 * A collection is: a name, a description, the KINDS it contains, and — per
 * kind — which of that kind's properties it shows. A manual collection is
 * exactly that. A smart collection is that PLUS conditional admission rules
 * (who gets in). So the two used to be near-duplicate modals carrying the
 * old selection/quality/kind chooser; now they're this, and `mode` decides
 * only whether the rules block appears.
 *
 * Two steps, from the Figma flow (node 89:6836):
 *   1. "What is this collection?" — name, description, (smart: rules), and
 *      a multi-select of the kinds it's about.
 *   2. "What do you care about?" — per kind, its fields: reorder, hide
 *      (this view only), or add (writes through to the kind everywhere).
 *
 * The field-view asymmetry lives in the store (addCollectionField vs
 * setCollectionFieldView); this component just drives them.
 */
export function CollectionWizard({
  mode,
  collectionId,
  parentId,
  onClose,
}: {
  mode: "manual" | "smart";
  collectionId?: string;
  parentId?: string;
  onClose: () => void;
}) {
  const store = useStore();
  const roles = store.roles;
  const objects = store.objects;
  const collections = store.collections;

  const existing =
    collectionId && store.collections[collectionId]?.type === mode
      ? store.collections[collectionId]
      : undefined;

  const [step, setStep] = useState<1 | 2>(1);
  const [name, setName] = useState(existing?.name ?? "");
  const [description, setDescription] = useState(existing?.description ?? "");
  const [heroImageObjectId, setHeroImageObjectId] = useState<string | null>(
    existing?.heroImageObjectId ?? null
  );

  // The kinds this collection is about — display names, keyed by norm() for
  // storage. Seeded from what it already declares.
  const [entityNames, setEntityNames] = useState<string[]>(() => {
    const keys = existing?.entityTypes ?? [];
    return keys.map((k) => roles[k]?.name ?? k);
  });
  const [newKind, setNewKind] = useState("");

  // Per-kind editable field order. `undefined` for a key = "not customised,
  // use the role's default" — materialised only once the user touches it,
  // so an untouched kind keeps following its role.
  const [views, setViews] = useState<Record<string, string[]>>(() => {
    const out: Record<string, string[]> = {};
    for (const [k, v] of Object.entries(existing?.fieldViews ?? {})) out[k] = [...v.shown];
    return out;
  });
  // Field definitions typed in the wizard, applied to the role on Save.
  const [newFieldDefs, setNewFieldDefs] = useState<Record<string, FacetField>>({});

  // Manual-only / smart-only extras.
  const [autoTagsDraft, setAutoTagsDraft] = useState(
    existing?.type === "manual" ? (existing.autoTags ?? []).join(", ") : ""
  );
  const [combinator, setCombinator] = useState<"AND" | "OR">(
    existing?.type === "smart" ? existing.rule.combinator : "AND"
  );
  const [rows, setRows] = useState<Row[]>(() => {
    if (existing?.type === "smart") {
      const flat = existing.rule.children.filter(
        (c): c is Row => c.kind === "condition" || c.kind === "similarity"
      );
      return flat.length > 0 ? flat : [newRow()];
    }
    return [newRow()];
  });

  const allObjects = useMemo(() => Object.values(objects), [objects]);

  /** The members this collection will hold — the population the entity
   * counts and hero picker describe. Smart: whatever the rule matches right
   * now. Manual: whatever's already been dropped in (empty for a new one). */
  const members = useMemo(() => {
    if (mode === "smart") {
      const rule: FilterGroup = { kind: "group", id: "preview", combinator, children: rows };
      return allObjects.filter((o) => evaluateGroup(rule, o, store.tagGroups, objects));
    }
    if (!existing) return [];
    return allObjects.filter((o) => o.manualCollectionIds.includes(existing.id));
  }, [mode, existing, allObjects, rows, combinator, store.tagGroups, objects]);

  const selectedKeys = entityNames.map((n) => norm(n));

  /** Kinds to OFFER as chips — a curated palette, never the raw `.role`
   * dump (Samuel, 2026-07-22: the wizard was listing sign / facade /
   * hungary / 1970s — tags the deleted "discover kinds" turned into empty
   * roles — and couldn't offer Typography). Two honest sources:
   *
   *   1. STARTER_KINDS — the curated palette, always offered (Photo,
   *      Typography, Book…), so a legitimate kind is pickable whether or
   *      not it already exists as a role.
   *   2. Existing roles that are REAL kinds — ones with a property package,
   *      pinned facets, or already declared on some collection. A role
   *      that's only ever been a tag-derived species (no fields, declared
   *      nowhere) is not a kind and isn't offered.
   *
   * No counts here on purpose: a per-rule tally during creation is noise
   * ("graphic design 4 — but only 4?") and belongs in the collection's own
   * entity nav, not this palette. */
  const declaredElsewhere = useMemo(() => {
    const set = new Set<string>();
    for (const c of Object.values(collections)) {
      for (const k of c.entityTypes ?? []) set.add(norm(k));
    }
    return set;
  }, [collections]);

  const offered = useMemo(() => {
    const isRealKind = (key: string, fieldsLen: number, pinned: number) =>
      key in CURATED_ROLE_FIELDS || fieldsLen > 0 || pinned > 0 || declaredElsewhere.has(key);

    const seen = new Set(selectedKeys);
    const out: string[] = [];
    const push = (displayName: string) => {
      const key = norm(displayName);
      if (seen.has(key)) return;
      seen.add(key);
      out.push(displayName);
    };

    for (const name of STARTER_KINDS) push(name);
    for (const r of Object.values(roles)) {
      if (isRealKind(norm(r.name), r.fields.length, r.primaryFacets?.length ?? 0)) push(r.name);
    }
    return out;
  }, [roles, selectedKeys, declaredElsewhere]);

  function toggleKind(displayName: string) {
    const key = norm(displayName);
    setEntityNames((cur) =>
      cur.some((n) => norm(n) === key) ? cur.filter((n) => norm(n) !== key) : [...cur, displayName]
    );
  }
  function addNewKind() {
    const n = newKind.trim();
    if (!n) return;
    if (!selectedKeys.includes(norm(n))) setEntityNames((cur) => [...cur, n]);
    setNewKind("");
  }

  /** Field names shown for a kind right now: the edited view, or the role's
   * default when untouched. */
  function shownFor(key: string): string[] {
    if (views[key]) return views[key];
    const role = roles[key];
    // The role may not exist yet for a just-typed kind — nothing to show.
    return resolveCollectionFields(existing, role).map((f) => f.name);
  }
  function setShown(key: string, next: string[]) {
    setViews((v) => ({ ...v, [key]: next }));
  }
  function hideField(key: string, fieldName: string) {
    setShown(
      key,
      shownFor(key).filter((n) => norm(n) !== norm(fieldName))
    );
  }
  function addField(key: string, rawName: string) {
    const fieldName = rawName.trim();
    if (!fieldName) return;
    if (shownFor(key).some((n) => norm(n) === norm(fieldName))) return;
    // If the role already has this field (a previously hidden one), just
    // re-show it — don't redefine. Otherwise stage a new select field.
    const roleHas = (roles[key]?.fields ?? []).some((f) => norm(f.name) === norm(fieldName));
    if (!roleHas) {
      setNewFieldDefs((d) => ({
        ...d,
        [`${key}::${norm(fieldName)}`]: { name: fieldName, type: "select", options: [] },
      }));
    }
    setShown(key, [...shownFor(key), fieldName]);
  }
  function moveField(key: string, from: number, to: number) {
    const list = [...shownFor(key)];
    if (to < 0 || to >= list.length) return;
    const [moved] = list.splice(from, 1);
    list.splice(to, 0, moved);
    setShown(key, list);
  }

  function save() {
    const trimmed = name.trim();
    if (!trimmed) return;
    const st = useStore.getState();

    // 1. Create or update the collection itself (the mode-specific half).
    let id: string;
    if (mode === "smart") {
      const cleanRows = rows.filter((r) => r.kind !== "condition" || r.value.trim() !== "");
      const rule: FilterGroup = {
        kind: "group",
        id: makeId("group"),
        combinator,
        children: cleanRows,
      };
      if (existing) {
        st.updateSmartCollection(existing.id, trimmed, rule);
        id = existing.id;
      } else {
        id = st.addSmartCollection(trimmed, rule, parentId);
      }
    } else {
      const autoTags = Array.from(
        new Set(autoTagsDraft.split(",").map((t) => t.trim()).filter(Boolean))
      );
      if (existing) {
        st.updateManualCollection(existing.id, { name: trimmed, autoTags });
        id = existing.id;
      } else {
        id = st.addManualCollection(trimmed, undefined, parentId);
        if (autoTags.length > 0) st.updateManualCollection(id, { autoTags });
      }
    }

    // 2. Shared: description, hero, declared kinds (seeds any new role).
    st.updateCollectionMeta(id, { description, heroImageObjectId });
    st.setCollectionEntityTypes(id, entityNames);

    // 3. Per kind: stage new fields onto the role (global), then set this
    // collection's view. Only for kinds the user actually touched — an
    // untouched kind keeps following its role's default.
    for (const displayName of entityNames) {
      const key = norm(displayName);
      const list = views[key];
      if (!list) continue;
      for (const fieldName of list) {
        const def = newFieldDefs[`${key}::${norm(fieldName)}`];
        if (def) st.addCollectionField(id, displayName, def);
      }
      st.setCollectionFieldView(id, displayName, list);
    }

    st.setSelectedView({ kind: "collection", collectionId: id });
    onClose();
  }

  const canNext = name.trim() !== "";
  const heroCandidates = members;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
      <div className="absolute inset-0 bg-black/30" onClick={onClose} />
      <div className="relative bg-panel rounded-card border border-line shadow-2xl w-full max-w-lg p-5 max-h-[88vh] overflow-y-auto">
        <div className="flex items-baseline justify-between mb-1">
          <div className="text-sm font-medium">
            {existing ? "Edit" : "New"} {mode === "smart" ? "smart collection" : "collection"}
          </div>
          <div className="font-mono text-[10px] uppercase tracking-[0.12em] text-muted">
            {step === 1 ? "1 · what is this" : "2 · what you care about"}
          </div>
        </div>

        {step === 1 ? (
          <>
            <p className="text-[12px] text-muted mb-3">
              {mode === "smart"
                ? "A saved search. It fills itself and updates live as tags and fields change."
                : "A collection you curate yourself — drag cards onto it. Never touches mymind."}
              {!existing && parentId && store.collections[parentId] && (
                <> Nested inside "{store.collections[parentId]!.name}".</>
              )}
            </p>

            <input
              autoFocus
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder={mode === "smart" ? "e.g. Swiss serif posters" : "e.g. Journalism"}
              className="w-full rounded-lg border border-line px-2.5 py-1.5 text-sm outline-none focus:border-accent"
            />
            <textarea
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              placeholder="Description (optional) — shown at the top, like an Are.na channel"
              rows={2}
              className="mt-2 w-full rounded-lg border border-line px-2.5 py-1.5 text-sm outline-none focus:border-accent resize-y"
            />

            {mode === "manual" && (
              <input
                value={autoTagsDraft}
                onChange={(e) => setAutoTagsDraft(e.target.value)}
                placeholder="Auto-tags (optional, comma-separated) — added to items dropped in"
                className="mt-2 w-full rounded-lg border border-line px-2.5 py-1.5 text-sm outline-none focus:border-accent"
              />
            )}

            {mode === "smart" && (
              <AdmissionRules
                rows={rows}
                setRows={setRows}
                combinator={combinator}
                setCombinator={setCombinator}
                allObjects={allObjects}
                tagGroups={store.tagGroups}
                objects={objects}
              />
            )}

            {/* What is this collection about? — the kinds it contains. */}
            <div className="mt-4">
              <div className="font-mono text-[10px] uppercase tracking-[0.12em] text-muted mb-1.5">
                What is this collection about?
              </div>
              <div className="flex flex-wrap gap-1.5">
                {entityNames.map((n) => (
                  <button
                    key={n}
                    onClick={() => toggleKind(n)}
                    className="inline-flex items-center gap-1 px-2.5 py-1 rounded-lg border border-ink bg-ink text-white text-[12px]"
                    title="Selected — click to remove"
                  >
                    {n.toLowerCase()}
                    <span aria-hidden className="opacity-70">
                      ×
                    </span>
                  </button>
                ))}
                {offered.map((n) => (
                  <button
                    key={n}
                    onClick={() => toggleKind(n)}
                    className="inline-flex items-center gap-1 px-2.5 py-1 rounded-lg border border-line text-muted hover:text-ink hover:border-ink/30 text-[12px]"
                  >
                    {n.toLowerCase()}
                  </button>
                ))}
              </div>
              <div className="mt-2 flex gap-1.5">
                <input
                  value={newKind}
                  onChange={(e) => setNewKind(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === "Enter") {
                      e.stopPropagation();
                      addNewKind();
                    }
                  }}
                  placeholder="+ a new kind of thing…"
                  className="flex-1 min-w-0 rounded-lg border border-dashed border-line px-2.5 py-1.5 text-[13px] outline-none focus:border-accent"
                />
              </div>
            </div>

            {mode === "smart" && (
              <div className="mt-3 font-mono text-[11px] text-muted">
                {members.length.toLocaleString()} item{members.length === 1 ? "" : "s"} match right
                now
              </div>
            )}
          </>
        ) : (
          <>
            <p className="text-[12px] text-muted mb-3">
              What do you care about for each kind? These are the properties this collection
              shows. Removing one hides it here only; adding one makes it available on that kind
              everywhere.
            </p>

            {entityNames.length === 0 && (
              <p className="font-mono text-[12px] text-muted/80 py-3">
                No kinds picked — go back and choose what this collection is about, or just save
                it as a plain folder.
              </p>
            )}

            <div className="space-y-4">
              {entityNames.map((displayName) => {
                const key = norm(displayName);
                const shown = shownFor(key);
                return (
                  <div key={displayName}>
                    <div className="text-[13px] text-ink mb-1.5">{displayName}</div>
                    {shown.length === 0 && (
                      <p className="font-mono text-[11px] text-muted/70 mb-1.5">
                        No properties yet — add one below.
                      </p>
                    )}
                    <div className="space-y-1">
                      {shown.map((fieldName, i) => (
                        <div
                          key={fieldName}
                          className="flex items-center gap-1.5 rounded-lg border border-line px-2 py-1.5"
                        >
                          <div className="flex flex-col leading-none text-muted/50">
                            <button
                              onClick={() => moveField(key, i, i - 1)}
                              disabled={i === 0}
                              className="hover:text-ink disabled:opacity-30 text-[9px]"
                              aria-label="Move up"
                            >
                              ▲
                            </button>
                            <button
                              onClick={() => moveField(key, i, i + 1)}
                              disabled={i === shown.length - 1}
                              className="hover:text-ink disabled:opacity-30 text-[9px]"
                              aria-label="Move down"
                            >
                              ▼
                            </button>
                          </div>
                          <span className="flex-1 min-w-0 text-[13px]">{fieldName}</span>
                          <button
                            onClick={() => hideField(key, fieldName)}
                            className="text-muted hover:text-ink px-1"
                            title="Hide in this collection (the kind keeps it)"
                            aria-label="Hide field"
                          >
                            ×
                          </button>
                        </div>
                      ))}
                    </div>
                    <AddFieldInline onAdd={(nm) => addField(key, nm)} />
                  </div>
                );
              })}
            </div>

            {existing && (
              <HeroImagePicker
                candidates={heroCandidates}
                selectedId={heroImageObjectId}
                onSelect={setHeroImageObjectId}
                emptyHint="Nothing with a picture in here yet."
              />
            )}
          </>
        )}

        {/* Footer */}
        <div className="mt-5 flex items-center justify-between">
          <button
            onClick={step === 1 ? onClose : () => setStep(1)}
            className="text-sm px-3 py-1.5 rounded-lg hover:bg-line/40 text-ink/70"
          >
            {step === 1 ? "Cancel" : "Back"}
          </button>
          {step === 1 ? (
            <button
              onClick={() => setStep(2)}
              disabled={!canNext}
              className="text-sm px-3 py-1.5 rounded-lg bg-ink text-white disabled:opacity-40"
            >
              Next
            </button>
          ) : (
            <button
              onClick={save}
              disabled={!canNext}
              className="text-sm px-3 py-1.5 rounded-lg bg-ink text-white disabled:opacity-40"
            >
              {existing ? "Save" : "Create collection"}
            </button>
          )}
        </div>
      </div>
    </div>
  );
}

function AddFieldInline({ onAdd }: { onAdd: (name: string) => void }) {
  const [value, setValue] = useState("");
  return (
    <div className="mt-1.5">
      <input
        value={value}
        onChange={(e) => setValue(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === "Enter") {
            e.stopPropagation();
            onAdd(value);
            setValue("");
          }
        }}
        placeholder="+ add a property…"
        className="w-full rounded-lg border border-dashed border-line px-2.5 py-1.5 text-[13px] outline-none focus:border-accent"
      />
    </div>
  );
}
