/**
 * Adds a single manual tag to a mymind object — the one write operation the
 * Organizer performs. Never DELETE, never PATCH, never a content write; see
 * server/mymindClient.js for the confirmed request shape.
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
  if (!res.ok) {
    let detail = `mymind rejected the tag (${res.status}).`;
    try {
      const problem = await res.json();
      detail = problem?.detail || problem?.title || detail;
    } catch {
      // non-JSON error body; status still carries the failure
    }
    throw new Error(detail);
  }
}
