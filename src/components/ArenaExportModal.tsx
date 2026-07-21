import { useEffect, useMemo, useState } from "react";
import { ArrowSquareOut, X } from "@phosphor-icons/react";
import { useStore } from "../store";
import {
  createArenaChannel,
  exportObjectsToChannel,
  fetchArenaAccount,
  fetchMyChannels,
  type ArenaAccount,
  type ArenaChannel,
  type ArenaExportProgress,
  type ArenaExportResult,
  type ArenaVisibility,
} from "../lib/arenaExport";
import { planArenaBlock, planKindLabel } from "../lib/arenaMapping";
import type { DesignObject } from "../types";

/**
 * The unified Are.na exporter — one object or a whole collection, always
 * through the same centralized type-mapping (lib/arenaMapping). Covers the
 * export follow-up brief: it names the destination account before
 * publishing (#3), lets a single object target an existing channel or a new
 * one (#4), reports per-object skips/failures faithfully (#1/#2), and
 * records each publication back onto the object (#5).
 */
export function ArenaExportModal({
  objects,
  defaultTitle,
  defaultDescription,
  onClose,
}: {
  objects: DesignObject[];
  defaultTitle: string;
  defaultDescription?: string;
  onClose: () => void;
}) {
  const recordArenaPlacement = useStore((s) => s.recordArenaPlacement);
  const single = objects.length === 1;

  const [account, setAccount] = useState<ArenaAccount | null | undefined>(undefined);
  const [dest, setDest] = useState<"new" | "existing">(single ? "existing" : "new");
  const [title, setTitle] = useState(defaultTitle);
  const [description, setDescription] = useState(defaultDescription ?? "");
  const [visibility, setVisibility] = useState<ArenaVisibility>("closed");
  const [includeMetadata, setIncludeMetadata] = useState(true);

  const [channels, setChannels] = useState<ArenaChannel[] | null>(null);
  const [channelsError, setChannelsError] = useState<string | null>(null);
  const [channelQuery, setChannelQuery] = useState("");
  const [selectedChannelId, setSelectedChannelId] = useState<number | null>(null);

  const [phase, setPhase] = useState<"form" | "running" | "done">("form");
  const [progress, setProgress] = useState<ArenaExportProgress>({
    done: 0,
    total: objects.length,
    published: 0,
    skipped: 0,
    failed: 0,
  });
  const [results, setResults] = useState<ArenaExportResult[]>([]);
  const [resultChannel, setResultChannel] = useState<ArenaChannel | null>(null);
  const [error, setError] = useState<string | null>(null);

  // Who will own the export — fetched once so the user never publishes blind.
  useEffect(() => {
    fetchArenaAccount().then(setAccount);
  }, []);

  // Lazily load the account's channels the first time the "existing" tab is
  // shown (single-object default) — a read, no writes.
  useEffect(() => {
    if (dest !== "existing" || channels !== null || account == null) return;
    fetchMyChannels()
      .then((cs) => setChannels(cs))
      .catch((err) => setChannelsError((err as Error).message));
  }, [dest, channels, account]);

  // Pre-flight tally — a pure pass over the mapping, so the user sees what
  // each object will BECOME (or that it'll be skipped) before publishing.
  const tally = useMemo(() => {
    const counts: Record<string, number> = {};
    for (const o of objects) {
      const label = planKindLabel(planArenaBlock(o, { includeMetadata }));
      counts[label] = (counts[label] ?? 0) + 1;
    }
    return counts;
  }, [objects, includeMetadata]);
  const skipCount = tally.skipped ?? 0;
  const exportableCount = objects.length - skipCount;

  const filteredChannels = useMemo(() => {
    if (!channels) return [];
    const q = channelQuery.trim().toLowerCase();
    return q ? channels.filter((c) => c.title.toLowerCase().includes(q)) : channels;
  }, [channels, channelQuery]);

  async function start() {
    if (!account) return;
    setPhase("running");
    setError(null);
    setResults([]);
    try {
      let channel: ArenaChannel;
      if (dest === "new") {
        channel = await createArenaChannel({
          title: title.trim() || defaultTitle,
          description: description.trim() || undefined,
          visibility,
        });
      } else {
        const picked = channels?.find((c) => c.id === selectedChannelId);
        if (!picked) throw new Error("Pick a channel first");
        channel = picked;
      }
      await exportObjectsToChannel(objects, channel, account, { includeMetadata }, (result, prog) => {
        setProgress(prog);
        setResults((r) => [...r, result]);
        if (result.status === "published" && result.placement) {
          recordArenaPlacement(result.objectId, result.placement);
        }
      });
      setResultChannel(channel);
      setPhase("done");
    } catch (err) {
      setError((err as Error).message);
      setPhase("form");
    }
  }

  const failedResults = results.filter((r) => r.status === "failed");
  const skippedResults = results.filter((r) => r.status === "skipped");
  const canExport =
    !!account && exportableCount > 0 && (dest === "new" ? true : selectedChannelId !== null);

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center">
      <div className="absolute inset-0 bg-black/30" onClick={phase === "running" ? undefined : onClose} />
      <div className="relative bg-panel rounded border border-line shadow-2xl w-full max-w-md p-5">
        <div className="flex items-center justify-between mb-2">
          <div className="text-sm font-medium">
            {single ? "Publish to Are.na" : "Export collection to Are.na"}
          </div>
          {phase !== "running" && (
            <button onClick={onClose} className="text-muted hover:text-ink" aria-label="Close">
              <X size={14} />
            </button>
          )}
        </div>

        {/* Destination account — always visible, never publish blind (#3). */}
        <div className="mb-3 rounded border border-line/70 bg-canvas/50 px-2.5 py-1.5 font-mono text-[11px]">
          {account === undefined ? (
            <span className="text-muted">checking Are.na account…</span>
          ) : account === null ? (
            <span className="text-danger">
              Not connected — add an Are.na token in Preferences first.
            </span>
          ) : (
            <span className="text-ink/80">
              Publishing as <span className="font-bold">@{account.slug}</span>
              {account.name ? ` · ${account.name}` : ""}
            </span>
          )}
        </div>

        {phase === "form" && account && (
          <>
            {/* Destination: a new channel, or an existing one. */}
            <div className="flex items-center gap-1 font-mono text-[11px] mb-3">
              <button
                onClick={() => setDest("new")}
                className={[
                  "flex-1 px-2 py-1.5 rounded border capitalize",
                  dest === "new" ? "border-accent/50 bg-accent/5 text-ink" : "border-line text-muted hover:text-ink",
                ].join(" ")}
              >
                New channel
              </button>
              <button
                onClick={() => setDest("existing")}
                className={[
                  "flex-1 px-2 py-1.5 rounded border",
                  dest === "existing" ? "border-accent/50 bg-accent/5 text-ink" : "border-line text-muted hover:text-ink",
                ].join(" ")}
              >
                Existing channel
              </button>
            </div>

            {dest === "new" ? (
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
                          ? "Only you (and collaborators) can see it"
                          : "Publicly visible and listed on Are.na"
                      }
                    >
                      {v}
                    </button>
                  ))}
                </div>
              </div>
            ) : (
              <div>
                <input
                  value={channelQuery}
                  onChange={(e) => setChannelQuery(e.target.value)}
                  placeholder="Filter your channels…"
                  className="w-full rounded border border-line px-2.5 py-1.5 text-sm outline-none focus:border-accent mb-1.5"
                />
                <div className="max-h-44 overflow-y-auto flex flex-col gap-0.5">
                  {channelsError ? (
                    <p className="text-[11px] text-danger px-1 py-2">{channelsError}</p>
                  ) : channels === null ? (
                    <p className="text-[11px] text-muted px-1 py-2 font-mono">loading channels…</p>
                  ) : filteredChannels.length === 0 ? (
                    <p className="text-[11px] text-muted px-1 py-2 font-mono">
                      no channels found — create a new one instead
                    </p>
                  ) : (
                    filteredChannels.map((c) => (
                      <button
                        key={c.id}
                        onClick={() => setSelectedChannelId(c.id)}
                        className={[
                          "text-left px-2.5 py-1.5 rounded font-mono text-[12px] flex items-center justify-between gap-2",
                          selectedChannelId === c.id ? "bg-accent/10 text-ink" : "text-ink/85 hover:bg-line/30",
                        ].join(" ")}
                      >
                        <span className="truncate">{c.title}</span>
                        {c.visibility && (
                          <span className="shrink-0 text-[10px] text-muted/70">{c.visibility}</span>
                        )}
                      </button>
                    ))
                  )}
                </div>
              </div>
            )}

            <label className="flex items-center gap-1.5 text-[12px] text-muted mt-2.5">
              <input
                type="checkbox"
                checked={includeMetadata}
                onChange={(e) => setIncludeMetadata(e.target.checked)}
              />
              Include local tags &amp; item type as metadata
            </label>

            {/* Pre-flight: what each object will become. */}
            <div className="mt-2 font-mono text-[10px] text-muted">
              {Object.entries(tally)
                .map(([k, n]) => `${n} ${k}`)
                .join(" · ")}
              {skipCount > 0 && (
                <span className="text-amber-700"> — {skipCount} can't be exported, will be skipped</span>
              )}
            </div>

            {error && <p className="text-[12px] text-danger mt-2">{error}</p>}

            <div className="mt-4 flex justify-end gap-2">
              <button onClick={onClose} className="text-sm px-3 py-1.5 rounded hover:bg-line/40 text-ink/70">
                Cancel
              </button>
              <button
                onClick={start}
                disabled={!canExport}
                className="text-sm px-3 py-1.5 rounded bg-ink text-white disabled:opacity-40"
              >
                {single ? "Publish" : `Export ${exportableCount} item${exportableCount === 1 ? "" : "s"}`}
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
              {progress.done} / {progress.total} · {progress.published} published
              {progress.skipped > 0 ? ` · ${progress.skipped} skipped` : ""}
              {progress.failed > 0 ? ` · ${progress.failed} failed` : ""}
            </p>
          </div>
        )}

        {phase === "done" && (
          <div className="py-1">
            <p className="text-[12px] text-ink/80 mb-2">
              {progress.published} published
              {progress.skipped > 0 ? `, ${progress.skipped} skipped` : ""}
              {progress.failed > 0 ? `, ${progress.failed} failed` : ""}.
            </p>
            {(skippedResults.length > 0 || failedResults.length > 0) && (
              <div className="max-h-28 overflow-y-auto mb-2 rounded border border-line/60 p-2 font-mono text-[10px] space-y-0.5">
                {failedResults.map((r) => (
                  <div key={r.objectId} className="text-danger truncate">
                    ✗ {r.title}: {r.reason}
                  </div>
                ))}
                {skippedResults.map((r) => (
                  <div key={r.objectId} className="text-amber-700 truncate">
                    – {r.title}: {r.reason}
                  </div>
                ))}
              </div>
            )}
            {resultChannel && (
              <a
                href={`https://www.are.na/channel/${resultChannel.slug}`}
                target="_blank"
                rel="noopener noreferrer"
                className="inline-flex items-center gap-1 text-[13px] text-accent hover:underline"
              >
                Open channel on Are.na <ArrowSquareOut size={12} />
              </a>
            )}
            <div className="mt-4 flex justify-end">
              <button onClick={onClose} className="text-sm px-3 py-1.5 rounded bg-ink text-white">
                Done
              </button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
