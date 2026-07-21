import { useEffect, useRef, useState } from "react";
import { allObjectsOf, useStore } from "../store";
import { arenaChannelSlug, importFiles, importUrl, type ImportResult } from "../lib/importSomething";
import { describePush, PUSH_LIMIT, pushImported } from "../lib/pushToMymind";

/**
 * "+ ADD Something" — one door for everything that didn't come from mymind
 * (Samuel, 2026-07-21).
 *
 * One door on purpose. A file picker, a URL field and an Are.na importer as
 * three separate features would be three things to find and three places to
 * forget; they're the same intention — *this belongs in my archive* — and
 * the difference between a dropped file and a pasted board is something the
 * app can work out for itself.
 *
 * Nothing here touches mymind. These objects are local, carry a non-mymind
 * `source`, and are therefore already outside the resync reconciliation that
 * could otherwise delete them. That's policy, not a gap: this app reads
 * mymind and writes only the three sanctioned things.
 */
export function AddSomethingModal({
  initialFiles,
  onClose,
}: {
  /** Files already dropped on the window — the modal opens holding them,
   * so a drop from the desktop is one gesture and not "open, then drop". */
  initialFiles?: File[];
  onClose: () => void;
}) {
  const [url, setUrl] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [over, setOver] = useState(false);
  const fileInput = useRef<HTMLInputElement>(null);
  const ranInitial = useRef(false);

  function land(result: ImportResult, what: string) {
    if (result.objects.length === 0) {
      setError(result.skipped[0] ?? `Nothing in ${what} we could read.`);
      return;
    }
    const state = useStore.getState();
    state.pushUndo(`add ${result.objects.length} item${result.objects.length === 1 ? "" : "s"}`);
    state.importObjects(result.objects);
    state.setFlashNotice(
      `Added ${result.objects.length.toLocaleString()} from ${what}${
        result.skipped.length > 0 ? ` · ${result.skipped.length} skipped` : ""
      }. They have no kind yet — Classify is where they get one.`
    );
    onClose();

    // Then, and only then, mymind — so the import is never held hostage to
    // a network call. Everything is already in the archive and usable by
    // the time this starts; when the ids come back the objects are re-keyed
    // underneath, which is invisible except that they stop being local.
    //
    // Capped at PUSH_LIMIT (Samuel's call): nothing sent here can be undone
    // by this app — only he can remove it, from mymind — so a wrong board
    // costs 20 objects to clear, not 500.
    void pushImported(result.objects, allObjectsOf(useStore.getState().objects)).then((outcome) => {
      if (outcome.adopted.length === 0 && outcome.skipped.length === 0) return;
      const after = useStore.getState();
      after.adoptMymindObjects(outcome.adopted);
      after.setFlashNotice(describePush(outcome));
    });
  }

  async function takeFiles(files: File[]) {
    if (files.length === 0) return;
    setBusy(true);
    setError(null);
    try {
      land(await importFiles(files), files.length === 1 ? files[0].name : `${files.length} files`);
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setBusy(false);
    }
  }

  // Files dropped on the window arrive with the modal; import them at once
  // rather than making him confirm a drop he already made.
  useEffect(() => {
    if (ranInitial.current || !initialFiles?.length) return;
    ranInitial.current = true;
    void takeFiles(initialFiles);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [initialFiles]);

  async function takeUrl() {
    const value = url.trim();
    if (!value) return;
    setBusy(true);
    setError(null);
    try {
      const slug = arenaChannelSlug(value);
      land(await importUrl(value), slug ? `the "${slug}" board` : "that link");
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setBusy(false);
    }
  }

  const slug = arenaChannelSlug(url);

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
      <div className="absolute inset-0 bg-black/30" onClick={onClose} />
      <div className="relative w-full max-w-md rounded-2xl border border-line bg-panel p-4 shadow-cardHover">
        <div className="text-sm text-ink">Add something</div>
        <p className="mt-0.5 font-mono text-[11px] text-muted">
          Files from your machine, a link, or an Are.na board. The first {PUSH_LIMIT} go to
          mymind too, for its tagging — the rest stay local.
        </p>

        <div
          onDragOver={(e) => {
            e.preventDefault();
            setOver(true);
          }}
          onDragLeave={() => setOver(false)}
          onDrop={(e) => {
            e.preventDefault();
            // The window listens for file drops too (that's what opens this
            // in the first place), so without stopping here the same drop
            // is imported twice — verified: two files became four objects.
            e.stopPropagation();
            setOver(false);
            void takeFiles(Array.from(e.dataTransfer.files));
          }}
          onClick={() => fileInput.current?.click()}
          className={[
            "mt-3 rounded-xl border border-dashed px-3 py-6 text-center cursor-pointer transition-colors",
            over ? "border-accent bg-accent/5" : "border-line hover:bg-line/25",
          ].join(" ")}
        >
          <div className="font-mono text-[12px] text-ink">
            {busy ? "reading…" : "Drop files here"}
          </div>
          <div className="font-mono text-[10px] text-muted mt-0.5">or click to choose</div>
          <input
            ref={fileInput}
            type="file"
            multiple
            hidden
            onChange={(e) => {
              void takeFiles(Array.from(e.target.files ?? []));
              e.target.value = "";
            }}
          />
        </div>

        <div className="mt-3 flex gap-1.5">
          <input
            value={url}
            onChange={(e) => setUrl(e.target.value)}
            onKeyDown={(e) => {
              // Enter is spoken for globally — same trap the ledger's repair
              // fell into (2026-07-21).
              if (e.key === "Enter") {
                e.stopPropagation();
                void takeUrl();
              }
              if (e.key === "Escape") e.stopPropagation();
            }}
            placeholder="Paste a link or an are.na board…"
            className="flex-1 min-w-0 rounded-lg border border-line px-2.5 py-1.5 text-sm outline-none focus:border-accent"
          />
          <button
            onClick={takeUrl}
            disabled={busy || !url.trim()}
            className="shrink-0 px-2.5 py-1.5 rounded-lg border border-line hover:bg-line/40 disabled:opacity-40 font-mono text-[12px]"
          >
            Add
          </button>
        </div>
        {slug && (
          <p className="mt-1 font-mono text-[10px] text-muted">
            Reads the "{slug}" board — up to 500 blocks, images and notes both.
          </p>
        )}

        {error && <p className="mt-2 font-mono text-[11px] text-muted">{error}</p>}

        <div className="mt-3 flex justify-end">
          <button
            onClick={onClose}
            className="px-2.5 py-1.5 rounded-lg font-mono text-[12px] text-muted hover:text-ink"
          >
            Cancel
          </button>
        </div>
      </div>
    </div>
  );
}
