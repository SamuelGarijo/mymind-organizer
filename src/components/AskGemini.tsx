import { useStore } from "../store";

/**
 * The one place the app spends money and sends anything anywhere, and it
 * should look like it (Samuel, 2026-07-21: "haz más obvios los puntos de
 * contacto en que puedo usar Gemini").
 *
 * Both touchpoints used to be faint grey text links that never said the
 * word "Gemini", so the feature existed and was invisible. Being quiet is
 * a virtue for resident chrome; it's a defect for the two moments where
 * something leaves the machine. Those need to be legible, named, and
 * honest about the cost.
 *
 * The compromise with the space discipline: still summoned, never resident
 * — this only renders where a model can actually contribute, and the
 * ledger's copy stays hover-revealed. What changed is that when it IS
 * there, it reads as a button with a ✦ and the word Gemini in its tooltip,
 * not as a footnote.
 *
 * Without a key it doesn't disappear — it points at Preferences. A feature
 * that hides itself until configured is a feature nobody discovers.
 */
export function AskGemini({
  label,
  detail,
  onAsk,
  busy = false,
  busyLabel = "reading…",
  size = "inline",
}: {
  /** What it will do, in his words, not the model's: "ask about 34". */
  label: string;
  /** One line for the tooltip: what leaves, and what it costs. */
  detail: string;
  onAsk: () => void;
  busy?: boolean;
  busyLabel?: string;
  /** "inline" sits in a sentence; "block" is its own affordance. */
  size?: "inline" | "block";
}) {
  const configured = useStore((s) => s.geminiConfigured);

  const base =
    size === "block"
      ? "inline-flex items-center gap-1 px-2 py-1 rounded-lg border font-mono text-[11px] transition-colors"
      : "inline-flex items-center gap-1 font-mono text-[11px] transition-colors";

  if (!configured) {
    return (
      <span
        className={[
          base,
          size === "block" ? "border-line/70 text-muted/70" : "text-muted/70",
        ].join(" ")}
        title="Add your own Gemini key in Preferences → Classifier. It stays on this machine and is separate from mymind entirely."
      >
        <span aria-hidden className="font-sans">✦</span>
        {label} · needs a Gemini key
      </span>
    );
  }

  return (
    <button
      onClick={onAsk}
      disabled={busy}
      className={[
        base,
        size === "block"
          ? "border-accent/40 text-accent hover:bg-accent/5"
          : "text-accent hover:underline decoration-dotted underline-offset-2",
        "disabled:opacity-50",
      ].join(" ")}
      title={`${detail} Gemini, on your own key. Nothing is written without your review, and one ⌘Z undoes it.`}
    >
      <span aria-hidden className="font-sans">✦</span>
      {busy ? busyLabel : label}
    </button>
  );
}
