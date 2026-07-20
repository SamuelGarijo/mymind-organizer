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

/** A reference plus WHY it's there: the literal words in the document that
 * pulled it in (empty when the link isn't textual — a canvas connection or
 * a visual likeness — in which case `origin` says so in plain language). */
type Suggestion = { object: DesignObject; terms: string[]; origin?: string };

/** The document's own vocabulary: distinctive words, most-telling first.
 * Frequency × distinctiveness, no model involved — proper nouns and long
 * words outrank filler, and repetition is evidence of subject. */
function documentTerms(text: string, limit = 8): string[] {
  const counts = new Map<string, { n: number; proper: boolean; len: number }>();
  for (const tok of text.replace(EMBED_RE, "").match(/[A-Za-zÀ-ž0-9]{4,}/g) ?? []) {
    const low = tok.toLowerCase();
    if (STOPWORDS.has(low)) continue;
    const prev = counts.get(low);
    counts.set(low, {
      n: (prev?.n ?? 0) + 1,
      proper: (prev?.proper ?? false) || tok[0] === tok[0].toUpperCase(),
      len: tok.length,
    });
  }
  return [...counts.entries()]
    .map(([term, c]) => ({ term, score: c.n * (c.proper ? 2.5 : 1) + Math.min(c.len, 12) / 12 }))
    .sort((a, b) => b.score - a.score)
    .slice(0, limit)
    .map((t) => t.term);
}

/** Paints ranges over the editor WITHOUT touching its DOM — the CSS
 * Custom Highlight API exists for exactly this. Wrapping matches in
 * <mark>s would corrupt the block model the serializer reads back. */
const HIGHLIGHT_NAME = "org-ref-anchor";
function highlightTerms(root: HTMLElement | null, terms: string[]) {
  const api = (CSS as unknown as { highlights?: Map<string, unknown> }).highlights;
  if (!api) return; // Older engines simply get no highlight, nothing breaks.
  if (!root || terms.length === 0) {
    api.delete(HIGHLIGHT_NAME);
    return;
  }
  const ranges: Range[] = [];
  const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
  for (let node = walker.nextNode(); node; node = walker.nextNode()) {
    const text = (node.textContent ?? "").toLowerCase();
    for (const term of terms) {
      let from = text.indexOf(term);
      while (from !== -1) {
        const range = document.createRange();
        range.setStart(node, from);
        range.setEnd(node, from + term.length);
        ranges.push(range);
        from = text.indexOf(term, from + term.length);
      }
    }
  }
  if (ranges.length === 0) api.delete(HIGHLIGHT_NAME);
  else api.set(HIGHLIGHT_NAME, new (window as unknown as { Highlight: new (...r: Range[]) => unknown }).Highlight(...ranges));
}

function embeddedIds(body: string): string[] {
  const ids: string[] = [];
  for (const m of body.matchAll(EMBED_RE)) {
    if (!ids.includes(m[1])) ids.push(m[1]);
  }
  return ids;
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
  origin,
  terms = [],
}: {
  object: DesignObject;
  onInsert: (id: string) => void;
  /** Plain-language provenance for links with no word to point at. */
  origin?: string;
  /** The document's own words that pulled this in. */
  terms?: string[];
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
        <span className="block px-1.5 pt-1 font-mono text-[9px] text-muted truncate text-left">
          {object.title}
        </span>
        {/* Why this is here, in the archive's own words — never a guess. */}
        <span className="block px-1.5 pb-1 font-mono text-[8px] leading-tight text-muted/70 truncate text-left">
          {terms.length > 0 ? terms.slice(0, 3).join(" · ") : origin ?? ""}
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
  const pageWidth = useStore((s) => s.writingPageWidth) ?? 672;
  const setWritingPageWidth = useStore((s) => s.setWritingPageWidth);
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
  // The body as it stood at the last typing pause — what the suggestions
  // read. Keeping them off the live keystroke stream is what makes the
  // panel sit still while you write.
  const [settledBody, setSettledBody] = useState(storedBody);
  /** Text the author has selected, if any — the on-demand "what does this
   * connect to?" question. Never opens the panel by itself. */
  const [selectionText, setSelectionText] = useState("");
  /** Terms of the reference currently under the pointer, painted in the
   * text so the connection is visible in both directions. */
  const [hoverTerms, setHoverTerms] = useState<string[]>([]);
  const [draggingWidth, setDraggingWidth] = useState(false);
  const editorRef = useRef<HTMLDivElement>(null);
  const titleRef = useRef<HTMLTextAreaElement>(null);
  const saveTimer = useRef<number | null>(null);
  const settleTimer = useRef<number | null>(null);
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
    setSettledBody(storedBody);
    setPushState("idle");
    if (editorRef.current) paintEditor(editorRef.current, storedBody);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [targetKey]);

  // Selection is the author asking a question; it must never survive the
  // answer, so it clears the moment the selection collapses.
  useEffect(() => {
    function onSelectionChange() {
      const sel = window.getSelection();
      const root = editorRef.current;
      if (!sel || sel.isCollapsed || !root || !sel.anchorNode || !root.contains(sel.anchorNode)) {
        setSelectionText("");
        return;
      }
      setSelectionText(sel.toString().trim());
    }
    document.addEventListener("selectionchange", onSelectionChange);
    return () => document.removeEventListener("selectionchange", onSelectionChange);
  }, []);

  // Anchors are painted for whichever reference is hovered; leaving the
  // panel clears them. Also cleared on unmount so no stale ranges linger.
  useEffect(() => {
    highlightTerms(editorRef.current, hoverTerms);
  }, [hoverTerms, body]);
  useEffect(() => () => highlightTerms(null, []), []);

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

  /** The title box grows with its content — see the textarea below. */
  function autoGrowTitle() {
    const el = titleRef.current;
    if (!el) return;
    el.style.height = "auto";
    el.style.height = `${el.scrollHeight}px`;
  }
  useEffect(autoGrowTitle, [title, fontSize, pageWidth, targetKey]);

  // Height depends on the WIDTH the title has to wrap in, and that width
  // isn't final on first paint — measuring too early wrapped the title to
  // about one character per line and froze a ~1200px box that pushed the
  // body off screen (real bug, 2026-07-20). Re-measure whenever the box's
  // own width changes; comparing width only keeps it out of a feedback
  // loop with the height we're setting.
  useEffect(() => {
    const el = titleRef.current;
    if (!el || typeof ResizeObserver === "undefined") return;
    let lastWidth = el.clientWidth;
    const ro = new ResizeObserver(() => {
      if (el.clientWidth === lastWidth) return;
      lastWidth = el.clientWidth;
      autoGrowTitle();
    });
    ro.observe(el);
    return () => ro.disconnect();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [targetKey]);

  /** Suggestions read the document as it stood at the last pause. */
  function scheduleSettle() {
    if (settleTimer.current) window.clearTimeout(settleTimer.current);
    settleTimer.current = window.setTimeout(() => {
      const el = editorRef.current;
      if (el) setSettledBody(markdownFromDom(el));
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
    scheduleSettle();
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
      if (settleTimer.current) window.clearTimeout(settleTimer.current);
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

  // ── Reference suggestions. Content mode reads the WHOLE document, not
  // the paragraph under the cursor: a stable ranked list that doesn't
  // shuffle itself while you write (Samuel, 2026-07-20 — "en modo
  // escritura no quiero distracciones"). Each suggestion keeps the terms
  // that earned it, which is what makes the highlighting explainable
  // without any AI: the anchor is a literal word in your text.
  const allObjectsList = useMemo(() => Object.values(objects), [objects]);
  const searchIndex = useMemo(() => buildSearchIndex(allObjectsList), [allObjectsList]);
  const suggestions = useMemo<Suggestion[]>(() => {
    if (!showRefs) return [];
    const exclude = new Set([...embeds.map((o) => o.id), boundNote?.id ?? ""]);
    if (refMode === "content") {
      const terms = documentTerms(`${title}\n${settledBody}`);
      if (terms.length === 0) return [];
      // Fuse treats a query as ONE fuzzy pattern — a whole document
      // matches nothing. Ask per distinctive term and pool the answers,
      // scoring by rank so an object several terms agree on rises.
      const pool = new Map<string, { object: DesignObject; score: number; terms: string[] }>();
      for (const term of terms) {
        const hits = searchObjects(searchIndex, term, allObjectsList)
          .filter((o) => !exclude.has(o.id))
          .slice(0, 8);
        hits.forEach((o, rank) => {
          const entry = pool.get(o.id) ?? { object: o, score: 0, terms: [] };
          entry.score += 8 - rank;
          if (!entry.terms.includes(term)) entry.terms.push(term);
          pool.set(o.id, entry);
        });
      }
      return [...pool.values()]
        .sort((a, b) => b.score - a.score || b.terms.length - a.terms.length)
        .slice(0, 14)
        .map(({ object, terms: t }) => ({ object, terms: t }));
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
      .filter((o): o is DesignObject => Boolean(o))
      // Visual similarity has no word to point at — say so instead of
      // faking an anchor.
      .map((object) => ({ object, terms: [], origin: "looks like this document's images" }));
  }, [
    showRefs,
    refMode,
    title,
    settledBody,
    embeds,
    boundNote,
    searchIndex,
    allObjectsList,
    relations,
    objects,
  ]);

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

  /** Selecting text asks "what does THIS connect to?": the references
   * whose anchor words appear inside the selection rise to the top and
   * stay lit; the rest dim rather than disappear, so the general ranking
   * is still there when the selection clears. */
  const selectionLower = selectionText.toLowerCase();
  const ranked = useMemo(() => {
    if (selectionLower.length < 3) return suggestions.map((s) => ({ s, matched: false }));
    const scored = suggestions.map((s) => ({
      s,
      matched: s.terms.some((t) => selectionLower.includes(t)),
    }));
    return [...scored.filter((x) => x.matched), ...scored.filter((x) => !x.matched)];
  }, [suggestions, selectionLower]);
  const anySelectionMatch = ranked.some((x) => x.matched);

  if (!target || (!doc && !boundNote)) return null;

  return (
    <div className="h-full flex min-h-0">
      {/* The document — center stage (Focus). */}
      <div className="flex-1 min-w-0 h-full overflow-y-auto relative" data-content-scroll>
        <div
          className="group/page mx-auto px-6 pt-8 pb-24 relative"
          style={{ maxWidth: pageWidth }}
        >
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

          {/* A title WRAPS — a single-line field silently cut long titles
              off at the measure (reported 2026-07-20). Auto-growing
              textarea: the words are never hidden from their author. */}
          {doc ? (
            <textarea
              ref={titleRef}
              rows={1}
              value={title}
              onChange={(e) =>
                useStore.getState().updateWritingDoc(doc.id, { title: e.target.value })
              }
              onKeyDown={(e) => e.key === "Enter" && e.preventDefault()}
              placeholder="Title"
              className="editorial w-full bg-transparent font-bold outline-none resize-none overflow-hidden mb-3 placeholder:text-muted/40"
              style={{ fontSize: fontSize * 2.1, lineHeight: 1.15 }}
            />
          ) : boundNote ? (
            <textarea
              ref={titleRef}
              rows={1}
              defaultValue={title}
              key={boundNote.id}
              onInput={autoGrowTitle}
              onBlur={(e) => {
                const next = e.target.value.trim();
                if (next && next !== boundNote.title) {
                  useStore.getState().updateObject(boundNote.id, { title: next });
                }
              }}
              onKeyDown={(e) => {
                if (e.key === "Enter") {
                  e.preventDefault();
                  (e.target as HTMLTextAreaElement).blur();
                }
              }}
              placeholder="Title"
              className="editorial w-full bg-transparent font-bold outline-none resize-none overflow-hidden mb-3 placeholder:text-muted/40"
              style={{ fontSize: fontSize * 2.1, lineHeight: 1.15 }}
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
              onKeyUp={scheduleSettle}
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

          {/* The measure is the author's call — drag either edge of the
              page. It sits INSIDE the column (an outside offset gets
              clipped by the scroller) and only shows itself once the
              pointer is on the page: summoned on intent, not resident. */}
          {([
            ["left", "left-0"],
            ["right", "right-0"],
          ] as const).map(([side, pos]) => (
          <div
            key={side}
            role="separator"
            aria-label={`Page width (${side} edge)`}
            aria-orientation="vertical"
            onPointerDown={(e) => {
              e.preventDefault();
              setDraggingWidth(true);
              const el = e.currentTarget;
              // Capture keeps the drag alive over the editor and the panel;
              // it's an optimisation, never a requirement (the window
              // listeners below do the real work).
              try {
                el.setPointerCapture(e.pointerId);
              } catch {
                /* no capture available — the drag still tracks fine */
              }
              // The column centres on the WRITING AREA, not the window —
              // with the references panel open those differ, and using the
              // window would make the edge jump away from the pointer.
              const host = el.closest("[data-content-scroll]") ?? el.parentElement!;
              const hostRect = host.getBoundingClientRect();
              const centre = hostRect.left + hostRect.width / 2;
              const move = (ev: PointerEvent) =>
                // Centred column: either edge moves half as far as the
                // width, and the left edge moves the opposite way.
                setWritingPageWidth(Math.round(Math.abs(ev.clientX - centre) * 2));
              const up = () => {
                setDraggingWidth(false);
                try {
                  el.releasePointerCapture(e.pointerId);
                } catch {
                  /* nothing captured */
                }
                window.removeEventListener("pointermove", move);
                window.removeEventListener("pointerup", up);
              };
              window.addEventListener("pointermove", move);
              window.addEventListener("pointerup", up);
            }}
            onDoubleClick={() => setWritingPageWidth(null)}
            title={"Drag to change the page width\nDouble-click to reset"}
            className={`group/grip absolute top-0 bottom-0 ${pos} w-6 cursor-col-resize flex items-center justify-center`}
          >
            {/* A hairline marks the page's edge at all times — it reads as
                paper, not chrome — and thickens into a real grip as the
                pointer approaches (the register of Claude's own splitter). */}
            <span
              className={[
                "h-full rounded-full transition-all duration-150",
                draggingWidth
                  ? "w-[3px] bg-accent/70"
                  // The `!` is load-bearing: both hover variants match at
                  // once and Tailwind's emitted order lets the page rule
                  // win, so direct hover needs to override it explicitly.
                  : "w-px bg-line/60 group-hover/page:bg-line group-hover/grip:w-[3px] group-hover/grip:!bg-accent/60",
              ].join(" ")}
            />
          </div>
          ))}

          {/* Only while dragging: the number you're actually setting. */}
          {draggingWidth && (
            <div className="absolute top-2 right-6 font-mono text-[10px] text-muted pointer-events-none">
              {pageWidth}px
            </div>
          )}
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
                    {/* Your own hand, not a word match — nothing to point
                        at in the text, so it says where it came from. */}
                    <ReferenceThumb
                      object={o}
                      onInsert={insertEmbed}
                      origin="you connected this on a canvas"
                    />
                  </div>
                ))}
              </div>
            </div>
          )}
          {ranked.length === 0 ? (
            <p className="font-mono text-[10px] text-muted/70 leading-relaxed">
              {refMode === "content"
                ? "write a little — the archive answers to the words on the page."
                : "no visual context yet — embed an object (or open a note) to seed form similarity."}
            </p>
          ) : (
            <div className="flex flex-col gap-2">
              {selectionLower.length >= 3 && (
                <p className="font-mono text-[9px] text-muted/70 leading-relaxed mb-0.5">
                  {anySelectionMatch
                    ? "↑ connected to what you selected"
                    : "nothing here answers to that selection"}
                </p>
              )}
              {ranked.map(({ s, matched }) => (
                <div
                  key={s.object.id}
                  // The unmatched aren't hidden — the general ranking is
                  // still the answer once the selection clears.
                  className={[
                    "rounded transition-opacity",
                    selectionLower.length >= 3 && !matched ? "opacity-35" : "opacity-100",
                    matched ? "ring-1 ring-accent/50" : "",
                  ].join(" ")}
                  onPointerEnter={() => setHoverTerms(s.terms)}
                  onPointerLeave={() => setHoverTerms([])}
                >
                  <ReferenceThumb
                    object={s.object}
                    onInsert={insertEmbed}
                    origin={s.origin}
                    terms={s.terms}
                  />
                </div>
              ))}
            </div>
          )}
          <p className="mt-3 font-mono text-[9px] text-muted/60 leading-relaxed">
            hover a reference to light up the words that summoned it · select text to
            surface its own · drag into the page or the bench{" "}
            <ArrowSquareOut size={9} className="inline" />
          </p>
        </div>
      )}
    </div>
  );
}
