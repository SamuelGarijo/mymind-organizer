import { get, set } from "idb-keyval";

// The File System Access API types aren't fully in TS's default DOM lib
// (queryPermission/requestPermission in particular), so this file leans on
// `any` at the edges rather than fighting the type system for a browser API
// that's Chromium-only anyway (Safari/Firefox fall back to "unsupported").
type DirHandle = FileSystemDirectoryHandle & {
  queryPermission(opts: { mode: "readwrite" }): Promise<PermissionState>;
  requestPermission(opts: { mode: "readwrite" }): Promise<PermissionState>;
  keys(): AsyncIterableIterator<string>;
  getFileHandle(name: string, opts?: { create?: boolean }): Promise<FileSystemFileHandle>;
  removeEntry(name: string): Promise<void>;
};

const HANDLE_KEY = "organizer-backup-dir-handle";
const BACKUP_PREFIX = "organizer-backup-";
const SUSPECT_SUFFIX = "-SUSPECT";
const KEEP_LAST = 7;
// A backup with this much fewer objects than the last good one is treated
// as suspect rather than rotated in silently — a corrupted/half-restored
// local store can otherwise overwrite the only good copy with garbage.
const SUSPECT_DROP_RATIO = 0.2;

export function isAutoBackupSupported(): boolean {
  return typeof window !== "undefined" && "showDirectoryPicker" in window;
}

export async function getStoredBackupHandle(): Promise<DirHandle | null> {
  if (!isAutoBackupSupported()) return null;
  try {
    const handle = (await get(HANDLE_KEY)) as DirHandle | undefined;
    return handle ?? null;
  } catch {
    return null;
  }
}

/** Opens a native directory picker once — must be called from a direct user
 * gesture (click handler), not chained after an `await`. The chosen handle
 * is persisted so every future sync can write a new dated file into it
 * silently, no dialog. */
export async function chooseBackupFile(): Promise<DirHandle | null> {
  if (!isAutoBackupSupported()) return null;
  try {
    const handle = (await (window as unknown as {
      showDirectoryPicker: (opts: unknown) => Promise<DirHandle>;
    }).showDirectoryPicker({ mode: "readwrite" })) as DirHandle;
    await set(HANDLE_KEY, handle);
    return handle;
  } catch {
    // user cancelled the picker — not an error
    return null;
  }
}

function timestampedName(date: Date, suspect: boolean): string {
  const pad = (n: number) => String(n).padStart(2, "0");
  const stamp =
    `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}` +
    `-${pad(date.getHours())}${pad(date.getMinutes())}`;
  return `${BACKUP_PREFIX}${stamp}${suspect ? SUSPECT_SUFFIX : ""}.json`;
}

function countObjects(json: string): number {
  try {
    const parsed = JSON.parse(json) as { objects?: unknown[] };
    return parsed.objects?.length ?? 0;
  } catch {
    return 0;
  }
}

/**
 * Writes a new dated backup file into the chosen directory and keeps only
 * the last `KEEP_LAST` — deleting the oldest ones from that same directory.
 *
 * Before rotating, compares the new export's object count against the most
 * recent existing (non-suspect) backup. If it dropped by more than
 * `SUSPECT_DROP_RATIO`, the file is still written (nothing is ever silently
 * lost) but suffixed `-SUSPECT` and excluded from both rotation-triggered
 * deletion and the "most recent good backup" comparison on the next write —
 * it's meant to sit there until a person looks at it, not age out on its
 * own. Returns `suspect: true` so the caller can surface a warning instead
 * of treating the write as routine.
 *
 * Never throws — auto-backup failing quietly should never interrupt a sync.
 */
export async function writeBackup(
  handle: DirHandle,
  json: string
): Promise<{ ok: boolean; suspect: boolean }> {
  try {
    let permission = await handle.queryPermission({ mode: "readwrite" });
    if (permission !== "granted") {
      permission = await handle.requestPermission({ mode: "readwrite" });
    }
    if (permission !== "granted") return { ok: false, suspect: false };

    const existing: string[] = [];
    for await (const name of handle.keys()) {
      if (name.startsWith(BACKUP_PREFIX) && name.endsWith(".json")) existing.push(name);
    }
    existing.sort(); // the timestamp in the name sorts chronologically

    const goodExisting = existing.filter((n) => !n.includes(SUSPECT_SUFFIX));
    const lastGoodName = goodExisting[goodExisting.length - 1];

    let suspect = false;
    if (lastGoodName) {
      const lastFile = await (await handle.getFileHandle(lastGoodName)).getFile();
      const lastCount = countObjects(await lastFile.text());
      const newCount = countObjects(json);
      if (lastCount > 0 && newCount < lastCount * (1 - SUSPECT_DROP_RATIO)) suspect = true;
    }

    const name = timestampedName(new Date(), suspect);
    const fileHandle = await handle.getFileHandle(name, { create: true });
    const writable = await fileHandle.createWritable();
    await writable.write(json);
    await writable.close();

    if (!suspect) {
      const good = [...goodExisting, name].sort();
      const toDelete = good.slice(0, Math.max(0, good.length - KEEP_LAST));
      for (const old of toDelete) {
        try {
          await handle.removeEntry(old);
        } catch {
          // best-effort — a failed delete shouldn't fail the backup itself
        }
      }
    }

    return { ok: true, suspect };
  } catch {
    return { ok: false, suspect: false };
  }
}
