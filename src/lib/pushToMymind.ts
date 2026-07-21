import { getLocalAsset } from "./localAssets";
import { LOCAL_ASSET_KEY } from "./localAssets";
import type { DesignObject } from "../types";

/**
 * Sends freshly imported things to mymind so they get its autotagging and
 * analysis, instead of sitting in a local island the rest of the app treats
 * as second-class (Samuel, 2026-07-21: "que lo que añadimos desde arena o
 * desde nuestro pc se mande a mymind para un mínimo de autotagging y
 * análisis, pero sin duplicar el objeto").
 *
 * "Sin duplicar" has three halves, and the first one is NOT what the spec
 * promises. Measured against the real account, 2026-07-21:
 *
 *   UPSTREAM de-duplication is unreliable for URLs. The spec says an
 *   identical URL "returns the existing object ... 200 OK instead of 201
 *   Created". Posting a URL that several existing objects already carried
 *   returned 201 and a NEW object. The reason is visible in the data: over
 *   there a URL is PROVENANCE, not identity — half a dozen photos saved
 *   from one article all carry that article as their source, and none of
 *   them IS the article. So identity only holds for byte-identical uploads,
 *   and URL pushes must be guarded on our side or a re-imported board
 *   duplicates upstream, permanently, since we can never delete.
 *
 *   OURS, BEFORE the push: anything whose URL we already hold as a mymind
 *   object is not sent again. See `alreadyInMymind` below — this is the
 *   guard that makes re-importing the same board safe.
 *
 *   DOWNSTREAM, after it. mymind hands back the object's own id, and the local
 *   object must be RE-KEYED to it — see the store's `adoptMymindObject`.
 *   Recording the id in a field wouldn't be enough: the store is keyed by
 *   `id`, and `syncMymindObjects` upserts by mymind's id, so leaving the
 *   local object under `local_xxx` means the next sync pulls the same thing
 *   down again and you're looking at two cards for one thing — permanently,
 *   since we can never delete the mymind side.
 *
 * Capped at 20 per import, Samuel's call. Nothing created here can be
 * undone by this app, so the cap is the safety rail: a paste that turns out
 * to be the wrong board costs 20 objects he has to clear, not 500.
 */

export const PUSH_LIMIT = 20;

export type PushOutcome = {
  /** localId → mymind id, for the re-key. */
  adopted: { localId: string; mymindId: string; created: boolean }[];
  /** Left local: nothing we could hand mymind, or it refused. Named, never
   * silently dropped. */
  skipped: { title: string; why: string }[];
  /** How many were beyond the cap and never attempted. */
  overCap: number;
};

/** What mymind can ingest from a given object. A URL it can fetch, or bytes
 * we hold. Anything else stays local rather than being faked into a shape
 * mymind would store wrongly. */
function pushableUrl(object: DesignObject): string | null {
  if (object.sourceUrl) return object.sourceUrl;
  // An Are.na block with no source link still has a public CDN image, which
  // is a perfectly good thing for mymind to save and analyse.
  if (object.source === "arena" && /^https?:\/\//.test(object.imageUrl)) return object.imageUrl;
  return null;
}

/** URLs already represented by a mymind object in the local archive. The
 * pre-push guard: mymind won't refuse a duplicate URL, so we have to. */
function alreadyInMymind(archive: DesignObject[]): Set<string> {
  const urls = new Set<string>();
  for (const object of archive) {
    if (object.source !== "mymind") continue;
    const url = object.sourceUrl ?? object.fields.source_url;
    if (typeof url === "string" && url) urls.add(url);
  }
  return urls;
}

export async function pushImported(
  objects: DesignObject[],
  archive: DesignObject[] = []
): Promise<PushOutcome> {
  const adopted: PushOutcome["adopted"] = [];
  const skipped: PushOutcome["skipped"] = [];
  const known = alreadyInMymind(archive);

  const batch = objects.slice(0, PUSH_LIMIT);
  const overCap = Math.max(0, objects.length - batch.length);

  for (const object of batch) {
    try {
      const assetId = object.fields[LOCAL_ASSET_KEY];
      let response: Response;

      if (typeof assetId === "string") {
        const blob = await getLocalAsset(assetId);
        if (!blob) {
          skipped.push({ title: object.title, why: "its file couldn't be read" });
          continue;
        }
        const params = new URLSearchParams({
          filename: String(object.fields.file_name ?? object.title),
          type: blob.type || "application/octet-stream",
          title: object.title,
        });
        response = await fetch(`/api/mymind/objects/upload?${params}`, {
          method: "POST",
          headers: { "Content-Type": "application/octet-stream" },
          body: blob,
        });
      } else {
        const url = pushableUrl(object);
        if (url && known.has(url)) {
          skipped.push({ title: object.title, why: "already in mymind" });
          continue;
        }
        if (!url) {
          // A dropped note has no URL and no bytes. mymind's POST /objects
          // does take inline `content`, but sending a note there would make
          // mymind the owner of text Samuel wrote here — a different
          // decision with different consequences, not a detail to slip in.
          skipped.push({ title: object.title, why: "nothing mymind can fetch" });
          continue;
        }
        response = await fetch("/api/mymind/objects", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ url, title: object.title, tags: object.tags }),
        });
      }

      if (!response.ok) {
        const problem = await response.json().catch(() => ({}));
        skipped.push({
          title: object.title,
          why: problem.detail ?? `mymind said ${response.status}`,
        });
        continue;
      }

      const { id, created } = (await response.json()) as { id?: string; created?: boolean };
      if (!id) {
        skipped.push({ title: object.title, why: "mymind returned no id" });
        continue;
      }
      adopted.push({ localId: object.id, mymindId: id, created: Boolean(created) });
    } catch (err) {
      skipped.push({ title: object.title, why: (err as Error).message });
    }
  }

  return { adopted, skipped, overCap };
}

/** One sentence about what just happened, for the flash notice. "Kept
 * local" covers the pre-push guard, which is the common case on a second
 * import of the same board and worth seeing rather than wondering about. */
export function describePush(outcome: PushOutcome): string {
  const created = outcome.adopted.filter((a) => a.created).length;
  const existing = outcome.adopted.length - created;
  const parts: string[] = [];
  if (created > 0) parts.push(`${created} sent to mymind`);
  if (existing > 0) parts.push(`${existing} already there`);
  if (outcome.skipped.length > 0) parts.push(`${outcome.skipped.length} kept local`);
  if (outcome.overCap > 0) parts.push(`${outcome.overCap} over the ${PUSH_LIMIT} cap, kept local`);
  return parts.join(" · ");
}
