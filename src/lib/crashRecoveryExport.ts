import { get } from "idb-keyval";

// Deliberately imports nothing from store.ts or zustand — this exists
// specifically for the case where a bug in rendering that data (not the
// data itself) has taken the React tree down. Re-reads the same
// "organizer-store" key idbStorage.ts writes to, straight via idb-keyval,
// and rebuilds the same {objects, collections, tagGroups} shape
// exportDataString() produces so the result can be restored normally.
const STORE_KEY = "organizer-store";

type RawPersistedEnvelope = {
  state?: {
    objects?: Record<string, unknown>;
    collections?: Record<string, unknown>;
    collectionOrder?: string[];
    tagGroups?: unknown;
  };
};

export async function exportBackupFromIdb(): Promise<string> {
  const raw = await get<string>(STORE_KEY);
  if (typeof raw !== "string") {
    throw new Error(`No saved data found in IndexedDB under "${STORE_KEY}".`);
  }

  let parsed: RawPersistedEnvelope;
  try {
    parsed = JSON.parse(raw);
  } catch (err) {
    throw new Error(`Saved data exists but isn't valid JSON: ${(err as Error).message}`);
  }

  const state = parsed.state ?? {};
  const objects = Object.values(state.objects ?? {});
  const collectionsById = state.collections ?? {};
  const collections = (state.collectionOrder ?? [])
    .map((id) => collectionsById[id])
    .filter((c): c is Record<string, unknown> => c !== undefined);

  return JSON.stringify({ objects, collections, tagGroups: state.tagGroups ?? {} }, null, 2);
}

export function downloadBackupFile(json: string): void {
  const blob = new Blob([json], { type: "application/json" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = `organizer-crash-recovery-${new Date().toISOString().slice(0, 10)}.json`;
  a.click();
  URL.revokeObjectURL(url);
}
