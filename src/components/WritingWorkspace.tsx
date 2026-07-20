import { useEffect, useMemo, useRef, useState } from "react";
import { ArrowSquareOut, Sidebar as SidebarIcon, X } from "@phosphor-icons/react";
import { useStore } from "../store";
import { DRAG_MIME, objectDragProps, readDraggedIds } from "../lib/objectDrag";
import { rankBySimilarityMode, type SimilarityMode } from "../lib/hybridSimilarity";
import { buildSearchIndex, searchObjects } from "../lib/search";
import { NOTE_CONTENT_KEY, asFieldString } from "../lib/mymindSync";
import { updateMymindContent } from "../lib/mymindWrite";
import type { DesignObject } from "../types";

/**
 * The writing workspace (issue #137) — writing as an OUTPUT of the
 * archive. The document sits center stage; embedded Organizer objects are
 * `![[objectId]]` tokens in the text, resolved live as reference chips —
 * always links back into the archive, never copies. Two views:
 *
 * - FOCUS: the document alone, navigation recedes, minimal chrome.
 * - REFERENCES: a right-side panel suggests archive objects related to
 *   the paragraph under the cursor — Same content (text search) vs Same
 *   form (visual similarity seeded on the document's context object),
 *   updating only when typing pauses, draggable into the text or bench.
 *
 * Two targets, one surface: a standalone WritingDoc, or a mymind NOTE
 * opened directly (the improved note-editing space) — then the body
 * reads/writes NOTE_CONTENT_KEY and pushes through the sanctioned
 * PUT /objects/:id/content on pause.
 */

const EMBED_RE = /!\[\[([^\]]+)\]\]/g;

/** Function words that say nothing about the paragraph's subject — en+es,
 * kept tiny and curated. Without this, "sobre"/"para"/"this" dominated the
 * term picks and the suggestions read as random. */
const STOPWORDS = new Set([
  "this", "that", "these", "those", "with", "from", "into", "about", "over",
  "what", "when", "where", "which", "will", "would", "should", "could",
  "have", "been", "being", "there", "their", "they", "them", "then", "than",
  "some", "such", "very", "just", "like", "also", "each", "before", "after",
  "para", "sobre", "como", "este", "esta", "estos", "estas", "pero", "porque",
  "cuando", "donde", "entre", "hasta", "desde", "más", "menos", "todo", "toda",
  "segundo", "primero", "párrafo", "parrafo",
]);

function embeddedIds(body: string): string[] {
  const ids: string[] = [];
  for (const m of body.matchAll(EMBED_RE)) {
    if (!ids.includes(m[1])) ids.push(m[1]);
  }
  return ids;
}

/** The paragraph containing the caret — the references panel's context. */
function paragraphAt(text: string, caret: number): string {
  const before = text.lastIndexOf("\n\n", Math.max(0, caret - 1));
  const after = text.indexOf("\n\n", caret);
  return text
    .slice(before === -1 ? 0 : before + 2, after === -1 ? text.length : after)
    .replace(EMBED_RE, "")
    .trim();
}

function EmbedChip({ object, onRemove }: { object: DesignObject; onRemove: () => void }) {
  const openDetail = useStore((s) => s.openDetail);
  const [failed, setFailed] = useState(false);
  return (
    <span className="group inline-flex items-center gap-1.5 rounded border border-line/70 bg-panel shadow-card pl-1 pr-1.5 py-1">
      <button
        onClick={() => openDetail(object.id)}
        {...objectDragProps([object.id])}
        className="flex items-center gap-1.5 cursor-grab active:cursor-grabbing"
        title={`${object.title} — click to open`}
      >
        {object.imageUrl && !failed ? (
          <img
            src={object.imageUrl}
            alt=""
            className="w-6 h-6 rounded object-cover pointer-events-none"
            onError={() => setFailed(true)}
          />
        ) : (
          <span className="w-6 h-6 rounded bg-line/30" />
        )}
        <span className="font-mono text-[10px] text-ink/80 max-w-[10rem] truncate">
          {object.title}
        </span>
      </button>
      <button
        onClick={onRemove}
        className="opacity-0 group-hover:opacity-100 text-muted hover:text-ink"
        title="Remove the embed (the object itself is untouched)"
        aria-label={`Remove embed ${object.title}`}
      >
        <X size={10} />
      </button>
    </span>
  );
}

function ReferenceThumb({
  object,
  onInsert,
}: {
  object: DesignObject;
  onInsert: (id: string) => void;
}) {
  const openDetail = useStore((s) => s.openDetail);
  const [failed, setFailed] = useState(false);
  return (
    <div className="group relative rounded overflow-hidden border border-line/70 bg-panel shadow-card">
      <button
        {...objectDragProps([object.id])}
        onClick={() => openDetail(object.id)}
        className="block w-full cursor-grab active:cursor-grabbing"
        title={object.title}
      >
        {object.imageUrl && !failed ? (
          <img
            src={object.imageUrl}
            alt=""
            loading="lazy"
            className="w-full h-20 object-cover pointer-events-none"
            onError={() => setFailed(true)}
          />
        ) : (
          <span className="block w-full h-20 p-1.5 font-mono text-[8px] leading-snug text-muted text-left overflow-hidden">
            {object.title}
          </span>
        )}
        <span className="block px-1.5 py-1 font-mono text-[9px] text-muted truncate text-left">
          {object.title}
        </span>
      </button>
      <button
        onClick={() => onInsert(object.id)}
        className="absolute top-1 right-1 opacity-0 group-hover:opacity-100 w-6 h-6 rounded bg-panel/90 shadow-card flex items-center justify-center text-ink/80 hover:text-ink font-mono text-[11px]"
        title="Embed at the cursor"
        aria-label={`Embed ${object.title}`}
      >
        +
      </button>
    </div>
  );
}

export function WritingWorkspace() {
  const target = useStore((s) => s.openWritingTarget);
  const docs = useStore((s) => s.writingDocs);
  const objects = useStore((s) => s.objects);
  const relations = useStore((s) => s.objectRelations);

  const boundNote = target?.kind === "note" ? objects[target.objectId] : null;
  const doc = target?.kind === "doc" ? docs[target.id] : null;

  const title = doc ? doc.title : boundNote ? boundNote.title : "";
  const storedBody = doc
    ? doc.body
    : boundNote
    ? asFieldString(boundNote.fields[NOTE_CONTENT_KEY])
    : "";

  // The textarea owns the body while typing; the store is the debounced
  // destination (and mymind, for a bound note, on pause — never per key).
  const [body, setBody] = useState(storedBody);
  const [pushState, setPushState] = useState<"idle" | "saving" | "saved" | "error">("idle");
  const [showRefs, setShowRefs] = useState(false);
  const [refMode, setRefMode] = useState<Exclude<SimilarityMode, "blend">>("content");
  const [paragraph, setParagraph] = useState("");
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const saveTimer = useRef<number | null>(null);
  const paragraphTimer = useRef<number | null>(null);
  const targetKey = target ? (target.kind === "doc" ? target.id : target.objectId) : "";

  // Re-seed local body when switching documents (not on every store echo).
  useEffect(() => {
    setBody(storedBody);
    setPushState("idle");
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [targetKey]);

  function scheduleSave(next: string) {
    if (saveTimer.current) window.clearTimeout(saveTimer.current);
    saveTimer.current = window.setTimeout(() => {
      void persist(next);
    }, 900);
  }

  async function persist(next: string) {
    const st = useStore.getState();
    if (target?.kind === "doc") {
      st.updateWritingDoc(target.id, { body: next });
      setPushState("saved");
      return;
    }
    if (target?.kind === "note" && boundNote) {
      st.updateObject(boundNote.id, {
        fields: { ...st.objects[boundNote.id].fields, [NOTE_CONTENT_KEY]: next },
      });
      if (boundNote.source === "mymind") {
        setPushState("saving");
        try {
          await updateMymindContent(boundNote.id, next);
          setPushState("saved");
        } catch {
          setPushState("error");
        }
      } else {
        setPushState("saved");
      }
    }
  }

  function handleBodyChange(next: string) {
    setBody(next);
    setPushState("idle");
    scheduleSave(next);
  }

  function trackParagraph() {
    if (paragraphTimer.current) window.clearTimeout(paragraphTimer.current);
    paragraphTimer.current = window.setTimeout(() => {
      const el = textareaRef.current;
      if (el) setParagraph(paragraphAt(el.value, el.selectionStart));
    }, 700);
  }

  useEffect(
    () => () => {
      if (saveTimer.current) window.clearTimeout(saveTimer.current);
      if (paragraphTimer.current) window.clearTimeout(paragraphTimer.current);
    },
    []
  );

  function insertEmbed(objectId: string) {
    const el = textareaRef.current;
    const token = `![[${objectId}]]`;
    const at = el ? el.selectionStart : body.length;
    const next = `${body.slice(0, at)}${token}${body.slice(at)}`;
    handleBodyChange(next);
    // Writing creates relationships back into the archive (#137's
    // principle): embedding X into a bound note records note→X.
    if (boundNote && objectId !== boundNote.id) {
      useStore.getState().addObjectRelation({
        sourceObjectId: boundNote.id,
        targetObjectId: objectId,
        relationType: "references",
      });
    }
    requestAnimationFrame(() => {
      if (el) {
        el.focus();
        el.selectionStart = el.selectionEnd = at + token.length;
      }
    });
  }

  const contextObject = boundNote ?? null;
  const embeds = useMemo(
    () =>
      embeddedIds(body)
        .map((id) => objects[id])
        .filter((o): o is DesignObject => Boolean(o)),
    [body, objects]
  );

  // A text-based context has no meaningful FORM signals (no palette, no
  // aspect) — the panel frames itself as "Related content", single path.
  const visualContext = embeds.some((o) => o.imageUrl) || !!contextObject?.imageUrl;

  // ── Reference suggestions: content = text search over the paragraph;
  // form = visual similarity seeded on the context object (the bound note
  // or the first embed). Recomputed on typing PAUSE, never per keystroke.
  const allObjectsList = useMemo(() => Object.values(objects), [objects]);
  const searchIndex = useMemo(() => buildSearchIndex(allObjectsList), [allObjectsList]);
  const suggestions = useMemo(() => {
    if (!showRefs) return [];
    const exclude = new Set([...embeds.map((o) => o.id), boundNote?.id ?? ""]);
    if (refMode === "content") {
      // Fuse treats a query as ONE fuzzy pattern — a whole sentence
      // matches nothing. Search per distinctive term instead and
      // round-robin-merge, so "Segundo párrafo sobre King Kong" asks the
      // archive about "king", "kong", "párrafo"… separately.
      // Distinctive terms only: drop function words, prefer proper nouns
      // (capitalized mid-sentence) and longer words.
      const rawTokens = (paragraph.match(/[A-Za-zÀ-ž0-9]{4,}/g) ?? []) as string[];
      const termScores = new Map<string, number>();
      for (const tok of rawTokens) {
        const low = tok.toLowerCase();
        if (STOPWORDS.has(low)) continue;
        const score = (tok[0] === tok[0].toUpperCase() ? 3 : 0) + Math.min(tok.length, 10) / 10;
        termScores.set(low, Math.max(termScores.get(low) ?? 0, score));
      }
      const terms = [...termScores.entries()]
        .sort((a, b) => b[1] - a[1])
        .slice(0, 4)
        .map(([t]) => t);
      if (terms.length === 0) return [];
      const perTerm = terms.map((t) =>
        searchObjects(searchIndex, t, allObjectsList)
          .filter((o) => !exclude.has(o.id))
          .slice(0, 6)
      );
      const merged: DesignObject[] = [];
      const seen = new Set<string>();
      for (let i = 0; i < 6; i++) {
        for (const list of perTerm) {
          const o = list[i];
          if (o && !seen.has(o.id)) {
            seen.add(o.id);
            merged.push(o);
          }
        }
      }
      return merged.slice(0, 10);
    }
    const seed = (boundNote?.imageUrl ? boundNote : null) ?? embeds.find((o) => o.imageUrl) ?? null;
    if (!seed) return [];
    return rankBySimilarityMode(
      seed,
      allObjectsList.filter((o) => !exclude.has(o.id) && o.id !== seed.id),
      allObjectsList,
      { mode: "form", limit: 10, relations }
    )
      .map((r) => objects[r.id])
      .filter((o): o is DesignObject => Boolean(o));
  }, [showRefs, refMode, paragraph, embeds, boundNote, searchIndex, allObjectsList, relations, objects]);

  // Manually connected objects (canvas arrows, embeds, detail removals all
  // share store.objectRelations) — surfaced FIRST, highlighted: the user's
  // own hand outranks any computed likeness.
  const connected = useMemo(() => {
    const anchorIds = new Set<string>([
      ...(boundNote ? [boundNote.id] : []),
      ...embeds.map((o) => o.id),
    ]);
    if (anchorIds.size === 0) return [];
    const exclude = new Set([...anchorIds]);
    const out: DesignObject[] = [];
    for (const r of relations) {
      let other: string | null = null;
      if (anchorIds.has(r.sourceObjectId)) other = r.targetObjectId;
      else if (anchorIds.has(r.targetObjectId)) other = r.sourceObjectId;
      if (!other || exclude.has(other)) continue;
      const o = objects[other];
      if (o) {
        out.push(o);
        exclude.add(other);
      }
    }
    return out.slice(0, 6);
  }, [relations, boundNote, embeds, objects]);

  if (!target || (!doc && !boundNote)) return null;

  return (
    <div className="h-full flex min-h-0">
      {/* The document — center stage (Focus). */}
      <div className="flex-1 min-w-0 h-full overflow-y-auto" data-content-scroll>
        <div className="max-w-2xl mx-auto px-6 pt-20 pb-16">
          <div className="flex items-center gap-2 mb-1">
            <span className="font-mono text-[10px] uppercase tracking-[0.12em] text-muted">
              {boundNote ? "Note" : "Document"}
            </span>
            <span className="font-mono text-[10px] text-muted/60">
              {pushState === "saving"
                ? "saving…"
                : pushState === "saved"
                ? boundNote?.source === "mymind"
                  ? "saved · synced to mymind"
                  : "saved"
                : pushState === "error"
                ? "⚠ couldn't sync to mymind"
                : ""}
            </span>
            <span className="flex-1" />
            <button
              onClick={() => setShowRefs((v) => !v)}
              className={[
                "font-mono text-[10px] px-2 py-1 rounded border inline-flex items-center gap-1",
                showRefs
                  ? "border-accent/50 bg-accent/5 text-ink"
                  : "border-line text-muted hover:text-ink",
              ].join(" ")}
              aria-pressed={showRefs}
              title="References mode — archive suggestions beside the document"
            >
              <SidebarIcon size={11} /> References
            </button>
            <button
              onClick={() => useStore.getState().openWriting(null)}
              className="w-6 h-6 flex items-center justify-center rounded text-muted hover:text-ink hover:bg-line/40"
              aria-label="Close writing workspace"
              title="Close — everything is saved"
            >
              <X size={12} />
            </button>
          </div>

          {doc ? (
            <input
              value={title}
              onChange={(e) =>
                useStore.getState().updateWritingDoc(doc.id, { title: e.target.value })
              }
              placeholder="Untitled document"
              className="w-full bg-transparent text-[22px] font-bold outline-none mb-1"
            />
          ) : boundNote ? (
            <input
              defaultValue={title}
              key={boundNote.id}
              onBlur={(e) => {
                const next = e.target.value.trim();
                if (next && next !== boundNote.title) {
                  useStore.getState().updateObject(boundNote.id, { title: next });
                }
              }}
              onKeyDown={(e) => e.key === "Enter" && (e.target as HTMLInputElement).blur()}
              placeholder="Untitled"
              className="w-full bg-transparent text-[22px] font-bold outline-none mb-1"
              aria-label="Note title"
            />
          ) : null}

          {embeds.length > 0 && (
            <div className="flex flex-wrap gap-1.5 my-2">
              {embeds.map((o) => (
                <EmbedChip
                  key={o.id}
                  object={o}
                  onRemove={() =>
                    handleBodyChange(body.split(`![[${o.id}]]`).join("").replace(/\n{3,}/g, "\n\n"))
                  }
                />
              ))}
            </div>
          )}

          <textarea
            ref={textareaRef}
            value={body}
            onChange={(e) => {
              handleBodyChange(e.target.value);
              trackParagraph();
            }}
            onKeyUp={trackParagraph}
            onClick={trackParagraph}
            onDragOver={(e) => {
              if (e.dataTransfer.types.includes(DRAG_MIME)) e.preventDefault();
            }}
            onDrop={(e) => {
              const ids = readDraggedIds(e);
              if (ids.length === 0) return;
              e.preventDefault();
              for (const id of ids) insertEmbed(id);
            }}
            placeholder="write — drop any object here to embed it by reference…"
            className="w-full min-h-[60vh] bg-transparent outline-none resize-none text-[15px] leading-relaxed text-ink/90 placeholder:text-muted/50"
          />
        </div>
      </div>

      {/* References — part of the workspace, not a floating panel. The
          textarea never remounts when this opens: cursor/scroll survive. */}
      {showRefs && (
        <div className="w-72 shrink-0 h-full overflow-y-auto border-l border-line/70 bg-canvas shadow-[inset_10px_0_16px_-12px_rgba(0,0,0,0.2)] px-3 pt-20 pb-6">
          <div className="flex items-center gap-1 mb-2">
            <span className="flex-1 font-mono text-[10px] uppercase tracking-[0.12em] text-muted">
              {visualContext ? "References" : "Related content"}
            </span>
            {visualContext && (["content", "form"] as const).map((m) => (
              <button
                key={m}
                onClick={() => setRefMode(m)}
                className={[
                  "font-mono text-[10px] px-1.5 py-0.5 rounded border capitalize",
                  refMode === m
                    ? "border-accent/50 bg-accent/5 text-ink"
                    : "border-line text-muted hover:text-ink",
                ].join(" ")}
                title={
                  m === "content"
                    ? "Suggested from the paragraph under your cursor"
                    : "Visually similar to this document's context object"
                }
              >
                {m}
              </button>
            ))}
          </div>
          {connected.length > 0 && (
            <div className="mb-3">
              <div className="font-mono text-[9px] uppercase tracking-[0.14em] text-accent mb-1.5">
                § connected by you
              </div>
              <div className="flex flex-col gap-2">
                {connected.map((o) => (
                  <div key={o.id} className="rounded ring-1 ring-accent/40">
                    <ReferenceThumb object={o} onInsert={insertEmbed} />
                  </div>
                ))}
              </div>
            </div>
          )}
          {suggestions.length === 0 ? (
            <p className="font-mono text-[10px] text-muted/70 leading-relaxed">
              {refMode === "content"
                ? "write a little — suggestions follow the paragraph under your cursor."
                : "no visual context yet — embed an object (or open a note) to seed form similarity."}
            </p>
          ) : (
            <div className="flex flex-col gap-2">
              {suggestions.map((o) => (
                <ReferenceThumb key={o.id} object={o} onInsert={insertEmbed} />
              ))}
            </div>
          )}
          <p className="mt-3 font-mono text-[9px] text-muted/60 leading-relaxed">
            drag into the text or the bench · + embeds at the cursor <ArrowSquareOut size={9} className="inline" />
          </p>
        </div>
      )}
    </div>
  );
}
