# The Organizer

Local-first design-reference archive. Syncs read-mostly from mymind's real
API into a Zustand + IndexedDB store; local additions (tags, collections,
facet fields, description notes) layer *on top of* mymind's data and must
survive every resync.

Working relationship: product/prioritization happens on the GitHub Projects
board (`SamuelGarijo/mymind-organizer`, project 1). Issues labeled
`Mode: Claude Code` are pre-authorized to execute from their own written
brief. Issues labeled `Mode: Developer` need Samuel's product decision first
— don't implement those without asking.

**Always update the roadmap after any progress on a board item — every
time, no exceptions.** Concretely, for each issue touched this turn: post a
closing/status comment on the GitHub issue summarizing what was done (or
what's now resolved/blocked), and move its board Status field accordingly
(→ Done when finished; a clarifying comment without a status change when
only partially resolved). Do this as part of finishing the task, not as a
separate step the user has to ask for.

## Design philosophy — read before any UI change

Full doc: [`docs/design-philosophy.md`](docs/design-philosophy.md). The core
idea: The Organizer is a **sacred space for thinking**, and **space itself is
a first-class feature** — weighted equal to or above any button, tag, or bar.
The product's KPI is *assimilation* (turning saved things into understood
things), so anything that crowds the work out with chrome ("death by
features") is a regression, not a nicety. The discipline is **choreography of
appearance** — features are summoned on intent and recede when done, not
resident by default — never subtraction of hard-won capability. Figma
mockups/sketches are visual conversation, not pixel-perfect spec; implement
freely against the principles. **You're expected to flag and propose
decluttering proactively** (e.g. "this bar is starting to get in the way")
without being asked. Verify UI decisions against that doc's Norms (Layer 2).

## mymind API — hard rules

Full spec: [`docs/mymind-api.md`](docs/mymind-api.md) (verbatim from
mymind). Read it before touching sync/write code. The rules below are
project policy on top of that spec — **the spec documenting an endpoint is
not the same as this project being allowed to call it.**

Samuel's plan is **Mastermind** (burst 10,000 credits/300s, sustained
100,000/30 days — see docs/mymind-api.md's Rate Limits). Generous, but not
infinite: don't add a new "fetch everything" call to a routine path (every
sync, every render, etc.) without checking it's actually necessary — see
the mount-time auto-sync bug below for what that costs in practice.

- **Read-mostly.** `GET` anything, freely.
- **Sanctioned writes only** (all implemented in `server/routes.js` /
  `server/mymindClient.js`):
  - `POST /objects/:id/tags` — add a tag.
  - `POST /objects/:id/notes` / `PUT /objects/:id/notes/:noteId` — the
    `description` field (a secondary annotation, NOT a Note's own content).
  - `PUT /objects/:id/content` — a Note's real body (`NOTE_CONTENT_KEY`),
    editable in DetailPanel as of 2026-07-08; 422s server-side for any
    non-Note object, only ever shown in the UI for `entity_type: "Note"`.
- **Never call any `DELETE` endpoint against mymind**, full stop — even
  though the API documents idempotent soft-deletes for objects, notes,
  tags, spaces, pins, and links. This is deliberate, explicit project
  policy, reconfirmed multiple times by Samuel — do not infer permission
  from the spec alone. If a feature seems to need one, ask first.
  Local-only deletion (tombstoned, never touching mymind) is fine and
  already built (`deleteObjectLocally`, `localTagRemovals`,
  `deletedMymindIds`).
- **Never `PATCH`** beyond what's explicitly listed above.
- Treating a field-clear as an "edit" (e.g. blanking a description) is fine
  — that's a `PUT`/`POST` with empty content, not a delete.
- New write scope requires an explicit go-ahead from Samuel, even when the
  spec documents the endpoint.

## Credentials & data

- `.env` (`MYMIND_KID` / `MYMIND_SECRET` / `ARENA_TOKEN`) never leaves the
  local proxy — never commit, never paste into chat, never let it appear
  in a client-side bundle. `ARENA_TOKEN` (Are.na personal access token,
  `server/arenaClient.js` / `server/arenaRoutes.js`, POST
  `/api/setup/arena-token`, disconnect via `/api/setup/arena-disconnect`)
  is separate project scope from mymind entirely — never touches mymind's
  credentials or endpoints. Its write path: create a channel, add blocks
  (image blocks upload the asset's bytes to Are.na via the v3
  presign→PUT→create flow, since mymind's `/api/mymind/image/...` URLs
  aren't publicly fetchable — see `server/arenaClient.js`); plus GET reads
  (`/me` identity, the user's channels) that power the destination-account
  UI and single-object channel picker. The Organizer→Are.na block-type
  translation lives in ONE place, `src/lib/arenaMapping.ts`. Same rule
  applies: only Samuel pastes the token in, via the ARE.NA section of
  Preferences.
- `organizer-backup.json` (~190MB real personal export) never gets
  committed — already gitignored.
- Never handle/type/paste the user's actual credentials.

## Architecture patterns

- **mymind-owned fields** (`MYMIND_OWNED_FIELD_KEYS` in
  `src/lib/mymindSync.ts`): stripped from `existing.fields` before mymind's
  fresh data overlays on every sync — safe for read-only fields mymind
  always resends. A field NOT in this list survives resync untouched unless
  mymind's response explicitly provides a fresher value. `description` /
  `mymind_note_id` are deliberately excluded so an unpushed local edit isn't
  wiped by a resync that hasn't seen it yet.
- **Tombstoning**: local deletions/removals need an explicit tombstone
  (`deletedMymindIds` for objects, `localTagRemovals` per-object for tags)
  or a resync silently resurrects them. Any new "remove X locally" feature
  needs the same treatment.
- **mymind-side deletions mirror in too** (`reconcileMymindDeletions` in
  `store.ts`, driven by `fetchAllMymindIds` in `mymindSync.ts`): every sync
  (incremental or full) fetches the current id set and tombstones any local
  mymind object missing from it — same `deletedMymindIds` list as a manual
  delete, never a mymind DELETE call. Guarded by that fetch's own
  `truncated` flag: a partial id set skips reconciliation entirely rather
  than risk a false-positive mass-delete (issue #29's core concern).
- **Full resync must never regress local additions.** Tags, collections,
  description edits, facet values — all additive on top of mymind's base
  data, never reverted by a sync. This was a real bug once (tag loss on
  full resync); treat it as a standing invariant to protect.
- **The mount-time auto-sync must read `useStore.getState()`, not a
  React-rendered `state` snapshot, and its effect must never register a
  cleanup function.** Real bug, found 2026-07-08: the effect fired before
  IndexedDB rehydration finished, handing `syncIncremental` an empty local
  cache — with nothing to match, its boundary-scan degraded to a full-
  library scan on *every* launch (visible as "Synced 8133 new/changed
  objects" every single time, real API cost). Fixed by polling
  `useStore.persist.hasHydrated()` before firing. The first attempt at this
  fix used a cleanup function to cancel the poll — that's actively wrong:
  under React 18 StrictMode's dev-only mount→cleanup→remount, the first
  pass's cleanup cancels its own pending poll while the `autoSyncedOnMount`
  ref (which the first pass already flipped) blocks the second pass from
  starting its own, so the sync silently never fires at all.

## Dev workflow

- Real dev server: `organizer-dev` (port 5773). Real proxy:
  `organizer-api`/`npm run server:watch` (port 8787, hot-reloads on server
  code changes via `node --watch`). Both defined in `.claude/launch.json`.
  **Don't touch these** — they're Samuel's own running instances.
- Verification: add a temporary `organizer-dev-verify` entry to
  `.claude/launch.json` on an isolated port (5774) — separate origin means
  separate IndexedDB, so it won't touch real local data. The plain `npm run
  dev` script hardcodes `--port 5773 --strictPort`, so the verify entry
  needs its own explicit args, e.g.:
  ```json
  { "name": "organizer-dev-verify", "runtimeExecutable": "npx",
    "runtimeArgs": ["vite", "--port", "5774", "--strictPort"], "port": 5774 }
  ```
  Remove the entry again once verification is done.
- Restarting `organizer-api` (e.g. after editing `server/`) kills a process
  Samuel didn't start this turn — it's stateless and safe to restart, but
  say so explicitly before doing it.
- `npx tsc --noEmit` before calling anything done.

## Communication

Samuel prefers terse, close to telegraphic status updates — state what
changed, what's blocked, and ask one crisp question when genuinely blocked.
Skip recaps and narration.
