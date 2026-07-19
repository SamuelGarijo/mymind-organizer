import { useEffect, useMemo, useRef, useState } from "react";
import { useShallow } from "zustand/react/shallow";
import { useStore } from "../store";
import { matchesSmartCollection, norm } from "../lib/ruleEngine";
import { colorForGroup } from "../lib/tagGroupColor";
import { suggestRole } from "../lib/roleSuggestion";
import {
  BLOB_TYPE_KEY,
  DESCRIPTION_KEY,
  MYMIND_OWNED_FIELD_KEYS,
  NOTE_CONTENT_KEY,
  NOTE_ID_KEY,
  asFieldString,
} from "../lib/mymindSync";
import {
  addMymindTag,
  createMymindNote,
  updateMymindContent,
  updateMymindNote,
} from "../lib/mymindWrite";
import { buildDownloadFilename } from "../lib/downloadFilename";
import { rankByHybridSimilarity } from "../lib/hybridSimilarity";
import { viewTitle } from "../lib/viewLabel";
import { RolePackageModal } from "./RolePackageModal";
import { DRAG_MIME, objectDragProps } from "../lib/objectDrag";
import type { DesignObject, FacetField, ManualCollection } from "../types";

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

/** `source_url` is data from mymind, rendered as a real `<a href>` — a
 * `javascript:` (or other non-http) URL saved there would execute on click
 * otherwise. Low real-world risk (it's your own account's data), but the
 * fix costs nothing: only ever link out to http(s). */
function isSafeHref(value: string): boolean {
  try {
    return ["http:", "https:"].includes(new URL(value).protocol);
  } catch {
    return false;
  }
}

/** Plain-text display for a metadata entry that might be a multi-select
 * field's array (issue #99) — e.g. an orphaned value left behind after a
 * role's field package drops that field. mymind's own metadata is always a
 * plain string already, so this is a no-op for every other caller. */
function formatFieldValue(value: string | string[]): string {
  return Array.isArray(value) ? value.join(", ") : value;
}

/** Similar-strip thumbnail with an honest failure state — a thumb whose
 * image 404s falls back to its title, never a broken-image glyph. */
function StripThumb({ object }: { object: { imageUrl: string; title: string } }) {
  const [failed, setFailed] = useState(false);
  return object.imageUrl && !failed ? (
    <img
      src={object.imageUrl}
      alt=""
      className="w-full h-full object-cover"
      onError={() => setFailed(true)}
    />
  ) : (
    <div className="w-full h-full flex items-center justify-center text-[9px] leading-tight text-muted bg-line/10 p-1 text-center overflow-hidden">
      {object.title}
    </div>
  );
}

export function DetailPanel({
  objectId,
  onClose,
  layout = "side",
  onLayoutChange,
  contextObjects = [],
  onOpenCarousel,
  carouselOpen = false,
  onPublishArena,
}: {
  objectId: string;
  onClose: () => void;
  /** Display mode (issue #108) — "side" keeps the original docked slide-
   * over as the default; "centered" renders the exact same content in a
   * larger, centered modal instead, so the image gets more room. A user
   * preference (Preferences menu), also switchable right here from the
   * panel itself (a small inline switch + ⌘L shortcut, issue follow-up). */
  layout?: "side" | "centered";
  onLayoutChange: (layout: "side" | "centered") => void;
  /** The current view's own object pool (App.tsx's baseObjects) — already
   * scoped to whatever collection is active, or the whole library in the
   * All-items/Unclassified views. Powers the "more from {dominant tag}"
   * row (issue #89): the tag counted here is whichever of this object's
   * own tags is most common among the OTHER objects in this same scope,
   * so the suggestion is always contextual to what's already on screen. */
  contextObjects?: DesignObject[];
  /** Opens the fullscreen media carousel for this object — clicking the
   * preview image/video/pdf itself triggers this now, rather than
   * "carousel" being a separate persistent display mode you had to opt
   * into from Settings ahead of time. */
  onOpenCarousel: (id: string) => void;
  /** True while the carousel overlay (rendered on top by App.tsx) is open —
   * its own Escape/keyboard handling should win, not this panel's, or
   * Escape would close both at once instead of just the overlay on top. */
  carouselOpen?: boolean;
  /** Opens the single-object Are.na publisher for this object (export
   * follow-up #4 — objects are actionable wherever they're rendered). */
  onPublishArena: (id: string) => void;
}) {
  // Shallow-selected — while a detail panel is open, typing in the main
  // search box (or anything else touching unrelated store fields) shouldn't
  // re-render it.
  const state = useStore(
    useShallow((s) => ({
      objects: s.objects,
      collections: s.collections,
      tagGroups: s.tagGroups,
      roles: s.roles,
      updateObject: s.updateObject,
      addObjectTag: s.addObjectTag,
      removeObjectTag: s.removeObjectTag,
      recordUserValue: s.recordUserValue,
      moveTagToField: s.moveTagToField,
      setTagGroup: s.setTagGroup,
      setObjectRole: s.setObjectRole,
      setSelectedView: s.setSelectedView,
      openDetail: s.openDetail,
      setFacetFieldFilter: s.setFacetFieldFilter,
      clearFacetTags: s.clearFacetTags,
      toggleFacetTag: s.toggleFacetTag,
      assignToManualCollection: s.assignToManualCollection,
      removeFromManualCollection: s.removeFromManualCollection,
      addManualCollection: s.addManualCollection,
      deleteObjectLocally: s.deleteObjectLocally,
    }))
  );
  const object = state.objects[objectId];
  const [tagDraft, setTagDraft] = useState("");
  // Tag pill whose actions (group / remove) are currently open — click a
  // pill to toggle. One editor row below the pill cloud, never a
  // hover-revealed control floating over other UI (the old hover input
  // could visually collide with the panel's close button).
  const [activeTag, setActiveTag] = useState<string | null>(null);
  // Select-type facet whose full option list is expanded past the visible
  // cap ("see more") — reset when switching objects.
  const [expandedOptionsField, setExpandedOptionsField] = useState<string | null>(null);
  const [dragOverField, setDragOverField] = useState<string | null>(null);
  // "Add new option" draft for a select/multi-select facet — lets a field
  // with zero (or incomplete) predefined options still work like a select,
  // not a bare text box: type a value, it becomes a real option going
  // forward for every object with this role.
  const [newOptionField, setNewOptionField] = useState<string | null>(null);
  const [newOptionDraft, setNewOptionDraft] = useState("");
  // "Add to a collection" picker under "In manual collections" — pick an
  // existing collection this object isn't already in, or type a name that
  // doesn't match one to create it and add in one step (same creatable
  // pattern as a facet's "+ new" option above).
  const [addingToCollection, setAddingToCollection] = useState(false);
  const [addCollectionDraft, setAddCollectionDraft] = useState("");
  // "New type…" input draft in the item-type picker, and whether the
  // role's field-package editor modal is open.
  const [roleDraft, setRoleDraft] = useState("");
  const [editingRoleFields, setEditingRoleFields] = useState(false);
  // Empty role fields are hidden by default (issue #101 — dead-looking rows
  // for fields nothing has filled in yet) but stay reachable behind this
  // toggle, since typing/picking a value here is still the only way to set
  // one until #102's drag-to-classify buckets exist.
  const [showEmptyRoleFields, setShowEmptyRoleFields] = useState(false);
  const [tagPushError, setTagPushError] = useState<string | null>(null);
  const [notePushError, setNotePushError] = useState<string | null>(null);
  const [contentPushError, setContentPushError] = useState<string | null>(null);
  // Value a facet field held when it was focused — compared against the
  // value on blur so a push to mymind only fires for a value the user
  // actually finished changing, not on every keystroke.
  const focusValues = useRef<Record<string, string>>({});
  // The grid deliberately uses a small, capped thumbnail (object.imageUrl —
  // fine for thousands of cards at once). Here, where there's exactly one
  // image to show and it's worth looking closely at, try the original blob
  // first and only fall back if it 404s/422s (not every object has one —
  // e.g. a saved webpage has no uploaded attachment) or fails to load.
  const [blobFailed, setBlobFailed] = useState(false);
  const [defaultThumbFailed, setDefaultThumbFailed] = useState(false);
  // Terminal state: every rung of the fallback chain failed. Render nothing
  // at all — a broken-image glyph is chrome debris, never content.
  const [coverFailed, setCoverFailed] = useState(false);
  // Panel root for the focus trap below — Tab/Shift+Tab cycles between the
  // first and last focusable element inside instead of escaping into the
  // grid behind it (issue #116).
  const panelRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    panelRef.current?.focus();
  }, [objectId]);
  useEffect(() => {
    function handleKeyDown(e: KeyboardEvent) {
      if (carouselOpen) return;
      if (e.key === "Escape") {
        onClose();
        return;
      }
      // ⌘L / Ctrl+L toggles side <-> centered without leaving the keyboard —
      // the same switch as the inline button in the panel header.
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "l") {
        e.preventDefault();
        onLayoutChange(layout === "side" ? "centered" : "side");
        return;
      }
      if (e.key !== "Tab" || !panelRef.current) return;
      const focusable = panelRef.current.querySelectorAll<HTMLElement>(
        'a[href], button:not([disabled]), input:not([disabled]), textarea:not([disabled]), select:not([disabled]), [tabindex]:not([tabindex="-1"])'
      );
      if (focusable.length === 0) return;
      const first = focusable[0];
      const last = focusable[focusable.length - 1];
      if (e.shiftKey && document.activeElement === first) {
        e.preventDefault();
        last.focus();
      } else if (!e.shiftKey && document.activeElement === last) {
        e.preventDefault();
        first.focus();
      }
    }
    document.addEventListener("keydown", handleKeyDown);
    return () => document.removeEventListener("keydown", handleKeyDown);
  }, [onClose, onLayoutChange, layout, carouselOpen]);
  useEffect(() => {
    setBlobFailed(false);
    setDefaultThumbFailed(false);
    setCoverFailed(false);
    setActiveTag(null);
    setExpandedOptionsField(null);
    setRoleDraft("");
    setEditingRoleFields(false);
    setShowEmptyRoleFields(false);
    setAddingToCollection(false);
    setAddCollectionDraft("");
  }, [objectId]);

  const smartMatches = useMemo(() => {
    if (!object) return [];
    return Object.values(state.collections).filter(
      (c) => c.type === "smart" && matchesSmartCollection(c, object, state.tagGroups, state.objects)
    );
  }, [state.collections, state.tagGroups, object]);

  const manualMemberships = useMemo(() => {
    if (!object) return [];
    return object.manualCollectionIds
      .map((id) => state.collections[id])
      .filter((c): c is ManualCollection => c?.type === "manual");
  }, [state.collections, object]);

  // Existing manual collections this object hasn't joined yet — offered as
  // one-click options in the "add to a collection" picker below, alongside
  // typing a brand-new name.
  const availableManualCollections = useMemo(() => {
    if (!object) return [];
    return Object.values(state.collections).filter(
      (c): c is ManualCollection => c.type === "manual" && !object.manualCollectionIds.includes(c.id)
    );
  }, [state.collections, object]);

  function confirmAddToCollection() {
    const name = addCollectionDraft.trim();
    setAddingToCollection(false);
    setAddCollectionDraft("");
    if (!name || !object) return;
    const existing = availableManualCollections.find((c) => norm(c.name) === norm(name));
    const id = existing ? existing.id : state.addManualCollection(name);
    state.assignToManualCollection(object.id, id);
  }

  /** "More from {dominant tag}" (issue #89) — whichever of this object's
   * own tags is most common among the OTHER objects already in view
   * (contextObjects is App.tsx's own view-scoped pool, so this is the
   * collection's other members when inside a collection, or the whole
   * library in the All-items/Unclassified views — no separate "am I in a
   * collection" branch needed, the scoping already happened upstream). */
  const dominantTag = useMemo(() => {
    if (!object || object.tags.length === 0) return null;
    const ownTags = new Set(object.tags.map(norm));
    const counts = new Map<string, number>();
    for (const other of contextObjects) {
      if (other.id === object.id) continue;
      for (const t of other.tags) {
        if (ownTags.has(norm(t))) counts.set(t, (counts.get(t) ?? 0) + 1);
      }
    }
    let best: { tag: string; count: number } | null = null;
    for (const [tag, count] of counts) {
      if (count > 0 && (!best || count > best.count)) best = { tag, count };
    }
    return best;
  }, [contextObjects, object]);

  /** "Same vibe" strip (issue #88) — the same local hybrid score the full
   * "similar" view (#23) ranks by, capped to a handful for an inline
   * preview. Scoped to the whole library (not contextObjects, which is only
   * this view's own pool) since similarity is a library-wide question, same
   * as the full view it links out to. */
  const similarStrip = useMemo(() => {
    if (!object) return [];
    const allObjects = Object.values(state.objects);
    const candidates = allObjects.filter((o) => o.id !== object.id);
    const ranked = rankByHybridSimilarity(object, candidates, allObjects, 8);
    return ranked.map((r) => state.objects[r.id]).filter((o): o is DesignObject => !!o);
  }, [object, state.objects]);

  /** Filters the current view down to just this tag (replacing any other
   * tag filters) and closes the panel so the filtered results are visible
   * right away — a cheaper, in-place cousin of #86's "temporary view"
   * (that one switches to All-items and a field value; this one stays in
   * whatever view is already open and uses a tag). */
  function viewMoreOfTag(tag: string) {
    state.clearFacetTags();
    state.toggleFacetTag(tag);
    onClose();
  }

  /** The object's item-type field package (issue #84) — fields come from
   * the role, not from any collection the object happens to sit in. */
  const rolePackageFields = useMemo<FacetField[]>(() => {
    if (!object?.role) return [];
    return state.roles[norm(object.role)]?.fields ?? [];
  }, [object, state.roles]);

  /** Fields a raw tag could actually become a value of (issue #80's
   * "promote a category/value tag to a facet" ask) — date excluded, same
   * reasoning as fieldAcceptsDrop: a tag string is never a realistic date. */
  const promotableFields = useMemo(
    () => rolePackageFields.filter((f) => f.type !== "date"),
    [rolePackageFields]
  );

  /** Every known item type, for the picker — display names, sorted. */
  const knownRoles = useMemo(
    () => Object.values(state.roles).map((d) => d.name).sort((a, b) => a.localeCompare(b)),
    [state.roles]
  );

  /** Field keys owned by the object's role package — everything else in
   * `fields` is read-only metadata (from mymind, or orphaned values from a
   * role/schema this object no longer carries). */
  const facetOwnedKeys = useMemo(() => {
    const set = new Set<string>();
    for (const f of rolePackageFields) set.add(f.name);
    return set;
  }, [rolePackageFields]);

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
        key !== DESCRIPTION_KEY &&
        key !== NOTE_ID_KEY &&
        key !== NOTE_CONTENT_KEY
    );
  }, [object, facetOwnedKeys]);

  const knownGroups = useMemo(
    () => Array.from(new Set(Object.values(state.tagGroups))).sort(),
    [state.tagGroups]
  );

  if (!object) return null;

  // Try the original blob, then mymind's own default thumbnail, then the
  // small capped one we already have as a last resort — only for
  // mymind-sourced objects (sample/local ones have no blob to reach for).
  // mymind's CDN doesn't always report the blob's real Content-Type
  // correctly (confirmed empirically — an object once came back as
  // `application/json` with a genuine JPEG body), so whenever we know it
  // from sync (BLOB_TYPE_KEY, straight from the object's own `blob.type`),
  // pass it through and let the proxy override the upstream header with it.
  // A mymind Note has no real uploaded image — its own thumbnail endpoint
  // just 404s (or returns a generic placeholder), so skip the whole
  // image/download-original block rather than showing a broken fetch chain.
  // The note's real content, shown below, is the actual "image" here.
  const isNote = object.fields.entity_type === "Note";
  // NOTE_CONTENT_KEY isn't Note-exclusive — mymind's "Content" entityType
  // (saved snippets/clippings) carries the same real-text `content` field
  // with no image either (confirmed empirically 2026-07-08, 0/16 sampled had
  // a blob). Only Notes are writable back to mymind (PUT /objects/:id/content
  // 422s for any other type), so this shows read-only for everything else.
  const hasRealContent = !!object.fields[NOTE_CONTENT_KEY];
  const blobType = asFieldString(object.fields[BLOB_TYPE_KEY]);
  const blobTypeParam = blobType ? `?type=${encodeURIComponent(blobType)}` : "";
  const detailImageSrc =
    object.source === "mymind"
      ? !blobFailed
        ? `/api/mymind/blob/${object.id}${blobTypeParam}`
        : !defaultThumbFailed
        ? `/api/mymind/image/${object.id}`
        : object.imageUrl
      : object.imageUrl;

  function handleDelete() {
    const ok = window.confirm(
      object.source === "mymind"
        ? "Delete this item from The Organizer? It stays in mymind — this only removes it here, and it won't come back on the next sync."
        : "Delete this item from The Organizer? This can't be undone."
    );
    if (!ok) return;
    state.deleteObjectLocally(object.id);
    onClose();
  }

  function addTag() {
    const value = tagDraft.trim();
    if (!value || object.tags.includes(value)) {
      setTagDraft("");
      return;
    }
    state.addObjectTag(object.id, value);
    setTagDraft("");
    void pushNewTag(value);
  }

  /** Pushes a freshly-added plain tag to mymind — a deliberate "Add" click
   * (or Enter), never a live-typing field, so this fires immediately rather
   * than waiting for blur like maybePushFacetTag. */
  async function pushNewTag(value: string) {
    if (object.source !== "mymind") return;
    try {
      await addMymindTag(object.id, value);
      setTagPushError(null);
    } catch (err) {
      setTagPushError(`Couldn't sync "${value}" to mymind as a tag: ${(err as Error).message}`);
    }
  }

  function removeTag(tag: string) {
    state.removeObjectTag(object.id, tag);
  }

  function setFieldValue(key: string, value: string | string[]) {
    // A multi-select field that's lost its last value goes back to being
    // absent rather than an explicit [] — keeps every existing "is this
    // field set?" falsy check (below, and in store.ts) working unchanged
    // for both select's "" and multi-select's array.
    if (Array.isArray(value) && value.length === 0) {
      const { [key]: _removed, ...rest } = object.fields;
      state.updateObject(object.id, { fields: rest });
      return;
    }
    state.updateObject(object.id, { fields: { ...object.fields, [key]: value } });
  }

  /** Click-a-chip path for multi-select facets — toggles one value in/out
   * of the field's array. Mirrors selectFacetOption's mymind-push timing
   * (only on the gesture that actually adds a value; removing one doesn't
   * push anything, same as clearing a select — there's no tag "un-push"). */
  function toggleMultiSelectOption(field: FacetField, value: string) {
    const raw = object.fields[field.name];
    const values = Array.isArray(raw) ? raw : [];
    const adding = !values.includes(value);
    setFieldValue(field.name, adding ? [...values, value] : values.filter((v) => v !== value));
    if (adding) {
      state.recordUserValue(object.id, value);
      void maybePushFacetTag(field.name, value);
    }
  }

  /** Typed-in-a-new-option path — a select/multi-select field works like a
   * real select even with zero predefined options: this registers the value
   * as an option on the role's field package (so it shows up as a chip for
   * every object with this role from now on) and assigns it here, same as
   * picking an existing chip would. */
  /** Sends a tag into a role field as its value (issue #80's "promote a
   * raw tag to a facet value" ask) — a discoverable, click-driven sibling
   * to the existing drag-a-tag-onto-a-field gesture (handleFieldDrop),
   * which only works today if the tag string happens to already match one
   * of that field's predefined options and otherwise silently no-ops. This
   * registers the tag as a real option first (same as the "+ new" select
   * path), so promoting always works instead of depending on a pre-existing
   * option string matching exactly. */
  function promoteTagToField(tag: string, field: FacetField) {
    useStore.getState().addFieldOption(field.name, tag);
    state.moveTagToField(
      object.id,
      tag,
      field.name,
      tag,
      field.type === "multi-select" ? "append" : "replace"
    );
    setActiveTag(null);
  }

  function confirmNewOption(field: FacetField) {
    const trimmed = newOptionDraft.trim();
    if (!trimmed) return;
    useStore.getState().addFieldOption(field.name, trimmed);
    if (field.type === "multi-select") {
      toggleMultiSelectOption(field, trimmed);
    } else {
      selectFacetOption(field, trimmed);
    }
    setNewOptionField(null);
    setNewOptionDraft("");
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
      // moment where our own tag list looks stale. Goes through
      // addObjectTag (not a raw updateObject) so this is recorded in
      // localUserTags — a value hand-typed into a facet field is exactly as
      // "handpicked" as one typed into the tags box, and Curated Piles
      // (lib/tagOrigin.ts) needs that to keep reading "user" even after
      // mymind's own sync eventually echoes this tag back with its own
      // Manual flag.
      state.addObjectTag(object.id, trimmed);
      setTagPushError(null);
    } catch (err) {
      setTagPushError(`Couldn't sync "${trimmed}" to mymind as a tag: ${(err as Error).message}`);
    }
  }

  /** Click-a-chip path for select facets — one gesture, so the "value the
   * field held when focused" that the blur path reads from an input's focus
   * event is captured here explicitly before overwriting it. Same push
   * semantics as blur: only fires when the value actually changed. */
  function selectFacetOption(field: FacetField, value: string) {
    focusValues.current[field.name] = asFieldString(object.fields[field.name]);
    setFieldValue(field.name, value);
    state.recordUserValue(object.id, value);
    void maybePushFacetTag(field.name, value);
  }

  /**
   * Pushes the description to mymind as a note — the other write path this
   * app performs, only on blur (same reasoning as maybePushFacetTag: never
   * per keystroke). Creates a note the first time, then updates that same
   * note in place on every later edit (using the id captured back from
   * mymind after the first push). Never DELETE — clearing the field to
   * empty just replaces the note's body with an empty string.
   */
  async function maybePushDescription(newValue: string) {
    if (object.source !== "mymind") return;
    const priorValue = focusValues.current[DESCRIPTION_KEY] ?? "";
    if (newValue === priorValue) return;

    try {
      const noteId = asFieldString(object.fields[NOTE_ID_KEY]);
      const created = noteId
        ? await updateMymindNote(object.id, noteId, newValue)
        : await createMymindNote(object.id, newValue);
      if (created) setFieldValue(NOTE_ID_KEY, created.id);
      setNotePushError(null);
    } catch (err) {
      setNotePushError(`Couldn't sync the description to mymind: ${(err as Error).message}`);
    }
  }

  /**
   * Pushes an edit to a Note's own content — the real write path (distinct
   * from maybePushDescription, which writes the separate notes[] annotation
   * via the notes endpoints). Only ever called for entity_type "Note"
   * objects (mymind 422s otherwise), and only on blur, same reasoning as
   * every other write here: never per keystroke. No id to capture back —
   * unlike a note, content isn't a separate entity with its own id.
   */
  async function maybePushContent(newValue: string) {
    if (object.source !== "mymind") return;
    const priorValue = focusValues.current[NOTE_CONTENT_KEY] ?? "";
    if (newValue === priorValue) return;

    try {
      await updateMymindContent(object.id, newValue);
      setContentPushError(null);
    } catch (err) {
      setContentPushError(`Couldn't sync the note content to mymind: ${(err as Error).message}`);
    }
  }

  /** A select field only accepts a dropped tag while it's empty — dropping
   * onto an already-filled one would silently overwrite it, so it's a
   * no-op instead. Multi-select always accepts one (it appends). Date
   * fields never accept one: a raw tag string is essentially never a valid
   * date, so there's no realistic match to offer. */
  function fieldAcceptsDrop(field: FacetField): boolean {
    if (field.type === "date") return false;
    if (field.type === "multi-select") return true;
    return !object.fields[field.name];
  }

  function handleFieldDrop(field: FacetField, e: React.DragEvent) {
    e.preventDefault();
    setDragOverField(null);
    const tag = e.dataTransfer.getData(TAG_DRAG_MIME);
    if (!tag) return;

    if (field.type === "select" || field.type === "multi-select") {
      // Only accept a value the schema actually allows — otherwise the
      // field would silently show/gain a value outside its own options.
      const match = (field.options ?? []).find((opt) => norm(opt) === norm(tag));
      if (!match) return;
      state.moveTagToField(
        object.id,
        tag,
        field.name,
        match,
        field.type === "multi-select" ? "append" : "replace"
      );
      return;
    }
    state.moveTagToField(object.id, tag, field.name, tag, "replace");
  }

  /** Clicking a populated facet value opens a temporary filtered view of
   * every object with that value (issue #86) — no new entity, just the
   * same facetFieldFilter the FilterBar's own "Field" picker already
   * applies (#111/#112). Switches to the All-items view since the filter
   * is a library-wide concept, not scoped to whatever collection this
   * object happened to be opened from. */
  function viewAllWithValue(fieldName: string, value: string) {
    state.setSelectedView({ kind: "all" });
    state.setFacetFieldFilter({ field: fieldName, value });
    onClose();
  }

  /** One role-package field, as a select-value pill, a multi-select chip
   * row, or a date input — extracted so the visible/hidden split above
   * (issue #101) can map over either list without duplicating this. */
  function renderRoleField(field: FacetField) {
    const acceptsDrop = fieldAcceptsDrop(field);
    const rawValue = object.fields[field.name];
    const dropHandlers = {
      onDragOver: acceptsDrop
        ? (e: React.DragEvent) => {
            e.preventDefault();
            setDragOverField(field.name);
          }
        : undefined,
      onDragLeave: acceptsDrop ? () => setDragOverField(null) : undefined,
      onDrop: acceptsDrop ? (e: React.DragEvent) => handleFieldDrop(field, e) : undefined,
    };
    const dropRing =
      dragOverField === field.name ? "ring-2 ring-accent ring-offset-1 ring-offset-panel" : "";

    if (field.type === "select") {
      // One fluid pill: the field itself, expanding in place on hover/focus
      // to offer its options as chips — no separate dropdown-open step.
      // Long option lists cap at a few chips with a "+N more" toggle.
      const value = typeof rawValue === "string" ? rawValue : "";
      const options = field.options ?? [];
      const expanded = expandedOptionsField === field.name;
      const VISIBLE_OPTIONS = 6;
      const shownOptions = expanded ? options : options.slice(0, VISIBLE_OPTIONS);
      const hiddenCount = options.length - shownOptions.length;
      return (
        <div key={field.name} {...dropHandlers} className={["group/facetrow rounded-lg", dropRing].join(" ")}>
          <div className="flex flex-wrap items-center gap-1">
            <span
              className={[
                "tag-chip gap-1 cursor-default",
                value ? "border-accent/40 bg-accent/5 text-ink" : "",
              ].join(" ")}
              title={acceptsDrop ? "Drop a tag here to use it as this field's value" : field.name}
            >
              {field.name}
              {value && (
                <button
                  onClick={(e) => {
                    e.stopPropagation();
                    viewAllWithValue(field.name, value);
                  }}
                  className="font-medium hover:underline"
                  title={`Show every item where ${field.name} = ${value}`}
                >
                  · {value}
                </button>
              )}
            </span>
            <div className="hidden group-hover/facetrow:contents group-focus-within/facetrow:contents">
              {value && (
                <button
                  onClick={() => setFieldValue(field.name, "")}
                  className="tag-chip text-muted hover:text-ink"
                  title="Clear this field (locally — an already-synced mymind tag stays)"
                >
                  clear
                </button>
              )}
              {shownOptions
                .filter((opt) => opt !== value)
                .map((opt) => (
                  <button
                    key={opt}
                    onClick={() => selectFacetOption(field, opt)}
                    className="tag-chip hover:border-accent hover:text-ink"
                  >
                    {opt}
                  </button>
                ))}
              {(hiddenCount > 0 || expanded) && (
                <button
                  onClick={() => setExpandedOptionsField(expanded ? null : field.name)}
                  className="tag-chip text-muted hover:text-ink"
                >
                  {expanded ? "less" : `+${hiddenCount} more`}
                </button>
              )}
              {newOptionField === field.name ? (
                <input
                  autoFocus
                  value={newOptionDraft}
                  onChange={(e) => setNewOptionDraft(e.target.value)}
                  onBlur={() => confirmNewOption(field)}
                  onKeyDown={(e) => {
                    if (e.key === "Enter") confirmNewOption(field);
                    if (e.key === "Escape") {
                      e.stopPropagation();
                      setNewOptionField(null);
                      setNewOptionDraft("");
                    }
                  }}
                  placeholder="New option…"
                  className="tag-chip w-24 outline-none focus:border-accent"
                />
              ) : (
                <button
                  onClick={() => setNewOptionField(field.name)}
                  className="tag-chip text-muted hover:text-ink"
                  title="Type a value not yet in this field's options"
                >
                  + new
                </button>
              )}
            </div>
          </div>
        </div>
      );
    }

    if (field.type === "multi-select") {
      // Same fluid-pill language as select, but every chosen value stays
      // visible (not just one) and each is its own toggle-off button;
      // unselected options appear on hover to toggle on, same "+N more" cap.
      const values = Array.isArray(rawValue) ? rawValue : [];
      const options = field.options ?? [];
      const unselected = options.filter((opt) => !values.includes(opt));
      const expanded = expandedOptionsField === field.name;
      const VISIBLE_OPTIONS = 6;
      const shownUnselected = expanded ? unselected : unselected.slice(0, VISIBLE_OPTIONS);
      const hiddenCount = unselected.length - shownUnselected.length;
      return (
        <div key={field.name} {...dropHandlers} className={["group/facetrow rounded-lg", dropRing].join(" ")}>
          <div className="flex flex-wrap items-center gap-1">
            <span
              className="tag-chip cursor-default"
              title={acceptsDrop ? "Drop a tag here to add it to this field" : field.name}
            >
              {field.name}
            </span>
            {values.map((v) => (
              <button
                key={v}
                onClick={(e) => (e.altKey ? viewAllWithValue(field.name, v) : toggleMultiSelectOption(field, v))}
                className="tag-chip gap-1 border-accent/40 bg-accent/5 text-ink"
                title="Click to remove this value, option/alt-click to see every item with it"
              >
                {v} ×
              </button>
            ))}
            <div className="hidden group-hover/facetrow:contents group-focus-within/facetrow:contents">
              {shownUnselected.map((opt) => (
                <button
                  key={opt}
                  onClick={() => toggleMultiSelectOption(field, opt)}
                  className="tag-chip hover:border-accent hover:text-ink"
                >
                  {opt}
                </button>
              ))}
              {(hiddenCount > 0 || expanded) && (
                <button
                  onClick={() => setExpandedOptionsField(expanded ? null : field.name)}
                  className="tag-chip text-muted hover:text-ink"
                >
                  {expanded ? "less" : `+${hiddenCount} more`}
                </button>
              )}
              {newOptionField === field.name ? (
                <input
                  autoFocus
                  value={newOptionDraft}
                  onChange={(e) => setNewOptionDraft(e.target.value)}
                  onBlur={() => confirmNewOption(field)}
                  onKeyDown={(e) => {
                    if (e.key === "Enter") confirmNewOption(field);
                    if (e.key === "Escape") {
                      e.stopPropagation();
                      setNewOptionField(null);
                      setNewOptionDraft("");
                    }
                  }}
                  placeholder="New option…"
                  className="tag-chip w-24 outline-none focus:border-accent"
                />
              ) : (
                <button
                  onClick={() => setNewOptionField(field.name)}
                  className="tag-chip text-muted hover:text-ink"
                  title="Type a value not yet in this field's options"
                >
                  + new
                </button>
              )}
            </div>
          </div>
        </div>
      );
    }

    // Only "date" is left — select/multi-select/date are the only role
    // field types (#99's closed decision), and both of those return above.
    const value = typeof rawValue === "string" ? rawValue : "";
    return (
      <div key={field.name} {...dropHandlers} className={["flex items-center gap-1.5 rounded-lg", dropRing].join(" ")}>
        <span className="text-[12px] text-muted w-24 shrink-0 truncate" title={field.name}>
          {field.name}
        </span>
        <input
          type="date"
          value={value}
          onChange={(e) => {
            setFieldValue(field.name, e.target.value);
            state.recordUserValue(object.id, e.target.value);
          }}
          onFocus={(e) => {
            focusValues.current[field.name] = e.target.value;
          }}
          onBlur={(e) => void maybePushFacetTag(field.name, e.target.value)}
          className="flex-1 rounded-lg border border-line px-2.5 py-1 text-sm outline-none focus:border-accent"
        />
      </div>
    );
  }

  const isCentered = layout === "centered";

  return (
    <div
      className={
        isCentered
          ? "fixed inset-0 z-40 flex items-center justify-center p-6"
          : "fixed inset-0 z-40 flex justify-end"
      }
    >
      <div className="absolute inset-0 bg-black/30" onClick={onClose} />
      <div
        ref={panelRef}
        role="dialog"
        aria-modal="true"
        aria-label={object.title || "Item details"}
        tabIndex={-1}
        className={
          isCentered
            ? "relative w-full max-w-3xl max-h-[90vh] bg-panel border border-line rounded-2xl shadow-2xl outline-none overflow-y-auto"
            : "relative w-full max-w-md h-full bg-panel border-l border-line shadow-2xl outline-none overflow-y-auto"
        }
      >
        <div className="sticky top-0 z-10 bg-panel border-b border-line px-4 py-2 flex items-center justify-between">
          <div className="inline-flex rounded-lg border border-line overflow-hidden text-[11px]">
            {(["side", "centered"] as const).map((mode) => (
              <button
                key={mode}
                onClick={() => onLayoutChange(mode)}
                className={[
                  "px-2 py-1 capitalize",
                  layout === mode ? "bg-ink text-white" : "hover:bg-line/40",
                ].join(" ")}
                title={`Switch to ${mode} layout (⌘L to toggle)`}
              >
                {mode}
              </button>
            ))}
          </div>
          <button
            onClick={onClose}
            className="text-muted hover:text-ink text-lg leading-none"
            aria-label="Close item details"
          >
            ×
          </button>
        </div>

        {!isNote && object.imageUrl && !coverFailed && (
          <button
            type="button"
            draggable
            onDragStart={(e) => {
              // Same drag contract as a grid Card (issue follow-up: drag the
              // expanded detail view straight onto a sidebar folder, no need
              // to close the panel and find the card in the grid first).
              const { sidebarCollapsed, setDragRevealSidebar } = useStore.getState();
              e.dataTransfer.setData(DRAG_MIME, JSON.stringify([object.id]));
              e.dataTransfer.effectAllowed = "copy";
              if (sidebarCollapsed) setDragRevealSidebar(true);
            }}
            onDragEnd={() => useStore.getState().setDragRevealSidebar(false)}
            onClick={() => onOpenCarousel(object.id)}
            className="block w-full cursor-zoom-in active:cursor-grabbing"
            title="Click to view fullscreen — drag onto a sidebar folder to add to a collection"
          >
            <img
              src={detailImageSrc}
              alt={object.title}
              draggable={false}
              // A tall portrait-oriented photo at its native aspect ratio can
              // run well past the viewport height (issue #107) — capping the
              // height and using object-contain (not object-cover, which
              // would crop) lets a tall image shrink to fit while a wide one
              // still uses the full panel width, same as before.
              className="w-full max-h-[70vh] object-contain bg-line/10"
              onError={() => {
                if (!blobFailed) setBlobFailed(true);
                else if (!defaultThumbFailed) setDefaultThumbFailed(true);
                else setCoverFailed(true);
              }}
            />
          </button>
        )}

        {!isNote && object.source === "mymind" && blobType && (
          <div className="px-4 pt-4">
            <a
              href={`/api/mymind/blob/${object.id}?filename=${encodeURIComponent(
                buildDownloadFilename(object.title, blobType)
              )}&type=${encodeURIComponent(blobType)}`}
              download={buildDownloadFilename(object.title, blobType)}
              className="block w-full text-center text-sm px-3 py-1.5 rounded-lg border border-line hover:bg-line/40"
              title="The original uploaded file, byte-for-byte — not the compressed thumbnail shown above"
            >
              ⭳ Download original
            </a>
          </div>
        )}

        <div className="px-4 pt-4">
          <div className="flex items-center justify-between mb-1.5">
            <span className="text-[11px] uppercase tracking-wide text-muted">✦ Similar to this</span>
            <button
              onClick={() => {
                // Non-destructive (design-philosophy: "don't navigate away
                // from a thought — open space beside it") WITHOUT hijacking
                // the Workbench (#135 feedback — that's reserved for
                // deliberate drag-curation, forcing same-vibe glances into
                // it ate the space meant for the user's own piles). The
                // current view/filters/scroll snapshot onto the back-stack;
                // a floating pill (App.tsx) restores them exactly on "back".
                const cur = useStore.getState();
                const scrollEl = document.querySelector("[data-content-scroll]") as HTMLElement | null;
                cur.pushViewSnapshot(
                  { kind: "similar", objectId: object.id },
                  viewTitle(cur),
                  scrollEl?.scrollTop ?? 0
                );
                onClose();
              }}
              className="text-[11px] text-accent hover:underline"
              title="Opens a full similarity view beside this one — a '← Back' pill returns you to exactly where you were (view, filters, scroll)"
            >
              See more →
            </button>
          </div>
          {similarStrip.length > 0 ? (
            <div className="flex gap-1.5 overflow-x-auto pb-0.5">
              {similarStrip.map((o) => (
                <button
                  key={o.id}
                  onClick={() => state.openDetail(o.id)}
                  // Universal drag (issue #132): a same-vibe neighbour can go
                  // straight to the bench or a collection while reading —
                  // discovery never forces navigation.
                  {...objectDragProps([o.id])}
                  className="shrink-0 w-14 h-14 rounded-lg overflow-hidden border border-line hover:border-accent cursor-grab active:cursor-grabbing"
                  title={o.title}
                >
                  <StripThumb object={o} />
                </button>
              ))}
            </div>
          ) : (
            <p className="text-[12px] text-muted/70">Nothing else similar enough yet.</p>
          )}
        </div>

        <div className="p-4 space-y-5">
          <div>
            <label className="text-[11px] uppercase tracking-wide text-muted">Title</label>
            <input
              value={object.title}
              onChange={(e) => state.updateObject(object.id, { title: e.target.value })}
              className="mt-1 w-full rounded-lg border border-line px-2.5 py-1.5 text-sm outline-none focus:border-accent"
            />
          </div>

          {hasRealContent && (
            <div>
              <label className="text-[11px] uppercase tracking-wide text-muted">
                {isNote ? "Note content" : "Content"}
              </label>
              {isNote ? (
                <>
                  <textarea
                    title="The note's real text — synced to mymind once you leave the field. Markdown is supported, same as mymind itself."
                    value={object.fields[NOTE_CONTENT_KEY] ?? ""}
                    onChange={(e) => setFieldValue(NOTE_CONTENT_KEY, e.target.value)}
                    onFocus={(e) => {
                      focusValues.current[NOTE_CONTENT_KEY] = e.target.value;
                    }}
                    onBlur={(e) => void maybePushContent(e.target.value)}
                    placeholder="Write the note…"
                    rows={8}
                    className="w-full rounded-lg border border-line px-2.5 py-1.5 text-sm outline-none focus:border-accent resize-y max-h-64"
                  />
                </>
              ) : (
                <div
                  className="text-sm text-ink/90 leading-relaxed whitespace-pre-wrap rounded-lg border border-line px-2.5 py-1.5 max-h-64 overflow-y-auto"
                  title="The real saved text, read from mymind — read-only here (mymind's write API only accepts edits back for Notes, not this object type)."
                >
                  {object.fields[NOTE_CONTENT_KEY]}
                </div>
              )}
            </div>
          )}

          {object.fields.summary && (
            <p className="text-sm text-ink/80 leading-relaxed">{object.fields.summary}</p>
          )}

          <div>
            <label
              className="text-[11px] uppercase tracking-wide text-muted"
              title='Click a tag to merge it as a synonym, send it to a field, or remove it. Merging (e.g. "caniche" under "dog") is spelling/vocabulary cleanup only — local to this app, never synced to mymind. If a tag is really a field value in disguise (e.g. this tag literally means Style: vintage), use "→ field" instead of merging it.'
            >
              Tags
            </label>
            <div className="mt-1.5 flex flex-wrap gap-1.5">
              {object.tags.map((t) => {
                const group = state.tagGroups[norm(t)] ?? "";
                const color = group ? colorForGroup(group) : null;
                const isActive = activeTag === t;
                return (
                  <button
                    key={t}
                    draggable
                    onDragStart={(e) => {
                      e.dataTransfer.setData(TAG_DRAG_MIME, t);
                      e.dataTransfer.effectAllowed = "move";
                    }}
                    onClick={() => setActiveTag(isActive ? null : t)}
                    title={group ? `${group}/${t}` : t}
                    className={["tag-chip", isActive ? "ring-1 ring-accent" : ""].join(" ")}
                    style={
                      color
                        ? { backgroundColor: color.bg, borderColor: color.border, color: color.text }
                        : undefined
                    }
                  >
                    #{t}
                  </button>
                );
              })}
            </div>
            {activeTag !== null && object.tags.includes(activeTag) && (
              <div className="mt-2 flex items-center gap-1.5 rounded-lg border border-line bg-canvas px-2.5 py-1.5 text-[12px]">
                <span className="truncate font-medium" title={activeTag}>
                  #{activeTag}
                </span>
                <input
                  key={activeTag}
                  defaultValue={state.tagGroups[norm(activeTag)] ?? ""}
                  onBlur={(e) => state.setTagGroup(activeTag, e.target.value)}
                  onKeyDown={(e) => e.key === "Enter" && (e.target as HTMLInputElement).blur()}
                  placeholder="merge as…"
                  list="known-groups"
                  className="flex-1 min-w-0 rounded border border-line bg-panel px-1.5 py-0.5 outline-none focus:border-accent"
                  title="Treat this tag as a synonym of another (e.g. typeface merged under typography) — local normalization only, never synced to mymind, and unrelated to this role's facet fields below. If this tag IS really a field value (e.g. it literally means Style: vintage), use the field picker instead of merging it."
                />
                {promotableFields.length > 0 && (
                  <select
                    value=""
                    onChange={(e) => {
                      const field = promotableFields.find((f) => f.name === e.target.value);
                      if (field) promoteTagToField(activeTag, field);
                    }}
                    className="shrink-0 rounded border border-line bg-panel px-1 py-0.5 outline-none focus:border-accent"
                    title="This tag's real meaning is a field value, not raw material — send it into a role field instead of leaving it as a plain tag"
                  >
                    <option value="">→ field</option>
                    {promotableFields.map((f) => (
                      <option key={f.name} value={f.name}>
                        {f.name}
                      </option>
                    ))}
                  </select>
                )}
                <button
                  onClick={() => {
                    removeTag(activeTag);
                    setActiveTag(null);
                  }}
                  className="shrink-0 text-red-700/80 hover:text-red-700"
                  title="Remove this tag from the item (local only — never deleted in mymind)"
                >
                  Remove
                </button>
                <button
                  onClick={() => setActiveTag(null)}
                  className="shrink-0 text-muted hover:text-ink px-0.5"
                  aria-label="Close tag actions"
                >
                  ×
                </button>
              </div>
            )}
            <datalist id="known-groups">
              {knownGroups.map((g) => (
                <option key={g} value={g} />
              ))}
            </datalist>
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

            {dominantTag && (
              <button
                onClick={() => viewMoreOfTag(dominantTag.tag)}
                className="mt-2 text-[12px] text-accent hover:underline"
                title={`Filter this view down to items tagged #${dominantTag.tag}`}
              >
                More #{dominantTag.tag} ({dominantTag.count} more)
              </button>
            )}
          </div>

          <div>
            <label
              className="text-[11px] uppercase tracking-wide text-muted"
              title={
                object.source === "mymind"
                  ? "Synced to mymind as a note once you leave the field — mymind has no way for us to remove a note once sent, so this only ever adds/updates it, never deletes."
                  : "Local to this app — this sample object has no mymind counterpart to sync to."
              }
            >
              Description
            </label>
            <textarea
              value={object.fields[DESCRIPTION_KEY] ?? ""}
              onChange={(e) => setFieldValue(DESCRIPTION_KEY, e.target.value)}
              onFocus={(e) => {
                focusValues.current[DESCRIPTION_KEY] = e.target.value;
              }}
              onBlur={(e) => void maybePushDescription(e.target.value)}
              placeholder="Add a description…"
              rows={3}
              className="w-full rounded-lg border border-line px-2.5 py-1.5 text-sm outline-none focus:border-accent resize-y"
            />
          </div>

          <div>
            <label
              className="text-[11px] uppercase tracking-wide text-muted"
              title="What kind of thing this item is (Photo, Author, Book…) — one type per item, app-wide. Its type decides which classification fields the item gets, in every collection. Local to this app, never synced to mymind."
            >
              Item type
            </label>
            <div className="mt-1.5 group/rolerow">
              <div className="flex flex-wrap items-center gap-1">
                <span
                  className={[
                    "tag-chip gap-1 cursor-default",
                    object.role ? "border-accent/40 bg-accent/5 text-ink" : "",
                  ].join(" ")}
                >
                  {object.role ?? "no type"}
                </span>
                <div className="hidden group-hover/rolerow:contents group-focus-within/rolerow:contents">
                  {object.role && (
                    <>
                      <button
                        onClick={() => setEditingRoleFields(true)}
                        className="tag-chip text-muted hover:border-accent hover:text-ink"
                        title={`Edit the fields every ${object.role} item gets — applies to all of them, in every collection`}
                      >
                        ✎ fields
                      </button>
                      <button
                        onClick={() => state.setObjectRole(object.id, null)}
                        className="tag-chip text-muted hover:text-ink"
                        title="Clear this item's type"
                      >
                        clear
                      </button>
                    </>
                  )}
                  {!object.role &&
                    (() => {
                      const suggested = suggestRole(object);
                      return suggested ? (
                        <button
                          onClick={() => state.setObjectRole(object.id, suggested)}
                          className="tag-chip border-accent/50 text-accent hover:bg-accent/5"
                          title="Suggested from mymind's own type and this item's tags — click to accept, or pick anything else"
                        >
                          ✦ {suggested}?
                        </button>
                      ) : null;
                    })()}
                  {knownRoles
                    .filter((r) => r !== object.role)
                    .map((r) => (
                      <button
                        key={r}
                        onClick={() => state.setObjectRole(object.id, r)}
                        className="tag-chip hover:border-accent hover:text-ink"
                      >
                        {r}
                      </button>
                    ))}
                  <input
                    value={roleDraft}
                    onChange={(e) => setRoleDraft(e.target.value)}
                    onKeyDown={(e) => {
                      if (e.key === "Enter" && roleDraft.trim()) {
                        state.setObjectRole(object.id, roleDraft);
                        setRoleDraft("");
                      }
                    }}
                    placeholder="new type…"
                    className="w-24 rounded border border-line bg-panel px-2 py-0.5 text-[11px] outline-none focus:border-accent"
                  />
                </div>
              </div>
            </div>
          </div>

          {object.role && rolePackageFields.length > 0 && (
            <div>
              <label
                className="text-[11px] uppercase tracking-wide text-muted"
                title={
                  `Fields every ${object.role} item gets, in every collection — edit them via ✎ on the type above.` +
                  (object.source === "mymind"
                    ? " Finished values sync to mymind as a plain tag — mymind has no way for us to remove a tag once sent, so double-check before moving on."
                    : "")
                }
              >
                {object.role} — fields
              </label>
              <div className="mt-1.5 space-y-3">
                {(() => {
                  // Objective vs subjective (issue #100) is purely how this
                  // renders — a section header, not a new kind of field.
                  // Unmarked fields get no header at all, rendering neutrally
                  // rather than defaulting into either camp.
                  const filled = rolePackageFields.filter((f) => object.fields[f.name]);
                  const empty = rolePackageFields.filter((f) => !object.fields[f.name]);
                  const visible = showEmptyRoleFields ? rolePackageFields : filled;
                  const objective = visible.filter((f) => f.group === "objective");
                  const subjective = visible.filter((f) => f.group === "subjective");
                  const ungrouped = visible.filter((f) => !f.group);
                  return (
                    <>
                      {objective.length > 0 && (
                        <div className="space-y-1.5">
                          <div className="text-[10px] uppercase tracking-wide text-muted/60">
                            Objective
                          </div>
                          {objective.map(renderRoleField)}
                        </div>
                      )}
                      {subjective.length > 0 && (
                        <div className="space-y-1.5">
                          <div className="text-[10px] uppercase tracking-wide text-muted/60">
                            Subjective
                          </div>
                          {subjective.map(renderRoleField)}
                        </div>
                      )}
                      {ungrouped.length > 0 && (
                        <div className="space-y-1.5">{ungrouped.map(renderRoleField)}</div>
                      )}
                      {empty.length > 0 && (
                        <button
                          onClick={() => setShowEmptyRoleFields(!showEmptyRoleFields)}
                          className="text-[11px] text-muted hover:text-ink underline decoration-dotted"
                        >
                          {showEmptyRoleFields
                            ? "hide empty fields"
                            : `+${empty.length} empty field${empty.length === 1 ? "" : "s"}`}
                        </button>
                      )}
                    </>
                  );
                })()}
              </div>
            </div>
          )}

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

          {notePushError && (
            <div className="flex items-start justify-between gap-2 text-[12px] text-red-700 bg-red-50 border border-red-200 rounded-lg px-2.5 py-1.5">
              <span>{notePushError}</span>
              <button
                onClick={() => setNotePushError(null)}
                className="text-red-700/60 hover:text-red-700 shrink-0"
                aria-label="Dismiss"
              >
                ×
              </button>
            </div>
          )}

          {contentPushError && (
            <div className="flex items-start justify-between gap-2 text-[12px] text-red-700 bg-red-50 border border-red-200 rounded-lg px-2.5 py-1.5">
              <span>{contentPushError}</span>
              <button
                onClick={() => setContentPushError(null)}
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
                    <span className="text-ink/80 truncate min-w-0" title={formatFieldValue(value)}>
                      {formatFieldValue(value)}
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
                    {key === "source_url" && !Array.isArray(value) && isSafeHref(value) ? (
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
                      <span className="text-ink/80 truncate min-w-0" title={formatFieldValue(value)}>
                        {formatFieldValue(value)}
                      </span>
                    )}
                  </div>
                ))}
              </div>
            </details>
          )}

          <div className="pt-3 border-t border-line space-y-2">
            {smartMatches.length > 0 && (
              <div>
                <div className="text-[11px] uppercase tracking-wide text-muted mb-1">
                  Matches smart collections
                </div>
                <div className="flex flex-wrap gap-1">
                  {smartMatches.map((c) => (
                    <span key={c.id} className="tag-chip">
                      ⚡ {c.name}
                    </span>
                  ))}
                </div>
              </div>
            )}
            <div>
              <div className="flex items-center justify-between mb-1">
                <div className="text-[11px] uppercase tracking-wide text-muted">
                  In manual collections
                </div>
                <button
                  onClick={() => setAddingToCollection(true)}
                  className="text-muted hover:text-ink text-[13px] leading-none px-1"
                  aria-label="Add to a collection"
                  title="Add to an existing collection, or type a new name to create one"
                >
                  +
                </button>
              </div>
              {manualMemberships.length === 0 && !addingToCollection ? (
                <div className="text-[12px] text-muted/70">
                  None — drag this card onto a folder in the sidebar, or use + above.
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
              {addingToCollection && (
                <div className="flex flex-wrap gap-1 mt-1">
                  {availableManualCollections.map((c) => (
                    <button
                      key={c.id}
                      onClick={() => {
                        state.assignToManualCollection(object.id, c.id);
                        setAddingToCollection(false);
                      }}
                      className="tag-chip hover:border-accent hover:text-ink"
                    >
                      📁 {c.name}
                    </button>
                  ))}
                  <input
                    autoFocus
                    value={addCollectionDraft}
                    onChange={(e) => setAddCollectionDraft(e.target.value)}
                    onBlur={confirmAddToCollection}
                    onKeyDown={(e) => {
                      if (e.key === "Enter") confirmAddToCollection();
                      if (e.key === "Escape") {
                        e.stopPropagation();
                        setAddingToCollection(false);
                        setAddCollectionDraft("");
                      }
                    }}
                    placeholder="New collection…"
                    className="tag-chip w-32 outline-none focus:border-accent"
                  />
                </div>
              )}
            </div>

            <div>
              <div className="flex items-center justify-between mb-1">
                <div className="text-[11px] uppercase tracking-wide text-muted">On Are.na</div>
                <button
                  onClick={() => onPublishArena(object.id)}
                  className="text-muted hover:text-ink text-[13px] leading-none px-1"
                  aria-label="Publish to Are.na"
                  title="Publish this object to an Are.na channel (existing or new)"
                >
                  +
                </button>
              </div>
              {object.arenaPlacements && object.arenaPlacements.length > 0 ? (
                <div className="flex flex-col gap-0.5">
                  {object.arenaPlacements.map((p) => (
                    <a
                      key={p.blockId}
                      href={p.blockUrl}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="text-[12px] text-accent hover:underline truncate"
                      title={`Published to ${p.channelTitle} as @${p.account}`}
                    >
                      ↗ {p.channelTitle}
                    </a>
                  ))}
                </div>
              ) : (
                <div className="text-[12px] text-muted/70">
                  Not published — use + to add it to a channel.
                </div>
              )}
            </div>
          </div>

          <div className="pt-3 border-t border-line">
            <button
              onClick={handleDelete}
              className="w-full text-sm px-3 py-1.5 rounded-lg border border-red-200 text-red-700 hover:bg-red-50"
              title={
                object.source === "mymind"
                  ? "Removes it from The Organizer only — mymind is untouched, we never delete there"
                  : "Removes it from The Organizer"
              }
            >
              Delete from Organizer
            </button>
          </div>
        </div>
      </div>

      {editingRoleFields && object.role && (
        <RolePackageModal roleName={object.role} onClose={() => setEditingRoleFields(false)} />
      )}
    </div>
  );
}
