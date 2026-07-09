import { get, set } from "idb-keyval";
import type { DesignObject } from "../types";

/**
 * Embeddings live in their own IndexedDB key, written on their own debounce,
 * separate from the main organizer-store blob (see idbStorage.ts for why:
 * they're large — up to ~5400 objects x 1536 floats — and only change on an
 * explicit "Include embeddings" sync, not on every keystroke/edit, so tying
 * their persistence to the same write path as everything else meant either
 * re-writing them constantly for no reason, or — before this fix — having
 * them re-stringified on every unrelated store mutation.
 */
const EMBEDDINGS_KEY = "organizer-embeddings";
const WRITE_DELAY_MS = 500;

let pending: Record<string, number[]> | null = null;
let timer: ReturnType<typeof setTimeout> | null = null;

function flush() {
  if (timer) {
    clearTimeout(timer);
    timer = null;
  }
  if (pending === null) return;
  const value = pending;
  pending = null;
  void set(EMBEDDINGS_KEY, JSON.stringify(value));
}

if (typeof document !== "undefined") {
  document.addEventListener("visibilitychange", () => {
    if (document.visibilityState === "hidden") flush();
  });
}

/** Call after any sync that might have touched embeddings — cheap no-op
 * write if nothing actually has one. */
export function saveEmbeddings(objects: Record<string, DesignObject>): void {
  const map: Record<string, number[]> = {};
  for (const obj of Object.values(objects)) {
    if (obj.embedding) map[obj.id] = obj.embedding;
  }
  pending = map;
  if (timer) clearTimeout(timer);
  timer = setTimeout(flush, WRITE_DELAY_MS);
}

/** Read once at startup and merge into freshly-rehydrated objects — see
 * store.ts's onRehydrateStorage. */
export async function loadEmbeddings(): Promise<Record<string, number[]>> {
  const raw = await get<string>(EMBEDDINGS_KEY);
  if (typeof raw !== "string") return {};
  try {
    return JSON.parse(raw) as Record<string, number[]>;
  } catch {
    return {};
  }
}
