import { get, set, del, keys } from "idb-keyval";

/**
 * Bytes for things that came from Samuel's own machine rather than from
 * mymind (issue: "+ ADD Something", 2026-07-21).
 *
 * Their own IndexedDB keys, not the store blob — same reasoning as
 * embeddingsStorage.ts, only more so. A dropped image is megabytes; putting
 * it inside the persisted state would mean re-stringifying it on every
 * unrelated keystroke, which is the exact cost idbStorage.ts was rewritten
 * to avoid. One key per asset, written once at import, read once at boot.
 *
 * `imageUrl` for these objects is an object URL, which is per-session by
 * nature: the URL persisted with the store is dead on the next launch. So
 * the object carries `fields.local_asset` — a stable key into this store —
 * and the URL is re-minted at rehydration from the bytes. Persisting a blob
 * URL and hoping is how you get an archive of broken images six months in.
 */

const PREFIX = "organizer-asset:";

export const LOCAL_ASSET_KEY = "local_asset";

export async function putLocalAsset(assetId: string, blob: Blob): Promise<void> {
  await set(PREFIX + assetId, blob);
}

export async function getLocalAsset(assetId: string): Promise<Blob | undefined> {
  return (await get(PREFIX + assetId)) as Blob | undefined;
}

export async function deleteLocalAsset(assetId: string): Promise<void> {
  await del(PREFIX + assetId);
}

/** Object URLs minted this session, so a re-render doesn't leak a new one
 * per call and so they can all be revoked together if we ever need to. */
const urls = new Map<string, string>();

export function localAssetUrl(assetId: string, blob: Blob): string {
  const existing = urls.get(assetId);
  if (existing) return existing;
  const url = URL.createObjectURL(blob);
  urls.set(assetId, url);
  return url;
}

/** Re-mints an object URL for every stored asset. Called once after
 * rehydration — see store.ts's onRehydrateStorage. Returns assetId → url so
 * the caller can patch the objects that reference them. */
export async function loadLocalAssetUrls(): Promise<Record<string, string>> {
  const out: Record<string, string> = {};
  let allKeys: IDBValidKey[] = [];
  try {
    allKeys = await keys();
  } catch {
    return out;
  }
  for (const key of allKeys) {
    if (typeof key !== "string" || !key.startsWith(PREFIX)) continue;
    const assetId = key.slice(PREFIX.length);
    try {
      const blob = (await get(key)) as Blob | undefined;
      // A missing or empty blob is survivable: that object falls back to
      // its text card, exactly like a mymind object whose image 404s.
      if (blob && blob.size > 0) out[assetId] = localAssetUrl(assetId, blob);
    } catch {
      /* one unreadable asset must not stop the rest from loading */
    }
  }
  return out;
}
