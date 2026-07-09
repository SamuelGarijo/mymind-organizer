import { get, set, del } from "idb-keyval";
import type { PersistStorage, StorageValue } from "zustand/middleware";

/**
 * Zustand persist storage backed by IndexedDB instead of localStorage.
 *
 * localStorage caps out around 5-10MB per origin — trivially exceeded once
 * a real mymind library (thousands of objects) gets synced in. IndexedDB's
 * quota is a large fraction of free disk space.
 *
 * This implements zustand's `PersistStorage` directly instead of wrapping a
 * string-based `StateStorage` via `createJSONStorage` — that's deliberate.
 * `createJSONStorage` calls `JSON.stringify` synchronously on EVERY store
 * mutation (including a single keystroke in the search box) before handing
 * the string to `setItem`, so a debounce inside `setItem` only delayed the
 * disk write — not the stringify of the whole ~8000-object state, which was
 * the actual main-thread-blocking cost (measured: ~5s blocked typing a
 * 10-character search query). Here `setItem` receives the raw, un-stringified
 * value, so both the stringify AND the write happen inside the debounced
 * flush — a burst of keystrokes collapses into at most one stringify, not
 * one per keystroke.
 *
 * `embedding` vectors are additionally stripped from what gets written here
 * (see `stripEmbeddings`) — they're large (up to ~5400 objects x 1536
 * floats) and persisted separately, on their own debounce, in
 * lib/embeddingsStorage.ts, then merged back in after rehydration (see
 * store.ts's onRehydrateStorage). They only change on an explicit "Include
 * embeddings" sync, never per keystroke, so they don't belong in the same
 * write path as everything else.
 *
 * getItem falls back to reading the old localStorage key once, so data from
 * before the IndexedDB migration is still picked up.
 */
const WRITE_DELAY_MS = 500;

const pendingValue = new Map<string, StorageValue<unknown>>();
const timers = new Map<string, ReturnType<typeof setTimeout>>();

function stripEmbeddings(key: string, value: unknown): unknown {
  return key === "embedding" ? undefined : value;
}

function flush(name: string) {
  const timer = timers.get(name);
  if (timer) {
    clearTimeout(timer);
    timers.delete(name);
  }
  const value = pendingValue.get(name);
  if (value !== undefined) {
    pendingValue.delete(name);
    void set(name, JSON.stringify(value, stripEmbeddings));
  }
}

if (typeof document !== "undefined") {
  document.addEventListener("visibilitychange", () => {
    if (document.visibilityState === "hidden") {
      for (const name of Array.from(pendingValue.keys())) flush(name);
    }
  });
}

export function createIdbStorage<S>(): PersistStorage<S> {
  return {
    getItem: async (name) => {
      // A write may still be pending — serve it so rehydration never reads
      // stale (mirrors the debounced value, not necessarily what's on disk).
      const pending = pendingValue.get(name);
      if (pending !== undefined) return pending as StorageValue<S>;

      const fromIdb = await get<string>(name);
      if (typeof fromIdb === "string") {
        try {
          return JSON.parse(fromIdb) as StorageValue<S>;
        } catch {
          return null;
        }
      }

      const legacy = localStorage.getItem(name);
      if (legacy) {
        try {
          return JSON.parse(legacy) as StorageValue<S>;
        } catch {
          return null;
        }
      }
      return null;
    },
    setItem: (name, value) => {
      pendingValue.set(name, value);
      const existing = timers.get(name);
      if (existing) clearTimeout(existing);
      timers.set(name, setTimeout(() => flush(name), WRITE_DELAY_MS));
    },
    removeItem: async (name) => {
      pendingValue.delete(name);
      const timer = timers.get(name);
      if (timer) clearTimeout(timer);
      timers.delete(name);
      await del(name);
    },
  };
}
