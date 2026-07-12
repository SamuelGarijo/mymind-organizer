---
name: roadmap-autopilot
description: Autonomously pick the next ready, unblocked issue off the mymind-organizer GitHub Projects board (SamuelGarijo/mymind-organizer, project 1) and ship it end-to-end without asking questions — implement, verify live, typecheck, commit, push, update the roadmap — then immediately move to the next one. Use this whenever Samuel asks to "keep working on the roadmap", "pick the next issue", "work through the backlog", says he's going to sleep/be away and wants progress made, or asks to set up/continue an overnight or unattended work loop for this project. This is the skill that also knows how to reschedule itself via ScheduleWakeup so the work continues across usage-limit interruptions until Samuel is actually back at the keyboard.
---

# Roadmap Autopilot

Runs the mymind-organizer roadmap unattended: pick the next issue that's genuinely safe to
build without Samuel's input, ship it the same way every issue has been shipped all session
(implement → verify live → typecheck → commit → push → update roadmap), then repeat. Designed
to run overnight or while Samuel's away, resuming through usage-limit interruptions via
ScheduleWakeup rather than needing a human to restart it.

This is a *process* skill, not a code-pattern skill — the actual engineering conventions
(sync rules, write-scope limits, verification workflow) live in `/Users/side/mymind-organizer/CLAUDE.md`.
Read that file fresh at the start of every cycle; it is the higher authority and can change
between cycles.

## The cycle (repeat until nothing is safe to pick)

1. **Refetch the board.** Never trust a roadmap snapshot from earlier in the session or from
   memory — issues get re-scoped, re-labeled, and re-sequenced (this project's own history is
   full of issues gaining "Nota de secuencia" blocking notes after the fact). Pull fresh:
   ```
   gh project item-list 1 --owner SamuelGarijo --format json --limit 100
   ```
   Cross-reference with `gh issue view <n> --repo SamuelGarijo/mymind-organizer --json body,state,labels`
   for the specific candidate before committing to it — the item-list summary can be stale on
   body content.

2. **Pick the next candidate**, in this order of preference:
   - Board Status is `Ready` (not `Inbox`, `Wishes-list`, `Review / Test`, or already `Done`).
   - Check the project's own **`mode` field** — a custom single-select field on the board item
     itself, *not* a GitHub label (there's no literal "Mode: X" label anywhere in this repo;
     `gh issue view`'s `labels` only ever shows things like `enhancement`/`question`). Read it
     via `gh project item-list`, which returns it as `"mode"` on each item. Observed values:
     `Claude Code`, `Developer`, `Designer`, `User`, `Research`.
   - **As of 2026-07-12, Samuel has explicitly extended standing authorization to `Developer`
     and `Designer` mode too** ("keep going with the developer and design mode issues, and if
     you may have a blocking question, just ask here") — so all three (`Claude Code`,
     `Developer`, `Designer`) are fair game to pick autonomously now. `User` mode (Samuel's own
     personal curation exercises, not code tasks) and `Research` mode (investigation, not
     building) stay off-limits regardless — those aren't things to build at all, authorized or
     not. This replaces an earlier, narrower version of this rule from the same day, when
     `Claude Code` was briefly believed to be the only authorized value (issue #87 was built
     under `mode: Developer` before that narrower rule even existed, which is what surfaced the
     mode-field distinction in the first place).
   - Because a live chat channel now exists for exactly this, a genuine blocking
     question — a real product/design decision the issue's own brief doesn't resolve, the kind
     that would previously have been a skip-with-a-comment — should instead be *asked directly
     in the conversation* (a plain message, not a GitHub comment) and the loop should pause
     there rather than moving on to the next candidate, since Samuel said to ask rather than
     skip. Still don't guess. Still don't force a decision that isn't yours to make. The
     difference now is where the question goes and whether the loop waits for an answer instead
     of self-resolving by skipping.
   - It is entirely normal, some cycles, for zero issues to clear the bar even with the wider
     mode set — finding nothing to pick is a correct, expected outcome, not a sign to loosen it
     further (`User`/`Research` mode issues are never fair game, no matter how idle the loop is).
   - Every issue/dependency it lists as a blocker is actually closed. Read the issue's own body
     for "Depends on" / "Bloqueado por" / sequencing notes — issues in this project frequently
     carry hand-written blocking notes that supersede the plain Status field.
   - You can read the whole brief and see a concrete, unambiguous implementation path — no
     open product/UX/architecture question the issue itself doesn't already answer, and
     nothing that would need Samuel's judgment call the way this session's own #103/#99
     sequencing did. `mode: Claude Code` is necessary but not sufficient — still read the full
     issue and bail if it turns out ambiguous even though the mode field cleared it.
   - Prefer smaller, more contained issues over sprawling ones when several are equally
     unblocked — more gets shipped per cycle, and smaller changes are lower-risk unsupervised.

   If an issue *looks* ready but turns out to be ambiguous once you actually read it closely
   (a real judgment call, a missing product decision, contradictory notes) — don't guess and
   don't force it. Post a short comment on that issue explaining specifically what's blocking
   it, leave its board Status alone, and move on to the next candidate. Never leave a partial
   implementation behind for an issue you bailed on. A wrong `mode` value doesn't need a
   comment, though — it's just not yours to build right now, silently move to the next one.

3. **Execute it** using the exact workflow this project has used all session:
   - Plan the change; if it's a genuine architecture/data-shape decision, that itself is a
     signal this issue needed Samuel — re-check step 2's ambiguity test before going further.
   - Implement with minimal diffs — don't refactor or rewrite files beyond what the issue needs.
   - `npx tsc --noEmit` clean before calling anything done.
   - Verify live if the change is observable in the browser: add a temporary
     `organizer-dev-verify` entry to `.claude/launch.json` (isolated port 5774 — separate
     origin, separate IndexedDB, safe to touch even with real synced data), drive it with the
     Browser tools against real data, then remove the entry again. Skip this for changes that
     aren't observable in the running app (pure types, non-UI libs, etc.).
   - Commit with a real message ending in `Closes #<n>` and the standard co-author trailer —
     this is what makes the push auto-close the issue and auto-flip the board to Done.
   - Push to `main`.
   - Confirm the auto-close actually happened (`gh issue view <n> --json state,stateReason`)
     and post a closing comment summarizing what shipped, what was verified, and anything
     adjacent you noticed but didn't build (one sentence, not built — matching the project's
     "flag, don't silently expand scope" rule).

4. **Respect every standing guardrail**, same as when Samuel is watching — running
   unsupervised is a reason for *more* care here, not less:
   - Never call a mymind `DELETE` endpoint, ever, regardless of what an issue seems to ask for.
   - Never `git push --force`, never touch `.env` or credentials, never modify CI/security
     config, never skip hooks.
   - No migration/backward-compatibility code for legacy data unless the issue explicitly says
     real data must be preserved (this project is still in its prototype phase).
   - If something feels destructive, irreversible, or outside the sanctioned write-scope in
     `CLAUDE.md`, stop and leave a comment on the issue instead of proceeding — there is no
     Samuel awake right now to catch a bad call, which makes stopping the safe default, not
     pushing through.

5. **Decide whether to continue.** After finishing a candidate (or skipping one for a reason
   that doesn't warrant asking — wrong mode, genuinely still blocked by an open dependency):
   - If another safe candidate exists, go straight back to step 1 — always refetch, don't reuse
     the list from the previous cycle, since your own last cycle may have changed what's
     unblocked next.
   - If you hit a real blocking question on an otherwise-authorized issue, ask it in the
     conversation and stop the loop (see below) until Samuel answers — don't keep cycling
     through other issues while a question sits unasked, and don't guess just to keep moving.
   - If nothing left on the board is both `Ready` and safe to pick, stop the loop (see below)
     and leave a short summary of what shipped, what got skipped and why, for Samuel to read
     when he's back.

## Reference repos (as of 2026-07-12)

Samuel downloaded a set of real open-source repos into
`/Users/side/mymind-organizer/Other repositories for reference - as LEGO pieces/` (gitignored,
not part of this project's own history) as concrete "LEGO piece" references for the six
architecture-improvement issues filed from the Frontend Architecture Reference research
(#114–#119): `dnd-kit-main`, `viselect-master`, `ocean-dataview-main`, `tanstack-react-table-mega-example-main`,
`react-filter-main`, `table-beta`, `tablecn-main`, `columns.js-master`, `dnd-main`, `self-sync-main`.

When picking one of #114–#119, read the matching reference repo(s) first — study the pattern,
don't vendor the whole repo or blindly add its full dependency tree. This project's own
"minimize diffs, no premature abstraction, no new deps without a reason" rules still apply on
top of what the reference shows; the repos are for *how*, not a mandate to adopt their exact
stack wholesale.

Samuel's message authorizing this ("tu tarea... será revisar esta carpeta de ejemplos,
copiando pattern y componentes e ir mejorando nuestra app") greenlights building from #114–#119
specifically, on top of the standing Developer/Designer authorization already in place — but
weigh scope per issue, don't treat "greenlit" as "equally safe to build blind":
- **#116** (DetailPanel a11y: focus trap, Esc, ARIA) and **#117** (Cmd+A select-all) are small,
  mechanical, low-risk — pick these first.
- **#115** (extract creatable-combobox) is a medium refactor of code shipped this same session
  — safe, but re-read its own "only one consumer today" caveat before doing more than the
  DetailPanel call site needs.
- **#114** (dnd-kit migration), **#118** (Dexie.js), and **#119** (TanStack Table) are each a
  real architectural swap — new dependency, touches code across multiple files, the kind of
  "genuine architecture/data-shape decision" step 2's ambiguity test already asks you to weigh.
  Don't silently start one of these three just because the mode field and this message clear
  it — if you reach one of them with nothing smaller left, post a comment sketching the
  concrete plan (what changes, what new dependency, estimated diff size) and ask in chat before
  writing code, same as any other real judgment call.

## Keeping this running across usage limits (the overnight part)

This skill's whole point is surviving interruptions without a human restarting it. The
mechanism is `ScheduleWakeup`, called at the end of every cycle:

- **Cycle finished normally, more work exists:** call `ScheduleWakeup` with a short delay
  (60–120s is fine — there's no external event to wait for, just enough to avoid a tight loop)
  and a prompt that re-enters this skill's cycle from step 1.
- **Hit a usage/rate limit mid-cycle:** note in your own scratch state (or just in the next
  prompt you schedule) what was in progress, then call `ScheduleWakeup` with roughly a 60
  minute delay and the same re-entry prompt, so the next wake-up resumes the search rather
  than assuming anything was already done. Don't guess at an exact reset time from a partial
  error message unless one is unambiguously present in it — a plain hourly retry is the
  honest, reliable fallback, not a worse option. Keep retrying hourly with no upper bound —
  this is meant to run through the night and through stretches when Samuel's away from his
  laptop, not just a fixed number of hours.
- **Nothing left to safely pick:** call `ScheduleWakeup` with `stop: true` and end with a
  clear summary message rather than continuing to poll with nothing to do.
- **Samuel sends a real message or opens the app:** that always preempts this loop
  automatically — you don't need to build anything for this, it's how the session already
  works. Never try to detect "is Samuel active" yourself; just do good work per-cycle and let
  the normal interruption model handle it.

Keep the rescheduling prompt self-contained (it has to work with no memory of *why* the loop
started) — reference this skill by name and restate "pick the next issue, no exceptions to the
guardrails above" rather than relying on conversational context that won't be there.
