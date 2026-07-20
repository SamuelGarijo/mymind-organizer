import { useEffect, useMemo, useRef, useState } from "react";
import { ArrowLeft, ArrowSquareOut, X } from "@phosphor-icons/react";
import { useStore } from "../store";
import { viewTitle } from "../lib/viewLabel";
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

/** Markdown stays the STORAGE format (mymind's note content is plain text
 * and the `![[id]]` embeds live in it) — the editorial surface is just a
 * live rendering of it: one block element per line, headings from `#`. */
const HEADING_RE = /^(#{1,6})\s+([\s\S]*)$/;

function blocksFromMarkdown(text: string): { level: number; text: string }[] {
  return text.split("\n").map((line) => {
    const m = HEADING_RE.exec(line);
    return m ? { level: m[1].length, text: m[2] } : { level: 0, text: line };
  });
}

function markdownFromDom(root: HTMLElement): string {
  const lines: string[] = [];
  for (const el of Array.from(root.children)) {
    const tag = el.tagName.toLowerCase();
    const level = /^h[1-6]$/.test(tag) ? Number(tag[1]) : 0;
    // NBSPs are what contenteditable leaves behind for typed spaces.
    const text = (el.textContent ?? "").replace(/\u00a0/g, " ");
    lines.push(level ? `${"#".repeat(level)} ${text}` : text);
  }
  return lines.join("\n");
}

/** Paints markdown into the editor's DOM — only ever called when the
 * document CHANGES, never on keystrokes: the DOM owns the caret while
 * typing, exactly as an uncontrolled input does. */
function paintEditor(root: HTMLElement, text: string) {
  root.replaceChildren();
  for (const b of blocksFromMarkdown(text)) {
    const node = document.createElement(b.level ? `h${b.level}` : "p");
    if (b.text) node.textContent = b.text;
    else node.appendChild(document.createElement("br"));
    root.appendChild(node);
  }
  if (!root.firstChild) {
    const p = document.createElement("p");
    p.appendChild(document.createElement("br"));
    root.appendChild(p);
  }
}

/** The top-level block the caret sits in (a direct child of the editor). */
function caretBlock(root: HTMLElement): HTMLElement | null {
  const sel = window.getSelection();
  if (!sel || sel.rangeCount === 0) return null;
  let node: Node | null = sel.anchorNode;
  while (node && node.parentNode !== root) node = node.parentNode;
  return node instanceof HTMLElement ? node : null;
}

function placeCaret(el: HTMLElement, atEnd = false) {
  const range = document.createRange();
  range.selectNodeContents(el);
  range.collapse(!atEnd);
  const sel = window.getSelection();
  sel?.removeAllRanges();
  sel?.addRange(range);
}

/** Swaps a block's tag in place (p ⇄ h1–h6), keeping the caret inside. */
function setBlockLevel(root: HTMLElement, block: HTMLElement, level: number, text: string) {
  const next = document.createElement(level ? `h${level}` : "p");
  if (text) next.textContent = text;
  else next.appendChild(document.createElement("br"));
  root.replaceChild(next, block);
  placeCaret(next, true);
}

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

/** The block under the caret — the references panel's context. */
function paragraphUnderCaret(root: HTMLElement): string {
  const block = caretBlock(root);
  return (block?.textContent ?? "").replace(EMBED_RE, "").trim();
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
  const fontSize = useStore((s) => s.writingFontSize);
  const setWritingFontSize = useStore((s) => s.setWritingFontSize);
  const selectedView = useStore((s) => s.selectedView);
  const collections = useStore((s) => s.collections);
  // Where "back" actually lands — the view still standing behind this one.
  const backLabel = viewTitle({ selectedView, objects, collections });

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
  const editorRef = useRef<HTMLDivElement>(null);
  const saveTimer = useRef<number | null>(null);
  const paragraphTimer = useRef<number | null>(null);
  const targetKey = target ? (target.kind === "doc" ? target.id : target.objectId) : "";

  // Enter must produce a <p>, not the browser's default <div> — the
  // serializer's block model is p + h1–h6 and nothing else.
  useEffect(() => {
    document.execCommand("defaultParagraphSeparator", false, "p");
  }, []);

  // Re-seed local body AND repaint the surface when switching documents
  // (never on store echoes — the DOM owns the caret while typing).
  useEffect(() => {
    setBody(storedBody);
    setPushState("idle");
    if (editorRef.current) paintEditor(editorRef.current, storedBody);
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
      const el = editorRef.current;
      if (el) setParagraph(paragraphUnderCaret(el));
    }, 700);
  }

  /** Serialize the DOM back to markdown after any edit — and promote a
   * block that now READS as a heading (`## `). Doing it here rather than
   * only on the space keydown means pasted markdown, IME input and
   * autocomplete all get the same treatment. */
  function handleEditorInput() {
    const el = editorRef.current;
    if (!el) return;
    const block = caretBlock(el);
    if (block && block.tagName.toLowerCase() === "p") {
      const m = /^(#{1,6})\s+([\s\S]*)$/.exec(block.textContent ?? "");
      if (m) setBlockLevel(el, block, m[1].length, m[2]);
    }
    handleBodyChange(markdownFromDom(el));
    trackParagraph();
  }

  /** A heading is a title, not a paragraph style — the block after it is
   * body copy, where the browser would clone the heading tag. Handled on
   * `beforeinput` rather than the Enter keydown so every path that splits
   * a block (keyboard, IME, execCommand) goes through it. */
  function handleBeforeInput(e: React.FormEvent<HTMLDivElement>) {
    const native = e.nativeEvent as InputEvent;
    if (native.inputType !== "insertParagraph") return;
    const root = editorRef.current;
    if (!root) return;
    const block = caretBlock(root);
    if (!block || !/^h[1-6]$/.test(block.tagName.toLowerCase())) return;
    // Only when splitting at the very end — mid-heading splits should keep
    // producing a heading, the way any editor would.
    const sel = window.getSelection();
    const atEnd =
      sel?.isCollapsed &&
      sel.anchorOffset === (sel.anchorNode?.textContent?.length ?? 0) &&
      block.lastChild?.contains(sel.anchorNode ?? block);
    if (!atEnd) return;
    e.preventDefault();
    const p = document.createElement("p");
    p.appendChild(document.createElement("br"));
    block.after(p);
    placeCaret(p);
    handleEditorInput();
  }

  /** Medium-style block behaviour, kept to the few keys that matter:
   * `#`…`######` + space promotes the block to that heading level; Enter
   * out of a heading returns to body copy; Backspace at the head of an
   * empty heading demotes it back to a paragraph. */
  function handleEditorKeyDown(e: React.KeyboardEvent<HTMLDivElement>) {
    const root = editorRef.current;
    if (!root) return;
    const block = caretBlock(root);
    if (!block) return;
    const tag = block.tagName.toLowerCase();
    const level = /^h[1-6]$/.test(tag) ? Number(tag[1]) : 0;
    const text = block.textContent ?? "";

    if (e.key === " " && level === 0) {
      const m = /^(#{1,6})$/.exec(text);
      if (m) {
        e.preventDefault();
        setBlockLevel(root, block, m[1].length, "");
        handleEditorInput();
      }
      return;
    }
    if (e.key === "Backspace" && level > 0 && text === "") {
      e.preventDefault();
      setBlockLevel(root, block, 0, "");
      handleEditorInput();
    }
  }

  useEffect(
    () => () => {
      if (saveTimer.current) window.clearTimeout(saveTimer.current);
      if (paragraphTimer.current) window.clearTimeout(paragraphTimer.current);
    },
    []
  );

  function insertEmbed(objectId: string) {
    const el = editorRef.current;
    const token = `![[${objectId}]]`;
    if (el) {
      el.focus();
      // execCommand keeps the browser's own undo stack intact — hand-built
      // DOM insertion would silently break ⌘Z inside the document.
      if (!caretBlock(el)) placeCaret((el.lastElementChild as HTMLElement) ?? el, true);
      document.execCommand("insertText", false, token);
      handleEditorInput();
    } else {
      handleBodyChange(body + token);
    }
    // Writing creates relationships back into the archive (#137's
    // principle): embedding X into a bound note records note→X.
    if (boundNote && objectId !== boundNote.id) {
      useStore.getState().addObjectRelation({
        sourceObjectId: boundNote.id,
        targetObjectId: objectId,
        relationType: "references",
      });
    }
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
        <div className="max-w-[42rem] mx-auto px-6 pt-8 pb-24">
          <div className="flex items-center gap-2 mb-8">
            {/* Leaving is NAVIGATION, not dismissal — a back arrow naming
                the destination, where an × read as "close the panel". */}
            <button
              onClick={() => useStore.getState().openWriting(null)}
              className="font-mono text-[11px] inline-flex items-center gap-1.5 -ml-1 px-1.5 py-1 rounded text-muted hover:text-ink hover:bg-line/40"
              title="Everything is saved"
            >
              <ArrowLeft size={12} /> {backLabel}
            </button>
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
            {/* Reading comfort, not decoration — persisted like grid zoom. */}
            <div className="flex items-center gap-0.5 font-mono text-muted">
              <button
                onClick={() => setWritingFontSize(fontSize - 1)}
                className="w-6 h-6 rounded hover:bg-line/40 hover:text-ink text-[11px]"
                title="Smaller text"
                aria-label="Decrease text size"
              >
                A
              </button>
              <button
                onClick={() => setWritingFontSize(fontSize + 1)}
                className="w-6 h-6 rounded hover:bg-line/40 hover:text-ink text-[15px]"
                title="Larger text"
                aria-label="Increase text size"
              >
                A
              </button>
            </div>
          </div>

          {doc ? (
            <input
              value={title}
              onChange={(e) =>
                useStore.getState().updateWritingDoc(doc.id, { title: e.target.value })
              }
              placeholder="Title"
              className="editorial w-full bg-transparent font-bold outline-none mb-3 placeholder:text-muted/40"
              style={{ fontSize: fontSize * 2.1 }}
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
              placeholder="Title"
              className="editorial w-full bg-transparent font-bold outline-none mb-3 placeholder:text-muted/40"
              style={{ fontSize: fontSize * 2.1 }}
              aria-label="Note title"
            />
          ) : null}

          {embeds.length > 0 && (
            <div className="flex flex-wrap gap-1.5 my-2">
              {embeds.map((o) => (
                <EmbedChip
                  key={o.id}
                  object={o}
                  onRemove={() => {
                    const next = body
                      .split(`![[${o.id}]]`)
                      .join("")
                      .replace(/\n{3,}/g, "\n\n");
                    handleBodyChange(next);
                    // Programmatic body rewrites are the one case that must
                    // repaint — the DOM can't know the token vanished.
                    if (editorRef.current) paintEditor(editorRef.current, next);
                  }}
                />
              ))}
            </div>
          )}

          <div className="relative">
            {body === "" && (
              <p
                className="editorial absolute left-0 top-0 pointer-events-none text-muted/45"
                style={{ fontSize }}
              >
                Tell the story… — "# " for a heading, drop any object to embed it
              </p>
            )}
            <div
              ref={editorRef}
              contentEditable
              suppressContentEditableWarning
              role="textbox"
              aria-multiline="true"
              aria-label="Document body"
              spellCheck
              onInput={handleEditorInput}
              onBeforeInput={handleBeforeInput}
              onKeyDown={handleEditorKeyDown}
              onKeyUp={trackParagraph}
              onClick={trackParagraph}
              onPaste={(e) => {
                // Plain text only: pasted markup would smuggle styling the
                // markdown storage format can't represent.
                e.preventDefault();
                document.execCommand("insertText", false, e.clipboardData.getData("text/plain"));
                handleEditorInput();
              }}
              onDragOver={(e) => {
                if (e.dataTransfer.types.includes(DRAG_MIME)) e.preventDefault();
              }}
              onDrop={(e) => {
                const ids = readDraggedIds(e);
                if (ids.length === 0) return;
                e.preventDefault();
                for (const id of ids) insertEmbed(id);
              }}
              className="editorial w-full min-h-[62vh] bg-transparent outline-none text-ink/90"
              style={{ fontSize }}
            />
          </div>
        </div>
      </div>

      {/* The panel's own edge carries its name (Samuel: "put the
          references label in the endidura") — a vertical tab on the seam,
          so the header stays free of chrome and the affordance sits where
          the panel actually opens from. */}
      <button
        onClick={() => setShowRefs((v) => !v)}
        className={[
          "shrink-0 w-7 h-full flex items-center justify-center border-l transition-colors",
          showRefs
            ? "border-line/70 bg-canvas text-ink"
            : "border-line/50 bg-canvas/60 text-muted hover:text-ink hover:bg-canvas",
        ].join(" ")}
        aria-pressed={showRefs}
        aria-label={showRefs ? "Hide references" : "Show references"}
        title={
          showRefs
            ? "Hide the references panel"
            : "References — archive suggestions beside the document"
        }
      >
        <span
          className="font-mono text-[9px] uppercase tracking-[0.22em] whitespace-nowrap"
          style={{ writingMode: "vertical-rl", transform: "rotate(180deg)" }}
        >
          {showRefs ? "◂ " : "▸ "}
          {visualContext ? "References" : "Related content"}
        </span>
      </button>

      {/* References — part of the workspace, not a floating panel. The
          editor never remounts when this opens: cursor/scroll survive. */}
      {showRefs && (
        <div className="w-72 shrink-0 h-full overflow-y-auto bg-canvas shadow-[inset_10px_0_16px_-12px_rgba(0,0,0,0.2)] px-3 pt-8 pb-6">
          <div className="flex items-center justify-end gap-1 mb-2 min-h-[22px]">
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
