async function throwOnError(res: Response, fallback: string): Promise<void> {
  if (res.ok) return;
  let detail = fallback;
  try {
    const problem = await res.json();
    detail = problem?.detail || problem?.title || detail;
  } catch {
    // non-JSON error body; status still carries the failure
  }
  throw new Error(detail);
}

/**
 * Adds a single manual tag to a mymind object. Never DELETE, never PATCH,
 * never a content write; see server/mymindClient.js for the confirmed
 * request shape.
 *
 * There is no corresponding "remove" call — once pushed, a tag can only be
 * removed by the user directly in mymind. Callers should only invoke this
 * for a value the user has deliberately finished editing (e.g. on blur),
 * not on every keystroke.
 */
export async function addMymindTag(objectId: string, name: string): Promise<void> {
  const res = await fetch(`/api/mymind/objects/${objectId}/tags`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ name }),
  });
  await throwOnError(res, `mymind rejected the tag (${res.status}).`);
}

/**
 * Creates a new note on a mymind object — the write path for our local
 * "description" field. Returns the new note's id (store it so a later edit
 * updates in place via updateMymindNote instead of creating a second note).
 * Like addMymindTag, only call this for a value the user finished editing
 * (on blur), not per keystroke.
 */
export async function createMymindNote(objectId: string, body: string): Promise<{ id: string }> {
  const res = await fetch(`/api/mymind/objects/${objectId}/notes`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ body }),
  });
  await throwOnError(res, `mymind rejected the note (${res.status}).`);
  return res.json();
}

/**
 * Replaces an existing note's body in place. If the note id we have
 * locally no longer exists on mymind's side (404 — e.g. the user deleted
 * it directly in mymind, outside this app), falls back to creating a new
 * one instead of failing outright, and returns its id so the caller can
 * update what it has stored. Returns null when the update succeeded
 * in place (no new id to store).
 */
export async function updateMymindNote(
  objectId: string,
  noteId: string,
  body: string
): Promise<{ id: string } | null> {
  const res = await fetch(`/api/mymind/objects/${objectId}/notes/${noteId}`, {
    method: "PUT",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ body }),
  });
  if (res.status === 404) return createMymindNote(objectId, body);
  await throwOnError(res, `mymind rejected the note update (${res.status}).`);
  return null;
}

/**
 * Replaces a Note object's own primary content — distinct from
 * createMymindNote/updateMymindNote above, which write to the separate
 * `notes[]` annotation array. This is the write path for NOTE_CONTENT_KEY,
 * only valid for entity_type "Note" objects (mymind returns 422 otherwise).
 * Same rule as every other write here: only call on blur, never per
 * keystroke.
 */
export async function updateMymindContent(objectId: string, body: string): Promise<void> {
  const res = await fetch(`/api/mymind/objects/${objectId}/content`, {
    method: "PUT",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ body }),
  });
  await throwOnError(res, `mymind rejected the content update (${res.status}).`);
}
