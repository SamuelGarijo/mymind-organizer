import { useMemo, useRef, useState } from "react";
import { useStore } from "../store";
import { matchesSmartCollection, norm } from "../lib/ruleEngine";
import { colorForGroup } from "../lib/tagGroupColor";
import { normalizeFacetSchema } from "../lib/facetSchema";
import { MYMIND_OWNED_FIELD_KEYS } from "../lib/mymindSync";
import { addMymindTag } from "../lib/mymindWrite";
import type { FacetField, ManualCollection } from "../types";

/** Drag payload for "drag a tag onto an empty facet field" — distinct from
 * Sidebar's DRAG_MIME (which carries an object id), since this drag never
 * leaves the open DetailPanel. */
const TAG_DRAG_MIME = "application/x-organizer-tag-value";

/** `summary` gets its own promoted spot below the title (real reading
 * content, not debug metadata) — everything else mymind-owned is debug-ish
 * and gets tucked into a collapsed section instead. */
const COLLAPSED_MYMIND_KEYS = (MYMIND_OWNED_FIELD_KEYS as readonly string[]).filter(
  (k) => k !== "summary"
);

/** Local-only for now — see DetailPanel's description field for why this
 * doesn't sync to mymind (no content-write endpoint is authorized). */
const DESCRIPTION_KEY = "description";

export function DetailPanel({ objectId, onClose }: { objectId: string; onClose: () => void }) {
  const state = useStore();
  const object = state.objects[objectId];
  const [tagDraft, setTagDraft] = useState("");
  const [dragOverField, setDragOverField] = useState<string | null>(null);
  const [tagPushError, setTagPushError] = useState<string | null>(null);
  // Value a facet field held when it was focused — compared against the
  // value on blur so a push to mymind only fires for a value the user
  // actually finished changing, not on every keystroke.
  const focusValues = useRef<Record<string, string>>({});

  const smartMatches = useMemo(() => {
    if (!object) return [];
    return Object.values(state.collections).filter(
      (c) => c.type === "smart" && matchesSmartCollection(c, object, state.tagGroups)
    );
  }, [state.collections, state.tagGroups, object]);

  const manualMemberships = useMemo(() => {
    if (!object) return [];
    return object.manualCollectionIds
      .map((id) => state.collections[id])
      .filter((c): c is ManualCollection => c?.type === "manual");
  }, [state.collections, object]);

  /** Collections this object belongs to that define a facet schema. */
  const facetSections = useMemo(
    () => manualMemberships.filter((c) => normalizeFacetSchema(c).length > 0),
    [manualMemberships]
  );

  /** Field keys owned by a facet schema of any collection this object is in
   * — everything else in `fields` is read-only metadata (e.g. from mymind). */
  const facetOwnedKeys = useMemo(() => {
    const set = new Set<string>();
    for (const c of facetSections) for (const f of normalizeFacetSchema(c)) set.add(f.name);
    return set;
  }, [facetSections]);

  /** mymind-owned but debug-ish (id/url/timestamps) — tucked into a
   * collapsed section so it doesn't compete with actual content. */
  const mymindMetadataEntries = useMemo(() => {
    if (!object) return [];
    return Object.entries(object.fields).filter(([key]) => COLLAPSED_MYMIND_KEYS.includes(key));
  }, [object]);

  /** Anything left over — not facet-owned, not summary/description (each
   * promoted to their own section), not collapsed mymind debug metadata.
   * Expected to be empty in practice; kept as a fallback for odd fields. */
  const otherMetadataEntries = useMemo(() => {
    if (!object) return [];
    return Object.entries(object.fields).filter(
      ([key]) =>
        !facetOwnedKeys.has(key) &&
        !COLLAPSED_MYMIND_KEYS.includes(key) &&
        key !== "summary" &&
        key !== DESCRIPTION_KEY
    );
  }, [object, facetOwnedKeys]);

  const knownGroups = useMemo(
    () => Array.from(new Set(Object.values(state.tagGroups))).sort(),
    [state.tagGroups]
  );

  if (!object) return null;

  function addTag() {
    const value = tagDraft.trim();
    if (!value || object.tags.includes(value)) {
      setTagDraft("");
      return;
    }
    state.updateObject(object.id, { tags: [...object.tags, value] });
    setTagDraft("");
  }

  function removeTag(tag: string) {
    state.updateObject(object.id, { tags: object.tags.filter((t) => t !== tag) });
  }

  function setFieldValue(key: string, value: string) {
    state.updateObject(object.id, { fields: { ...object.fields, [key]: value } });
  }

  /**
   * Pushes a facet value to mymind as a plain manual tag — the one write
   * operation this app performs, and only on blur (see lib/mymindWrite.ts):
   * a value that's still being typed is never sent, and once sent it can't
   * be un-sent (no DELETE), so this only fires when the value on blur
   * actually differs from what it was when the field was focused.
   */
  async function maybePushFacetTag(fieldName: string, newValue: string) {
    if (object.source !== "mymind") return;
    const priorValue = focusValues.current[fieldName] ?? "";
    const trimmed = newValue.trim();
    if (!trimmed || trimmed === priorValue.trim()) return;

    try {
      await addMymindTag(object.id, trimmed);
      // Optimistic: reflect it locally now rather than waiting for the next
      // sync to pull it back — mymind already has it, this just avoids a
      // moment where our own tag list looks stale.
      if (!object.tags.includes(trimmed)) {
        state.updateObject(object.id, { tags: [...object.tags, trimmed] });
      }
      setTagPushError(null);
    } catch (err) {
      setTagPushError(`Couldn't sync "${trimmed}" to mymind as a tag: ${(err as Error).message}`);
    }
  }

  /** A field only accepts a dropped tag while it's empty — dropping onto an
   * already-filled field would silently overwrite it, so it's a no-op
   * instead. Date fields never accept one: a raw tag string is essentially
   * never a valid date, so there's no realistic match to offer. */
  function fieldAcceptsDrop(field: FacetField): boolean {
    return field.type !== "date" && !object.fields[field.name];
  }

  function handleFieldDrop(field: FacetField, e: React.DragEvent) {
    e.preventDefault();
    setDragOverField(null);
    const tag = e.dataTransfer.getData(TAG_DRAG_MIME);
    if (!tag) return;

    if (field.type === "select") {
      // Only accept a value the schema actually allows — otherwise a
      // <select> would silently show as blank despite holding that value.
      const match = (field.options ?? []).find((opt) => norm(opt) === norm(tag));
      if (!match) return;
      state.moveTagToField(object.id, tag, field.name, match);
      return;
    }
    state.moveTagToField(object.id, tag, field.name, tag);
  }

  return (
    <div className="fixed inset-0 z-40 flex justify-end">
      <div className="absolute inset-0 bg-black/30" onClick={onClose} />
      <div className="relative w-full max-w-md h-full bg-panel border-l border-line shadow-2xl overflow-y-auto">
        <div className="sticky top-0 bg-panel border-b border-line px-4 py-3 flex items-center justify-between">
          <span className="text-[12px] font-medium text-muted uppercase tracking-wide">
            Item details
          </span>
          <button onClick={onClose} className="text-muted hover:text-ink text-lg leading-none">
            ×
          </button>
        </div>

        {object.imageUrl && (
          <img src={object.imageUrl} alt={object.title} className="w-full h-auto" />
        )}

        {object.source === "mymind" && object.embedding && (
          <div className="px-4 pt-4">
            <button
              onClick={() => {
                state.setSelectedView({ kind: "similar", objectId: object.id });
                onClose();
              }}
              className="w-full text-sm px-3 py-1.5 rounded-lg border border-line hover:bg-line/40"
              title="Ranks your library by mymind embedding similarity — computed locally, no network call"
            >
              ✦ Similar to this
            </button>
          </div>
        )}

        <div className="p-4 space-y-5">
          <div>
            <label className="text-[11px] uppercase tracking-wide text-muted">Title</label>
            <input
              value={object.title}
              onChange={(e) => state.updateObject(object.id, { title: e.target.value })}
              className="mt-1 w-full rounded-lg border border-line px-2.5 py-1.5 text-sm outline-none focus:border-accent"
            />
          </div>

          {object.fields.summary && (
            <p className="text-sm text-ink/80 leading-relaxed">{object.fields.summary}</p>
          )}

          <div>
            <label className="text-[11px] uppercase tracking-wide text-muted">Tags</label>
            <p className="text-[11px] text-muted/80 mt-0.5 mb-1.5">
              Hover or tab onto a tag to group it (e.g. "dog/caniche") — tints it and enables
              filtering by that group in smart collections. Groups are local to this app, not
              mymind.
            </p>
            <div>
              {object.tags.map((t) => {
                const group = state.tagGroups[norm(t)] ?? "";
                const color = group ? colorForGroup(group).text : undefined;
                return (
                  <div key={t} className="group/tagrow relative flex items-center gap-1.5 py-1">
                    <span
                      draggable
                      onDragStart={(e) => {
                        e.dataTransfer.setData(TAG_DRAG_MIME, t);
                        e.dataTransfer.effectAllowed = "move";
                      }}
                      title="Drag onto an empty facet field below to move it there"
                      className="flex-1 min-w-0 truncate text-[13px] cursor-grab active:cursor-grabbing"
                      style={color ? { color } : undefined}
                    >
                      {group && (
                        <span className="hidden text-muted group-hover/tagrow:inline group-focus-within/tagrow:inline">
                          {group}/
                        </span>
                      )}
                      {t}
                    </span>
                    <input
                      defaultValue={group}
                      onBlur={(e) => state.setTagGroup(t, e.target.value)}
                      onKeyDown={(e) => e.key === "Enter" && (e.target as HTMLInputElement).blur()}
                      placeholder="group"
                      list="known-groups"
                      className="w-0 opacity-0 focus:w-16 focus:opacity-100 group-hover/tagrow:w-16 group-hover/tagrow:opacity-100 transition-all duration-150 text-[11px] border-b border-line/40 outline-none bg-transparent"
                    />
                    <button
                      onClick={() => removeTag(t)}
                      className="opacity-0 group-hover/tagrow:opacity-100 focus:opacity-100 text-muted hover:text-ink px-1"
                      aria-label={`Remove tag ${t}`}
                    >
                      ×
                    </button>
                  </div>
                );
              })}
              <datalist id="known-groups">
                {knownGroups.map((g) => (
                  <option key={g} value={g} />
                ))}
              </datalist>
            </div>
            <div className="mt-2 flex gap-1.5">
              <input
                value={tagDraft}
                onChange={(e) => setTagDraft(e.target.value)}
                onKeyDown={(e) => e.key === "Enter" && addTag()}
                placeholder="Add tag…"
                className="flex-1 rounded-lg border border-line px-2.5 py-1.5 text-sm outline-none focus:border-accent"
              />
              <button
                onClick={addTag}
                className="rounded-lg border border-line px-3 text-sm hover:bg-line/40"
              >
                Add
              </button>
            </div>
          </div>

          <div>
            <label className="text-[11px] uppercase tracking-wide text-muted">Description</label>
            <p className="text-[11px] text-muted/80 mt-0.5 mb-1.5">
              Local to this app for now — mymind has no writable description endpoint we're
              allowed to use, so this doesn't sync there yet.
            </p>
            <textarea
              key={object.id}
              defaultValue={object.fields[DESCRIPTION_KEY] ?? ""}
              onBlur={(e) => setFieldValue(DESCRIPTION_KEY, e.target.value)}
              placeholder="Add a description…"
              rows={3}
              className="w-full rounded-lg border border-line px-2.5 py-1.5 text-sm outline-none focus:border-accent resize-y"
            />
          </div>

          {facetSections.map((collection) => (
            <div key={collection.id}>
              <label className="text-[11px] uppercase tracking-wide text-muted">
                📁 {collection.name} — facets
              </label>
              <p className="text-[11px] text-muted/80 mt-0.5 mb-1.5">
                This collection's schema. Edit the schema itself via ✎ on the collection in the
                sidebar.
                {object.source === "mymind" &&
                  " Finished values sync to mymind as a plain tag when you leave the field — mymind has no way for us to remove a tag once sent, so double-check before moving on."}
              </p>
              <div className="space-y-1.5">
                {normalizeFacetSchema(collection).map((field) => {
                  const acceptsDrop = fieldAcceptsDrop(field);
                  return (
                  <div
                    key={field.name}
                    onDragOver={
                      acceptsDrop
                        ? (e) => {
                            e.preventDefault();
                            setDragOverField(field.name);
                          }
                        : undefined
                    }
                    onDragLeave={acceptsDrop ? () => setDragOverField(null) : undefined}
                    onDrop={acceptsDrop ? (e) => handleFieldDrop(field, e) : undefined}
                    className={[
                      "flex items-center gap-1.5 rounded-lg",
                      dragOverField === field.name ? "ring-2 ring-accent ring-offset-1 ring-offset-panel" : "",
                    ].join(" ")}
                  >
                    <span
                      className="text-[12px] text-muted w-24 shrink-0 truncate"
                      title={field.name}
                    >
                      {field.name}
                    </span>
                    {field.type === "select" ? (
                      <select
                        value={object.fields[field.name] ?? ""}
                        onChange={(e) => setFieldValue(field.name, e.target.value)}
                        onFocus={(e) => {
                          focusValues.current[field.name] = e.target.value;
                        }}
                        onBlur={(e) => void maybePushFacetTag(field.name, e.target.value)}
                        className="flex-1 rounded-lg border border-line px-2.5 py-1 text-sm bg-panel outline-none focus:border-accent"
                      >
                        <option value="">—</option>
                        {(field.options ?? []).map((opt) => (
                          <option key={opt} value={opt}>
                            {opt}
                          </option>
                        ))}
                      </select>
                    ) : (
                      <input
                        type={field.type === "date" ? "date" : "text"}
                        value={object.fields[field.name] ?? ""}
                        onChange={(e) => setFieldValue(field.name, e.target.value)}
                        onFocus={(e) => {
                          focusValues.current[field.name] = e.target.value;
                        }}
                        onBlur={(e) => void maybePushFacetTag(field.name, e.target.value)}
                        placeholder={field.type === "date" ? undefined : "—"}
                        className="flex-1 rounded-lg border border-line px-2.5 py-1 text-sm outline-none focus:border-accent"
                      />
                    )}
                  </div>
                  );
                })}
              </div>
            </div>
          ))}

          {tagPushError && (
            <div className="flex items-start justify-between gap-2 text-[12px] text-red-700 bg-red-50 border border-red-200 rounded-lg px-2.5 py-1.5">
              <span>{tagPushError}</span>
              <button
                onClick={() => setTagPushError(null)}
                className="text-red-700/60 hover:text-red-700 shrink-0"
                aria-label="Dismiss"
              >
                ×
              </button>
            </div>
          )}

          {otherMetadataEntries.length > 0 && (
            <div>
              <label className="text-[11px] uppercase tracking-wide text-muted">Metadata</label>
              <div className="mt-1 space-y-1">
                {otherMetadataEntries.map(([key, value]) => (
                  <div key={key} className="flex items-baseline gap-1.5 text-[12px]">
                    <span className="text-muted w-24 shrink-0 truncate" title={key}>
                      {key}
                    </span>
                    <span className="text-ink/80 truncate min-w-0" title={value}>
                      {value}
                    </span>
                  </div>
                ))}
              </div>
            </div>
          )}

          {mymindMetadataEntries.length > 0 && (
            <details className="text-[12px]">
              <summary className="text-[11px] uppercase tracking-wide text-muted cursor-pointer select-none">
                mymind metadata
              </summary>
              <div className="mt-1.5 space-y-1">
                {mymindMetadataEntries.map(([key, value]) => (
                  <div key={key} className="flex items-baseline gap-1.5">
                    <span className="text-muted w-20 shrink-0 truncate" title={key}>
                      {key}
                    </span>
                    {key === "source_url" ? (
                      <a
                        href={value}
                        target="_blank"
                        rel="noreferrer"
                        className="text-accent hover:underline truncate min-w-0"
                        title={value}
                      >
                        {value}
                      </a>
                    ) : (
                      <span className="text-ink/80 truncate min-w-0" title={value}>
                        {value}
                      </span>
                    )}
                  </div>
                ))}
              </div>
            </details>
          )}

          <div className="pt-3 border-t border-line space-y-2">
            <div>
              <div className="text-[11px] uppercase tracking-wide text-muted mb-1">
                Matches smart collections
              </div>
              {smartMatches.length === 0 ? (
                <div className="text-[12px] text-muted/70">None</div>
              ) : (
                <div className="flex flex-wrap gap-1">
                  {smartMatches.map((c) => (
                    <span key={c.id} className="tag-chip">
                      ⚡ {c.name}
                    </span>
                  ))}
                </div>
              )}
            </div>
            <div>
              <div className="text-[11px] uppercase tracking-wide text-muted mb-1">
                In manual collections
              </div>
              {manualMemberships.length === 0 ? (
                <div className="text-[12px] text-muted/70">
                  None — drag this card onto a folder in the sidebar.
                </div>
              ) : (
                <div className="flex flex-wrap gap-1">
                  {manualMemberships.map((c) => (
                    <span key={c.id} className="tag-chip gap-1">
                      📁 {c.name}
                      <button
                        onClick={() => state.removeFromManualCollection(object.id, c.id)}
                        className="text-muted hover:text-ink"
                        aria-label={`Remove from ${c.name}`}
                      >
                        ×
                      </button>
                    </span>
                  ))}
                </div>
              )}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
