import { makeId } from "./id";
import { LOCAL_ASSET_KEY, localAssetUrl, putLocalAsset } from "./localAssets";
import type { DesignObject } from "../types";

/**
 * "+ ADD Something" — the door for things that didn't come from mymind
 * (Samuel, 2026-07-21: "que hayan archivos drag&drop desde un escritorio o
 * desde un board de Are.na").
 *
 * Everything here produces plain local objects. They are never pushed to
 * mymind — not as a limitation but as the standing project policy: this app
 * reads mymind and writes only the three sanctioned things. A dropped file
 * has no mymind id, carries `source: "local"`, and is therefore invisible to
 * `reconcileMymindDeletions` (which only tombstones `source === "mymind"`),
 * so a resync can never delete Samuel's own imports. That guard already
 * existed; this just stays on the right side of it.
 *
 * Three doors, one destination:
 *   files  — bytes from the desktop, stored in IndexedDB (lib/localAssets)
 *   url    — a link, kept as a link
 *   arena  — a channel's blocks, via the proxy that holds the token
 */

/** Formats worth showing as a picture. Anything else still imports — it just
 * reads as a text card, the same fallback mymind objects use. */
const IMAGE_TYPES = /^image\/(png|jpeg|jpg|gif|webp|avif|svg\+xml)$/i;

export type ImportResult = {
  objects: DesignObject[];
  /** Things that couldn't be read, named — a silent partial import is worse
   * than a short honest list. */
  skipped: string[];
};

function baseObject(title: string): DesignObject {
  const now = new Date().toISOString();
  return {
    id: makeId("local"),
    title,
    imageUrl: "",
    tags: [],
    fields: {},
    manualCollectionIds: [],
    createdAt: now,
    updatedAt: now,
    source: "local",
  };
}

/** Filename without extension, which is the only title a dropped file has —
 * and usually a better one than nothing. */
function titleFromFile(name: string): string {
  return name.replace(/\.[^.]+$/, "").trim() || name;
}

export async function importFiles(files: File[]): Promise<ImportResult> {
  const objects: DesignObject[] = [];
  const skipped: string[] = [];

  for (const file of files) {
    try {
      const object = baseObject(titleFromFile(file.name));
      object.fields.file_name = file.name;
      object.fields.file_type = file.type || "unknown";
      object.fields.file_size = String(file.size);

      if (IMAGE_TYPES.test(file.type)) {
        const assetId = object.id;
        await putLocalAsset(assetId, file);
        object.fields[LOCAL_ASSET_KEY] = assetId;
        object.imageUrl = localAssetUrl(assetId, file);
      } else if (file.type === "text/plain" || /\.(md|txt)$/i.test(file.name)) {
        // A dropped note is content, not an attachment — keep the text where
        // search and the detail panel can already read it.
        object.fields.summary = (await file.text()).slice(0, 20_000);
      } else {
        // Still imported: a PDF or a sketch file is a real reference even
        // when nothing here can render it. It gets a text card and its name.
        await putLocalAsset(object.id, file);
        object.fields[LOCAL_ASSET_KEY] = object.id;
      }

      objects.push(object);
    } catch (err) {
      skipped.push(`${file.name} — ${(err as Error).message}`);
    }
  }

  return { objects, skipped };
}

/** Are.na channel URLs, in the shapes people actually paste — which
 * includes with no protocol at all, because that's what you get copying a
 * URL out of a browser's address bar. Requiring https:// silently routed a
 * pasted board into the plain-link branch and imported one useless object
 * instead of the whole channel (caught live, 2026-07-21). */
const ARENA_CHANNEL = /^(?:https?:\/\/)?(?:www\.)?are\.na\/[^/]+\/([^/?#]+)/i;

export function arenaChannelSlug(input: string): string | null {
  const match = input.trim().match(ARENA_CHANNEL);
  return match ? match[1] : null;
}

/** A block's text is only worth keeping if it's TEXT. Blocks exported from
 * Organizer in an earlier experiment carry a bare `/api/mymind/image/...`
 * path as their body, and importing that back verbatim filled the grid with
 * cards whose entire content was a broken internal URL (caught live,
 * 2026-07-21). A lone URL is a pointer, not prose — the title and the
 * source link already say everything it does. */
function asProse(value: string | undefined): string {
  const text = (value ?? "").trim();
  if (!text) return "";
  if (!/\s/.test(text) && /^(https?:\/\/|\/)/.test(text)) return "";
  return text;
}

export async function importArenaChannel(slug: string): Promise<ImportResult> {
  const res = await fetch(`/api/arena/channel/${encodeURIComponent(slug)}`);
  if (!res.ok) {
    const body = await res.json().catch(() => ({}));
    throw new Error(body.error ?? `Are.na wouldn't give us that channel (${res.status}).`);
  }
  const { title, blocks } = (await res.json()) as {
    title?: string;
    blocks?: {
      id: number;
      title?: string;
      imageUrl?: string;
      sourceUrl?: string;
      content?: string;
      className?: string;
    }[];
  };

  const objects: DesignObject[] = [];
  const skipped: string[] = [];
  for (const block of blocks ?? []) {
    if (!block.title && !block.imageUrl && !block.content) {
      skipped.push(`block ${block.id} — nothing in it we can show`);
      continue;
    }
    const prose = asProse(block.content);
    const object = baseObject(block.title?.trim() || prose.slice(0, 80) || "Untitled");
    object.source = "arena";
    object.imageUrl = block.imageUrl ?? "";
    if (block.sourceUrl) object.sourceUrl = block.sourceUrl;
    if (prose) object.fields.summary = prose.slice(0, 20_000);
    object.fields.arena_block_id = String(block.id);
    if (title) object.fields.arena_channel = title;
    // The channel's name is the one piece of curation Are.na hands us for
    // free, and it's exactly the kind Samuel would have typed anyway.
    if (title) object.tags = [title];
    objects.push(object);
  }
  return { objects, skipped };
}

export async function importUrl(input: string): Promise<ImportResult> {
  const url = input.trim();
  if (!url) return { objects: [], skipped: [] };

  const slug = arenaChannelSlug(url);
  if (slug) return importArenaChannel(slug);

  let parsed: URL;
  try {
    parsed = new URL(url.startsWith("http") ? url : `https://${url}`);
  } catch {
    return { objects: [], skipped: [`${url} — not a link we can read`] };
  }

  // A link arrives as what it IS, not as a hostname. The proxy reads the
  // page's own og: metadata — title, description, preview image — because
  // the browser can't read cross-origin HTML and because that fetch needs
  // an SSRF guard that only the server can enforce (server/unfurlRoutes).
  //
  // Unfurling is best-effort by design: a paywalled, offline or
  // metadata-less page still becomes a saved link with its URL intact. The
  // fallback title is the hostname and path, which is what this used to do
  // for everything.
  const object = baseObject(parsed.hostname.replace(/^www\./, "") + parsed.pathname);
  object.source = "external";
  object.sourceUrl = parsed.toString();
  object.fields.source_url = parsed.toString();

  try {
    const res = await fetch("/api/unfurl", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ url: parsed.toString() }),
    });
    if (res.ok) {
      const meta = (await res.json()) as {
        url?: string;
        title?: string;
        description?: string;
        imageUrl?: string;
        siteName?: string;
      };
      if (meta.title?.trim()) object.title = meta.title.trim();
      if (meta.imageUrl) object.imageUrl = meta.imageUrl;
      if (meta.description?.trim()) object.fields.summary = meta.description.trim();
      if (meta.siteName?.trim()) object.fields.site_name = meta.siteName.trim();
      // The URL after redirects is the canonical one — a shortened link
      // should be saved as where it actually goes.
      if (meta.url) {
        object.sourceUrl = meta.url;
        object.fields.source_url = meta.url;
      }
    }
  } catch {
    /* offline, or the proxy is down — the link is still worth keeping */
  }

  return { objects: [object], skipped: [] };
}
