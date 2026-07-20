import { useEffect, useMemo, useRef, useState } from "react";
import { ArrowSquareOut, ArrowsClockwise, DownloadSimple, MagnifyingGlass } from "@phosphor-icons/react";
import { useStore } from "../store";
import { objectDragProps } from "../lib/objectDrag";
import { computeSimilarOutside } from "../lib/similarOutside";
import { buildDiscoveryQuery, WEB_PROVIDERS } from "../lib/discoveryQuery";
import { buildSearchIndex, searchObjects } from "../lib/search";
import type { DesignObject } from "../types";

/**
 * The Discovery membrane's content (external discovery brief): a research
 * expansion system, not "more images". Two halves, deliberately split:
 *
 * - HOW the query is generated: from the collection's own vocabulary, in
 *   two modes — "content" (what things are about) and "form" (how they
 *   look) — always editable before searching.
 * - WHERE it runs: per-source tabs, never one blended row. Organizer
 *   (internal), Are.na (real embedded API results, importable with full
 *   provenance), Web (delegated searches that open the provider in a new
 *   tab — Pinterest/Google have no adequate public search APIs, so
 *   Organizer builds the query and hands it over; plus paste-a-URL import
 *   so findings come back to the worktable).
 */

type ArenaResult = {
  id: number;
  title: string;
  imageUrl: string;
  blockUrl: string;
  sourceUrl: string;
  author: string;
};

function Thumb({
  imageUrl,
  title,
  children,
}: {
  imageUrl: string;
  title: string;
  children?: React.ReactNode;
}) {
  const [failed, setFailed] = useState(false);
  return (
    <div className="group relative shrink-0 w-28 h-28 rounded overflow-hidden border border-line/70 bg-panel shadow-card">
      {imageUrl && !failed ? (
        <img
          src={imageUrl}
          alt=""
          loading="lazy"
          className="w-full h-full object-cover pointer-events-none"
          onError={() => setFailed(true)}
        />
      ) : (
        <span className="block w-full h-full p-1.5 font-mono text-[8px] leading-snug text-muted overflow-hidden pointer-events-none">
          {title}
        </span>
      )}
      {children}
    </div>
  );
}

/** Internal result — a real object: draggable anywhere (N22), click opens. */
function InternalThumb({ object, onOpen }: { object: DesignObject; onOpen: (id: string) => void }) {
  const [failed, setFailed] = useState(false);
  return (
    <button
      onClick={() => onOpen(object.id)}
      {...objectDragProps([object.id])}
      title={object.title}
      className="shrink-0 w-28 h-28 rounded overflow-hidden border border-line/70 bg-panel hover:border-accent/50 cursor-grab active:cursor-grabbing shadow-card"
    >
      {object.imageUrl && !failed ? (
        <img
          src={object.imageUrl}
          alt=""
          loading="lazy"
          className="w-full h-full object-cover pointer-events-none"
          onError={() => setFailed(true)}
        />
      ) : (
        <span className="block w-full h-full p-1.5 font-mono text-[8px] leading-snug text-muted text-left overflow-hidden pointer-events-none">
          {object.title}
        </span>
      )}
    </button>
  );
}

export function DiscoveryStrip({
  collectionId,
  collectionName,
  members,
  memberIds,
  allObjects,
  onOpen,
}: {
  collectionId: string;
  collectionName: string;
  members: DesignObject[];
  memberIds: Set<string>;
  allObjects: DesignObject[];
  onOpen: (id: string) => void;
}) {
  const session = useStore((s) => s.discoverySession);
  const setSession = useStore((s) => s.setDiscoverySession);
  const patchSession = useStore((s) => s.patchDiscoverySession);

  // A session belongs to its collection; entering another collection's
  // membrane starts a fresh investigation (brief §6: it remembers where
  // it was born).
  const live = session?.sourceContext.id === collectionId ? session : null;
  const mode = live?.mode ?? "content";
  const query = live?.query ?? "";
  const activeSource = live?.activeSource ?? "organizer";

  const ensureSession = (patch?: Partial<NonNullable<typeof session>>) => {
    if (live) {
      if (patch) patchSession(patch);
      return;
    }
    setSession({
      sourceContext: { kind: "collection", id: collectionId, label: collectionName },
      mode: "content",
      // Default = EMPTY query → the Organizer tab shows the same-vibe MIX
      // (the compendium the membrane opens onto); a query only exists
      // once the user generates or types one.
      query: "",
      activeSource: "organizer",
      createdAt: new Date().toISOString(),
      ...patch,
    });
  };

  // First open of this collection's membrane: generate the starting query.
  useEffect(() => {
    if (!live) ensureSession();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [collectionId]);

  function regenerate(nextMode: "content" | "form") {
    ensureSession({
      mode: nextMode,
      query: buildDiscoveryQuery(collectionName, members, nextMode),
    });
  }

  // ── Organizer (internal) results: the query searches the archive OUTSIDE
  // this collection; an empty query falls back to hybrid same-vibe.
  const searchIndex = useMemo(() => buildSearchIndex(allObjects), [allObjects]);
  const internalResults = useMemo(() => {
    if (activeSource !== "organizer") return [];
    const q = query.trim();
    if (!q) return computeSimilarOutside(members, memberIds, allObjects);
    return searchObjects(searchIndex, q, allObjects)
      .filter((o) => !memberIds.has(o.id))
      .slice(0, 18);
  }, [activeSource, query, members, memberIds, allObjects, searchIndex]);

  // ── Are.na results (real API, via the local proxy).
  const [arenaResults, setArenaResults] = useState<ArenaResult[] | null>(null);
  const [arenaError, setArenaError] = useState<string | null>(null);
  const [arenaLoading, setArenaLoading] = useState(false);
  const lastArenaQuery = useRef<string | null>(null);

  async function runArenaSearch() {
    const q = query.trim();
    if (!q || arenaLoading) return;
    setArenaLoading(true);
    setArenaError(null);
    try {
      const res = await fetch(`/api/arena/search?q=${encodeURIComponent(q)}&type=Image`);
      if (!res.ok) {
        const body = await res.json().catch(() => null);
        throw new Error(
          res.status === 402 || res.status === 403
            ? "Are.na search requires a Premium account."
            : body?.detail || `Search failed (${res.status})`
        );
      }
      const body = (await res.json()) as { items: ArenaResult[] };
      setArenaResults(body.items);
      lastArenaQuery.current = q;
    } catch (err) {
      setArenaError((err as Error).message);
      setArenaResults(null);
    } finally {
      setArenaLoading(false);
    }
  }

  // Entering the Are.na tab (or changing the query then returning) runs
  // the search once per query — explicit re-run via the search button.
  useEffect(() => {
    if (activeSource === "arena" && query.trim() && lastArenaQuery.current !== query.trim()) {
      void runArenaSearch();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeSource]);

  function importArena(r: ArenaResult) {
    const st = useStore.getState();
    st.importExternalObject({
      title: r.title || `Are.na block ${r.id}`,
      imageUrl: r.imageUrl,
      sourceUrl: r.sourceUrl || r.blockUrl,
      provider: "arena",
      externalId: String(r.id),
      discoveryQuery: query,
      discoveredFromObjectIds: members.slice(0, 5).map((o) => o.id),
    });
    st.setFlashNotice(`Imported to the bench — provenance kept (Are.na #${r.id})`);
  }

  // ── Web tab: delegated searches + paste-URL import.
  const [pasteDraft, setPasteDraft] = useState("");
  function importPastedUrl() {
    const raw = pasteDraft.trim();
    if (!raw) return;
    let url: URL;
    try {
      url = new URL(raw);
    } catch {
      useStore.getState().setFlashNotice("That doesn't look like a URL.");
      return;
    }
    const provider = url.hostname.includes("pinterest")
      ? ("pinterest" as const)
      : url.hostname.includes("google")
      ? ("google" as const)
      : ("other" as const);
    const st = useStore.getState();
    st.importExternalObject({
      title: `${url.hostname}${url.pathname.length > 1 ? url.pathname : ""}`.slice(0, 80),
      imageUrl: "",
      sourceUrl: url.toString(),
      provider,
      discoveryQuery: query,
      discoveredFromObjectIds: members.slice(0, 5).map((o) => o.id),
    });
    st.setFlashNotice("Imported to the bench — open it later to enrich.");
    setPasteDraft("");
  }

  return (
    <div className="h-full flex flex-col px-5 pt-2.5 pb-3">
      {/* Header: label · mode · editable query · sources */}
      <div className="shrink-0 flex items-center gap-3 font-mono text-[10px] mb-2">
        <span className="uppercase tracking-[0.12em] text-muted shrink-0">
          Discover · outside this collection
        </span>
        <div className="flex items-center gap-1 shrink-0">
          {(["content", "form"] as const).map((m) => (
            <button
              key={m}
              onClick={() => regenerate(m)}
              className={[
                "px-2 py-0.5 rounded border capitalize",
                mode === m
                  ? "border-accent/50 bg-accent/5 text-ink"
                  : "border-line text-muted hover:text-ink",
              ].join(" ")}
              title={
                m === "content"
                  ? "Build the query from WHAT these things are about"
                  : "Build the query from HOW these things look"
              }
            >
              {m === "content" ? "Same content" : "Same form"}
            </button>
          ))}
        </div>
        <div className="flex-1 min-w-0 flex items-center gap-1">
          <input
            value={query}
            onChange={(e) => ensureSession({ query: e.target.value })}
            onKeyDown={(e) => {
              if (e.key === "Enter" && activeSource === "arena") void runArenaSearch();
            }}
            placeholder="query… (empty = similar mix)"
            className="flex-1 min-w-0 rounded border border-line/70 bg-panel px-2 py-1 text-[11px] outline-none focus:border-accent/50"
          />
          <button
            onClick={() => regenerate(mode)}
            className="shrink-0 w-6 h-6 flex items-center justify-center rounded text-muted hover:text-ink hover:bg-line/40"
            title="Regenerate the query from the collection"
            aria-label="Regenerate query"
          >
            <ArrowsClockwise size={12} />
          </button>
        </div>
        <div className="flex items-center gap-1 shrink-0">
          {(["organizer", "arena", "web"] as const).map((src) => (
            <button
              key={src}
              onClick={() => ensureSession({ activeSource: src })}
              className={[
                "px-2 py-0.5 rounded border",
                activeSource === src
                  ? "border-accent/50 bg-accent/5 text-ink"
                  : "border-line text-muted hover:text-ink",
              ].join(" ")}
            >
              {src === "organizer" ? "Organizer" : src === "arena" ? "Are.na" : "Web"}
            </button>
          ))}
        </div>
      </div>

      {/* Results area — one source at a time, never blended. */}
      <div className="flex-1 min-h-0">
        {activeSource === "organizer" &&
          (internalResults.length === 0 ? (
            <p className="font-mono text-[11px] text-muted/70">
              nothing in the archive matches — try the other mode, or search outside.
            </p>
          ) : (
            <div className="h-full flex gap-2.5 overflow-x-auto pb-1">
              {internalResults.map((o) => (
                <InternalThumb key={o.id} object={o} onOpen={onOpen} />
              ))}
            </div>
          ))}

        {activeSource === "arena" && (
          <div className="h-full">
            {arenaLoading ? (
              <p className="font-mono text-[11px] text-muted/70">searching are.na…</p>
            ) : arenaError ? (
              <p className="font-mono text-[11px] text-red-700">{arenaError}</p>
            ) : !arenaResults ? (
              <button
                onClick={() => void runArenaSearch()}
                className="font-mono text-[11px] text-accent hover:underline inline-flex items-center gap-1"
              >
                <MagnifyingGlass size={12} /> search are.na for “{query.trim() || "…"}”
              </button>
            ) : arenaResults.length === 0 ? (
              <p className="font-mono text-[11px] text-muted/70">no are.na results for this query.</p>
            ) : (
              <div className="h-full flex gap-2.5 overflow-x-auto pb-1">
                {arenaResults.map((r) => (
                  <Thumb key={r.id} imageUrl={r.imageUrl} title={r.title || String(r.id)}>
                    <div className="absolute inset-x-0 bottom-0 flex items-center justify-end gap-0.5 p-1 opacity-0 group-hover:opacity-100 transition-opacity bg-gradient-to-t from-black/40 to-transparent">
                      <button
                        onClick={() => importArena(r)}
                        className="w-6 h-6 rounded bg-panel/90 flex items-center justify-center text-ink/80 hover:text-ink shadow-card"
                        title="Import as an Organizer object (lands on the bench, provenance kept)"
                        aria-label={`Import ${r.title || r.id}`}
                      >
                        <DownloadSimple size={12} />
                      </button>
                      <a
                        href={r.blockUrl}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="w-6 h-6 rounded bg-panel/90 flex items-center justify-center text-ink/80 hover:text-ink shadow-card"
                        title="Open on Are.na"
                        aria-label="Open on Are.na"
                      >
                        <ArrowSquareOut size={12} />
                      </a>
                    </div>
                  </Thumb>
                ))}
              </div>
            )}
          </div>
        )}

        {activeSource === "web" && (
          <div className="h-full flex flex-col gap-2 font-mono text-[11px]">
            <p className="text-muted/80">
              Delegated search — Organizer builds the query, the provider runs it in a new tab;
              this collection stays exactly as it is.
            </p>
            <div className="flex items-center gap-2">
              {WEB_PROVIDERS.map((p) => (
                <a
                  key={p.key}
                  href={query.trim() ? p.url(query.trim()) : undefined}
                  target="_blank"
                  rel="noopener noreferrer"
                  className={[
                    "inline-flex items-center gap-1 px-2.5 py-1.5 rounded border",
                    query.trim()
                      ? "border-line text-ink/80 hover:text-ink hover:border-accent/40"
                      : "border-line/50 text-muted/50 pointer-events-none",
                  ].join(" ")}
                >
                  {p.label} <ArrowSquareOut size={11} />
                </a>
              ))}
            </div>
            <div className="flex items-center gap-1.5 mt-1">
              <input
                value={pasteDraft}
                onChange={(e) => setPasteDraft(e.target.value)}
                onKeyDown={(e) => e.key === "Enter" && importPastedUrl()}
                placeholder="paste a Pin / image URL to bring a finding back…"
                className="flex-1 min-w-0 rounded border border-line/70 bg-panel px-2 py-1 text-[11px] outline-none focus:border-accent/50"
              />
              <button
                onClick={importPastedUrl}
                disabled={!pasteDraft.trim()}
                className="shrink-0 px-2.5 py-1 rounded bg-ink text-white disabled:opacity-40"
              >
                Import
              </button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
