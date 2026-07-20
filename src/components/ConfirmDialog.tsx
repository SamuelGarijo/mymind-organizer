import { useEffect } from "react";

/**
 * The app's own confirmation surface — window.confirm is banned (Samuel,
 * 2026-07-20: native popups break the space completely). Reserved for the
 * few genuinely heavy, hard-to-reverse actions (library-wide bulk assign,
 * backup restore); anything reversible should just happen and announce
 * itself via flashNotice instead of asking first.
 */
export function ConfirmDialog({
  title,
  body,
  action,
  onConfirm,
  onClose,
}: {
  title: string;
  /** Newline-separated detail lines — rendered pre-wrap, quiet mono. */
  body: string;
  /** The verb on the accept button ("Assign", "Restore"). */
  action: string;
  onConfirm: () => void;
  onClose: () => void;
}) {
  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape") onClose();
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center" role="alertdialog" aria-label={title}>
      <div className="absolute inset-0 bg-black/30" onClick={onClose} />
      <div className="relative bg-panel rounded-card border border-line shadow-2xl w-full max-w-sm p-5">
        <div className="text-sm font-medium mb-2">{title}</div>
        <p className="font-mono text-[12px] text-muted whitespace-pre-wrap leading-relaxed mb-4">
          {body}
        </p>
        <div className="flex justify-end gap-2">
          <button
            onClick={onClose}
            className="text-sm px-3 py-1.5 rounded-lg hover:bg-line/40 text-ink/70"
          >
            Cancel
          </button>
          <button
            autoFocus
            onClick={() => {
              onConfirm();
              onClose();
            }}
            className="text-sm px-3 py-1.5 rounded-lg bg-ink text-white"
          >
            {action}
          </button>
        </div>
      </div>
    </div>
  );
}
