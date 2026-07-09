import type { Collection, DesignObject, TagGroups } from "../types";

/** Thrown by parseBackup — the message is meant to be shown to the user
 * as-is (see App.tsx's restore flow), so keep it specific and actionable. */
export class BackupValidationError extends Error {}

function isPlainObject(v: unknown): v is Record<string, unknown> {
  return typeof v === "object" && v !== null && !Array.isArray(v);
}

/** Deliberately checks only the fields the rest of the app actually
 * depends on (id/title/tags/fields/manualCollectionIds) — not a full
 * schema. A stricter check would reject backups from earlier versions of
 * this app that lack some optional field; the goal here is catching
 * truncation/corruption, not enforcing the current shape exactly. */
function isValidObject(v: unknown): v is DesignObject {
  if (!isPlainObject(v)) return false;
  return (
    typeof v.id === "string" &&
    typeof v.title === "string" &&
    Array.isArray(v.tags) &&
    v.tags.every((t) => typeof t === "string") &&
    isPlainObject(v.fields) &&
    Array.isArray(v.manualCollectionIds) &&
    v.manualCollectionIds.every((c) => typeof c === "string")
  );
}

function isValidCollection(v: unknown): v is Collection {
  if (!isPlainObject(v)) return false;
  return (
    typeof v.id === "string" &&
    (v.type === "smart" || v.type === "manual") &&
    typeof v.name === "string"
  );
}

export type ParsedBackup = {
  objects: DesignObject[];
  collections: Collection[];
  tagGroups: TagGroups;
};

/**
 * Parses and structurally validates a backup JSON string before anything
 * touches the store. Throws BackupValidationError with a specific message
 * on any problem — a truncated download, a disk-full write mid-backup, or
 * an unrelated JSON file could otherwise parse "successfully" into a shape
 * that silently replaces the store with (near-)nothing, only discovered
 * after the confirm() was already accepted and the previous state is gone.
 */
export function parseBackup(json: string): ParsedBackup {
  let parsed: unknown;
  try {
    parsed = JSON.parse(json);
  } catch (err) {
    throw new BackupValidationError(`Not valid JSON: ${(err as Error).message}`);
  }

  if (!isPlainObject(parsed)) {
    throw new BackupValidationError("Backup isn't a JSON object at the top level.");
  }

  if (!Array.isArray(parsed.objects)) {
    throw new BackupValidationError('Missing or invalid "objects" array.');
  }
  const badObjectIndex = parsed.objects.findIndex((o) => !isValidObject(o));
  if (badObjectIndex !== -1) {
    throw new BackupValidationError(
      `Object at index ${badObjectIndex} is missing required fields ` +
        "(id/title/tags/fields/manualCollectionIds) — the file may be truncated or corrupted."
    );
  }

  const collectionsRaw = parsed.collections ?? [];
  if (!Array.isArray(collectionsRaw)) {
    throw new BackupValidationError('"collections" is present but not an array.');
  }
  const badCollectionIndex = collectionsRaw.findIndex((c) => !isValidCollection(c));
  if (badCollectionIndex !== -1) {
    throw new BackupValidationError(
      `Collection at index ${badCollectionIndex} is missing required fields (id/type/name).`
    );
  }

  const tagGroupsRaw = parsed.tagGroups ?? {};
  if (!isPlainObject(tagGroupsRaw)) {
    throw new BackupValidationError('"tagGroups" is present but not a plain object.');
  }

  return {
    objects: parsed.objects as DesignObject[],
    collections: collectionsRaw as Collection[],
    tagGroups: tagGroupsRaw as TagGroups,
  };
}
