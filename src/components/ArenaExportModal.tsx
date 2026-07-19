import { useState } from "react";
import { X } from "@phosphor-icons/react";
import {
  exportCollectionToArena,
  type ArenaExportProgress,
  type ArenaVisibility,
} from "../lib/arenaExport";
import type { DesignObject } from "../types";

/**
 * Exports one collection (manual or smart — the caller already resolved
 * membership via getVisibleObjects, same as every other collection-scoped
 * view) as an Are.na channel. A one-way, additive translation: this never
 * reads anything back from Are.na, never touches mymind, and creates a
 * brand new channel every time — there's no "sync" concept here, just a
 * snapshot export.
 */
export function ArenaExportModal({
  collectionName,
  collectionDescription,
  objects,
  onClose,
}: {
  collectionName: string;
  collectionDescription?: string;
  objects: DesignObject[];
  onClose: () => void;
}) {
  const [title, setTitle] = useState(collectionName);
  const [description, setDescription] = useState(collectionDescription ?? "");
  const [visibility, setVisibility] = useState<ArenaVisibility>("closed");
  const [includeMetadata, setIncludeMetadata] = useState(true);
  const [phase, setPhase] = useState<"form" | "running" | "done" | "error">("form");
  const [progress, setProgress] = useState<ArenaExportProgress>({ done: 0, total: 0, failed: [] });
  const [resultUrl, setResultUrl] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function start() {
    setPhase("running");
    setError(null);
    try {
      const { channel, failed } = await exportCollectionToArena(
        objects,
        { title: title.trim() || collectionName, description: description.trim() || undefined, visibility },
        { includeMetadata },
        setProgress
      );
      setResultUrl(`https://www.are.na/channel/${channel.slug}`);
      setProgress((p) => ({ ...p, failed }));
      setPhase("done");
    } catch (err) {
      setError((err as Error).message);
      setPhase("error");
    }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center">
      <div className="absolute inset-0 bg-black/30" onClick={phase === "running" ? undefined : onClose} />
      <div className="relative bg-panel rounded-card border border-line shadow-2xl w-full max-w-sm p-5">
        <div className="flex items-center justify-between mb-1">
          <div className="text-sm font-medium">Export to Are.na</div>
          {phase !== "running" && (
            <button onClick={onClose} className="text-muted hover:text-ink" aria-label="Close">
              <X size={14} />
            </button>
          )}
        </div>

        {phase === "form" && (
          <>
            <p className="text-[12px] text-muted mb-3">
              Creates a new Are.na channel and adds one block per item ({objects.length} total).
              One-way: this never reads back from Are.na or edits this channel again later — running
              it twice makes two channels.
            </p>
            <div className="space-y-2">
              <input
                autoFocus
                value={title}
                onChange={(e) => setTitle(e.target.value)}
                placeholder="Channel title"
                className="w-full rounded border border-line px-2.5 py-1.5 text-sm outline-none focus:border-accent"
              />
              <textarea
                value={description}
                onChange={(e) => setDescription(e.target.value)}
                placeholder="Description (optional)"
                rows={2}
                className="w-full rounded border border-line px-2.5 py-1.5 text-sm outline-none focus:border-accent resize-none"
              />
              <div className="flex items-center gap-1 font-mono text-[11px]">
                {(["closed", "private", "public"] as const).map((v) => (
                  <button
                    key={v}
                    onClick={() => setVisibility(v)}
                    className={[
                      "flex-1 px-2 py-1.5 rounded border capitalize",
                      visibility === v ? "border-accent/50 bg-accent/5 text-ink" : "border-line text-muted hover:text-ink",
                    ].join(" ")}
                    title={
                      v === "closed"
                        ? "Reachable only by direct link, not publicly listed"
                        : v === "private"
                        ? "Only you (and collaborators you add later) can see it"
                        : "Publicly visible and listed on Are.na"
                    }
                  >
                    {v}
                  </button>
                ))}
              </div>
              <label className="flex items-center gap-1.5 text-[12px] text-muted">
                <input
                  type="checkbox"
                  checked={includeMetadata}
                  onChange={(e) => setIncludeMetadata(e.target.checked)}
                />
                Include local tags &amp; item type as metadata
                <span
                  className="text-muted/60"
                  title="Are.na blocks only render title/description in their own UI — this stores tags/role as custom key-value metadata, retrievable via Are.na's API but not shown anywhere in are.na itself"
                >
                  (not shown in Are.na's UI)
                </span>
              </label>
            </div>
            {error && <p className="text-[12px] text-red-700 mt-2">{error}</p>}
            <div className="mt-4 flex justify-end gap-2">
              <button onClick={onClose} className="text-sm px-3 py-1.5 rounded hover:bg-line/40 text-ink/70">
                Cancel
              </button>
              <button
                onClick={start}
                disabled={objects.length === 0}
                className="text-sm px-3 py-1.5 rounded bg-ink text-white disabled:opacity-40"
              >
                Export {objects.length} item{objects.length === 1 ? "" : "s"}
              </button>
            </div>
          </>
        )}

        {phase === "running" && (
          <div className="py-2">
            <div className="h-1.5 rounded bg-line overflow-hidden mb-2">
              <div
                className="h-full bg-accent transition-[width] duration-150"
                style={{ width: `${progress.total ? (progress.done / progress.total) * 100 : 0}%` }}
              />
            </div>
            <p className="text-[12px] text-muted font-mono">
              {progress.done} / {progress.total} exported
              {progress.failed.length > 0 ? ` · ${progress.failed.length} failed` : ""}
            </p>
          </div>
        )}

        {phase === "done" && (
          <div className="py-1">
            <p className="text-[12px] text-ink/80 mb-2">
              Done — {progress.total - progress.failed.length} of {progress.total} items exported.
              {progress.failed.length > 0 && (
                <span className="block mt-1 text-red-700">
                  {progress.failed.length} failed: {progress.failed.slice(0, 5).join(", ")}
                  {progress.failed.length > 5 ? "…" : ""}
                </span>
              )}
            </p>
            {resultUrl && (
              <a
                href={resultUrl}
                target="_blank"
                rel="noopener noreferrer"
                className="text-[13px] text-accent hover:underline"
              >
                Open channel on Are.na →
              </a>
            )}
            <div className="mt-4 flex justify-end">
              <button onClick={onClose} className="text-sm px-3 py-1.5 rounded bg-ink text-white">
                Done
              </button>
            </div>
          </div>
        )}

        {phase === "error" && (
          <div className="py-1">
            <p className="text-[12px] text-red-700 mb-3">{error}</p>
            <div className="flex justify-end gap-2">
              <button onClick={onClose} className="text-sm px-3 py-1.5 rounded hover:bg-line/40 text-ink/70">
                Close
              </button>
              <button onClick={() => setPhase("form")} className="text-sm px-3 py-1.5 rounded bg-ink text-white">
                Try again
              </button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
