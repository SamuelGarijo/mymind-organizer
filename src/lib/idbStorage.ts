import { get, set, del } from "idb-keyval";
import type { StateStorage } from "zustand/middleware";

/**
 * Zustand persist storage backed by IndexedDB instead of localStorage.
 *
 * localStorage caps out around 5-10MB per origin — trivially exceeded once
 * a real mymind library (thousands of objects) gets synced in. IndexedDB's
 * quota is a large fraction of free disk space.
 *
 * Writes are debounced: persist serializes the ENTIRE store on every
 * mutation, and with ~8000 objects that's megabytes of JSON per keystroke.
 * A trailing debounce collapses bursts of mutations into one write; a
 * visibilitychange flush covers the tab being hidden/closed inside the
 * debounce window.
 *
 * getItem falls back to reading the old localStorage key once, so data from
 * before the IndexedDB migration is still picked up.
 */
const WRITE_DELAY_MS = 500;

const pendingValue = new Map<string, string>();
const timers = new Map<string, ReturnType<typeof setTimeout>>();

function flush(name: string) {
  const timer = timers.get(name);
  if (timer) {
    clearTimeout(timer);
    timers.delete(name);
  }
  const value = pendingValue.get(name);
  if (value !== undefined) {
    pendingValue.delete(name);
    void set(name, value);
  }
}

if (typeof document !== "undefined") {
  document.addEventListener("visibilitychange", () => {
    if (document.visibilityState === "hidden") {
      for (const name of Array.from(pendingValue.keys())) flush(name);
    }
  });
}

export const idbStorage: StateStorage = {
  getItem: async (name) => {
    // A write may still be pending — serve it so rehydration never reads stale.
    const pending = pendingValue.get(name);
    if (pending !== undefined) return pending;
    const fromIdb = await get(name);
    if (fromIdb !== undefined && fromIdb !== null) return fromIdb;
    return localStorage.getItem(name);
  },
  setItem: async (name, value) => {
    pendingValue.set(name, value);
    const existing = timers.get(name);
    if (existing) clearTimeout(existing);
    timers.set(
      name,
      setTimeout(() => flush(name), WRITE_DELAY_MS)
    );
  },
  removeItem: async (name) => {
    pendingValue.delete(name);
    const timer = timers.get(name);
    if (timer) clearTimeout(timer);
    timers.delete(name);
    await del(name);
  },
};
