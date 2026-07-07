import { get, set } from "idb-keyval";

// The File System Access API types aren't fully in TS's default DOM lib
// (queryPermission/requestPermission in particular), so this file leans on
// `any` at the edges rather than fighting the type system for a browser API
// that's Chromium-only anyway (Safari/Firefox fall back to "unsupported").
type FileHandle = FileSystemFileHandle & {
  queryPermission(opts: { mode: "readwrite" }): Promise<PermissionState>;
  requestPermission(opts: { mode: "readwrite" }): Promise<PermissionState>;
};

const HANDLE_KEY = "organizer-backup-handle";

export function isAutoBackupSupported(): boolean {
  return typeof window !== "undefined" && "showSaveFilePicker" in window;
}

export async function getStoredBackupHandle(): Promise<FileHandle | null> {
  if (!isAutoBackupSupported()) return null;
  try {
    const handle = (await get(HANDLE_KEY)) as FileHandle | undefined;
    return handle ?? null;
  } catch {
    return null;
  }
}

/** Opens a native save dialog once — must be called from a direct user
 * gesture (click handler), not chained after an `await`. The chosen handle
 * is persisted so every future sync can write to it silently. */
export async function chooseBackupFile(): Promise<FileHandle | null> {
  if (!isAutoBackupSupported()) return null;
  try {
    const handle = (await (window as unknown as {
      showSaveFilePicker: (opts: unknown) => Promise<FileHandle>;
    }).showSaveFilePicker({
      suggestedName: "organizer-backup.json",
      types: [{ description: "JSON backup", accept: { "application/json": [".json"] } }],
    })) as FileHandle;
    await set(HANDLE_KEY, handle);
    return handle;
  } catch {
    // user cancelled the picker — not an error
    return null;
  }
}

/** Silently (re)writes the backup to a previously chosen file. Returns
 * false (never throws) if permission was revoked or anything else goes
 * wrong — auto-backup failing quietly should never interrupt a sync. */
export async function writeBackup(handle: FileHandle, json: string): Promise<boolean> {
  try {
    let permission = await handle.queryPermission({ mode: "readwrite" });
    if (permission !== "granted") {
      permission = await handle.requestPermission({ mode: "readwrite" });
    }
    if (permission !== "granted") return false;

    const writable = await handle.createWritable();
    await writable.write(json);
    await writable.close();
    return true;
  } catch {
    return false;
  }
}
