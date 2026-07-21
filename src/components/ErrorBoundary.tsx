import { Component, type ErrorInfo, type ReactNode } from "react";
import { downloadBackupFile, exportBackupFromIdb } from "../lib/crashRecoveryExport";

type Props = { children: ReactNode };
type State = { error: Error | null; exporting: boolean; exportError: string | null };

/**
 * Root-level safety net. Without this, a render crash from a single bad
 * object (unexpected shape after a migration, an edge case in a card)
 * takes the whole React tree down to a blank white screen — the data in
 * IndexedDB is completely untouched, but nothing on screen tells the user
 * that, and a blank page reads as total data loss.
 *
 * Must be a class component — getDerivedStateFromError/componentDidCatch
 * have no hook equivalent.
 */
export class ErrorBoundary extends Component<Props, State> {
  state: State = { error: null, exporting: false, exportError: null };

  static getDerivedStateFromError(error: Error): Partial<State> {
    return { error };
  }

  componentDidCatch(error: Error, info: ErrorInfo) {
    console.error("[ErrorBoundary] Render crash:", error, info.componentStack);
  }

  handleExport = async () => {
    this.setState({ exporting: true, exportError: null });
    try {
      const json = await exportBackupFromIdb();
      downloadBackupFile(json);
    } catch (err) {
      this.setState({ exportError: (err as Error).message });
    } finally {
      this.setState({ exporting: false });
    }
  };

  render() {
    const { error } = this.state;
    if (!error) return this.props.children;

    return (
      <div className="fixed inset-0 flex items-center justify-center bg-canvas px-6">
        <div className="relative bg-panel rounded-card border border-line shadow-2xl w-full max-w-md p-5 space-y-4">
          <div>
            <div className="text-sm font-medium">Something went wrong</div>
            <p className="text-[12px] text-muted mt-1 leading-relaxed">
              The app hit an error while rendering and had to stop — but your data is intact. Everything
              synced or curated lives in this browser's local storage, untouched by whatever just broke
              on screen. Reloading usually clears it; if it keeps happening, export a backup below before
              doing anything else, and let Samuel know what you were doing right before it happened.
            </p>
          </div>

          <div className="flex flex-col gap-2">
            <button
              onClick={() => window.location.reload()}
              className="w-full text-sm px-3 py-1.5 rounded-lg bg-ink text-white hover:opacity-90"
            >
              Reload
            </button>
            <button
              onClick={this.handleExport}
              disabled={this.state.exporting}
              className="w-full text-sm px-3 py-1.5 rounded-lg border border-line hover:bg-line/40 disabled:opacity-50"
              title="Reads straight from IndexedDB, bypassing whatever crashed, so this works even if the rest of the app can't render at all"
            >
              {this.state.exporting ? "Exporting…" : "Export backup"}
            </button>
          </div>

          {this.state.exportError && (
            <p className="text-[12px] text-danger bg-danger/10 border border-danger/30 rounded-lg px-2.5 py-1.5">
              {this.state.exportError}
            </p>
          )}

          <details className="text-[11px] text-muted">
            <summary className="cursor-pointer select-none">Technical details</summary>
            <pre className="mt-1.5 whitespace-pre-wrap break-words">{error.message}</pre>
          </details>
        </div>
      </div>
    );
  }
}
