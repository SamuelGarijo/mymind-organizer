import { planArenaBlock, planKindLabel } from "./arenaMapping";
import type { ArenaPlacement, DesignObject } from "../types";

/** Are.na visibility values (v3 API) — "closed" is Are.na's own default:
 * link-only, not publicly listed. */
export type ArenaVisibility = "public" | "closed" | "private";

export type ArenaChannel = { id: number; slug: string; title: string; visibility?: string };
export type ArenaAccount = { id: number; slug: string; name?: string; avatar?: string | null };

export type ArenaExportResult = {
  objectId: string;
  title: string;
  status: "published" | "skipped" | "failed";
  /** Block kind label (image/link/text/file) or "skipped". */
  kind: string;
  placement?: ArenaPlacement;
  reason?: string;
};

export type ArenaExportProgress = {
  done: number;
  total: number;
  published: number;
  skipped: number;
  failed: number;
};

async function requestJson<T>(path: string, init?: RequestInit): Promise<T> {
  const res = await fetch(path, init);
  if (!res.ok) {
    const problem = await res.json().catch(() => null);
    throw new Error(problem?.detail || `Request to ${path} failed (${res.status})`);
  }
  return res.json();
}

/** Whose Are.na is connected (for the "publishing to…" line). Returns null
 * when no token is configured or the token is invalid — the UI treats that
 * as "not connected". */
export async function fetchArenaAccount(): Promise<ArenaAccount | null> {
  try {
    return await requestJson<ArenaAccount>("/api/arena/me");
  } catch {
    return null;
  }
}

/** The connected account's own channels, for the single-object picker. */
export async function fetchMyChannels(): Promise<ArenaChannel[]> {
  const { channels } = await requestJson<{ channels: ArenaChannel[] }>("/api/arena/channels");
  return channels;
}

export function createArenaChannel(input: {
  title: string;
  description?: string;
  visibility: ArenaVisibility;
}): Promise<ArenaChannel> {
  return requestJson<ArenaChannel>("/api/arena/channels", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(input),
  });
}

/** Delay between sequential block-creation calls — Are.na's own guidance
 * for bulk writes ("200-500ms between sequential requests"), and the only
 * safe assumption regardless of account tier (guest tier is as low as
 * 30 req/min; the batch endpoint is Premium+private-channel only). */
const WRITE_DELAY_MS = 350;

/**
 * Publishes ONE object into an existing channel, via the centralized type
 * mapping. A "skip" plan makes no request and reports the reason; a real
 * block returns a placement (block id/url + channel + account + timestamp)
 * for persistence. Never throws — a failure is captured in the result.
 */
export async function publishObjectToChannel(
  object: DesignObject,
  channel: ArenaChannel,
  account: ArenaAccount,
  opts: { includeMetadata: boolean }
): Promise<ArenaExportResult> {
  const plan = planArenaBlock(object, opts);
  const kind = planKindLabel(plan);

  if (plan.kind === "skip") {
    return { objectId: object.id, title: object.title, status: "skipped", kind, reason: plan.reason };
  }

  try {
    const block = await requestJson<{ id: number }>(`/api/arena/channels/${channel.id}/blocks`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(plan),
    });
    const placement: ArenaPlacement = {
      blockId: block.id,
      blockUrl: `https://www.are.na/block/${block.id}`,
      channelId: channel.id,
      channelTitle: channel.title,
      channelUrl: `https://www.are.na/channel/${channel.slug}`,
      account: account.slug,
      publishedAt: new Date().toISOString(),
    };
    return { objectId: object.id, title: object.title, status: "published", kind, placement };
  } catch (err) {
    return {
      objectId: object.id,
      title: object.title,
      status: "failed",
      kind,
      reason: (err as Error).message,
    };
  }
}

/**
 * Publishes many objects into an existing channel, sequentially (rate-limit
 * safe). `onResult` fires after each object so the caller can persist its
 * placement incrementally — the export is never fire-and-forget, and a
 * mid-run close still records everything published so far.
 */
export async function exportObjectsToChannel(
  objects: DesignObject[],
  channel: ArenaChannel,
  account: ArenaAccount,
  opts: { includeMetadata: boolean },
  onResult: (result: ArenaExportResult, progress: ArenaExportProgress) => void
): Promise<ArenaExportResult[]> {
  const results: ArenaExportResult[] = [];
  const progress: ArenaExportProgress = {
    done: 0,
    total: objects.length,
    published: 0,
    skipped: 0,
    failed: 0,
  };
  for (let i = 0; i < objects.length; i++) {
    const result = await publishObjectToChannel(objects[i], channel, account, opts);
    results.push(result);
    progress.done += 1;
    progress[result.status] += 1;
    onResult(result, { ...progress });
    // Only a real network write needs pacing — a skipped object made no call.
    if (result.status !== "skipped" && i < objects.length - 1) {
      await new Promise((r) => setTimeout(r, WRITE_DELAY_MS));
    }
  }
  return results;
}

/**
 * Creates a new channel, then publishes every object into it. Thin wrapper
 * over exportObjectsToChannel — the collection exporter.
 */
export async function exportCollectionToArena(
  objects: DesignObject[],
  channelInput: { title: string; description?: string; visibility: ArenaVisibility },
  account: ArenaAccount,
  opts: { includeMetadata: boolean },
  onResult: (result: ArenaExportResult, progress: ArenaExportProgress) => void
): Promise<{ channel: ArenaChannel; results: ArenaExportResult[] }> {
  const channel = await createArenaChannel(channelInput);
  const results = await exportObjectsToChannel(objects, channel, account, opts, onResult);
  return { channel, results };
}
