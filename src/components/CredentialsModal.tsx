import { useEffect, useState } from "react";

type HealthInfo = { credentialsConfigured: boolean; kid: string | null };

/**
 * mymind API connection setup — shown full-screen and non-dismissible on
 * first run (no credentials in .env yet), or reachable any time afterward
 * from the ⚙ menu to swap in a different key. Either way this only ever
 * writes to the local proxy's .env (POST /api/setup/credentials) — it never
 * talks to mymind directly and never echoes a saved secret back.
 */
export function CredentialsModal({
  dismissible,
  onClose,
  onSaved,
}: {
  dismissible: boolean;
  onClose: () => void;
  onSaved: () => void;
}) {
  const [health, setHealth] = useState<HealthInfo | null>(null);
  const [kid, setKid] = useState("");
  const [secret, setSecret] = useState("");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    fetch("/api/health")
      .then((r) => r.json())
      .then((data: HealthInfo) => setHealth(data))
      .catch(() => setHealth({ credentialsConfigured: false, kid: null }));
  }, []);

  async function save() {
    const trimmedKid = kid.trim();
    const trimmedSecret = secret.trim();
    if (!trimmedKid || !trimmedSecret) return;
    setSaving(true);
    setError(null);
    try {
      const res = await fetch("/api/setup/credentials", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ kid: trimmedKid, secret: trimmedSecret }),
      });
      if (!res.ok) {
        const body = await res.json().catch(() => null);
        throw new Error(body?.detail || `Server responded ${res.status}`);
      }
      setSecret("");
      onSaved();
      onClose();
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center">
      <div
        className="absolute inset-0 bg-black/30"
        onClick={dismissible ? onClose : undefined}
      />
      <div className="relative bg-panel rounded-card border border-line shadow-2xl w-full max-w-sm p-5">
        <div className="text-sm font-medium mb-1">Connect to mymind</div>
        <p className="text-[12px] text-muted mb-3">
          Create an access key on mymind's own Extensions page (in the mymind app), then paste
          its key id and secret here. They're written to this machine's local <code>.env</code>{" "}
          file and read only by the local proxy — mymind's servers are the only other place they
          ever go.
        </p>

        {health?.credentialsConfigured && (
          <p className="text-[12px] text-emerald-700 bg-emerald-50 border border-emerald-200 rounded-lg px-2.5 py-1.5 mb-3">
            Currently connected with key <code>{health.kid}</code>. Paste a different key below to
            replace it — e.g. a Read only key from mymind's Extensions page, if you'd rather this
            app not be able to write anything.
          </p>
        )}

        <div className="space-y-2">
          <input
            autoFocus
            value={kid}
            onChange={(e) => setKid(e.target.value)}
            placeholder="Access key id"
            className="w-full rounded-lg border border-line px-2.5 py-1.5 text-sm outline-none focus:border-accent"
          />
          <input
            value={secret}
            onChange={(e) => setSecret(e.target.value)}
            onKeyDown={(e) => e.key === "Enter" && save()}
            placeholder="Access key secret"
            type="password"
            className="w-full rounded-lg border border-line px-2.5 py-1.5 text-sm outline-none focus:border-accent"
          />
        </div>

        {error && <p className="text-[12px] text-red-700 mt-2">{error}</p>}

        <div className="mt-4 flex justify-end gap-2">
          {dismissible && (
            <button
              onClick={onClose}
              className="text-sm px-3 py-1.5 rounded-lg hover:bg-line/40 text-ink/70"
            >
              Cancel
            </button>
          )}
          <button
            onClick={save}
            disabled={!kid.trim() || !secret.trim() || saving}
            className="text-sm px-3 py-1.5 rounded-lg bg-ink text-white disabled:opacity-40"
          >
            {saving ? "Connecting…" : "Connect"}
          </button>
        </div>
      </div>
    </div>
  );
}
