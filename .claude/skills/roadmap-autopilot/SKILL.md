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
   - Board Status is `Ready` (not `Inbox`, `Wishes-list`, or already `Done`).
   - A `Mode: Developer` label is a hard skip — that label means Samuel's product judgment is
     required, full stop, no exceptions, regardless of how simple the issue looks. A
     `Mode: Claude Code` label is a green light but not a requirement — the real test is the
     next bullet.
   - Every issue/dependency it lists as a blocker is actually closed. Read the issue's own body
     for "Depends on" / "Bloqueado por" / sequencing notes — issues in this project frequently
     carry hand-written blocking notes that supersede the plain Status field.
   - You can read the whole brief and see a concrete, unambiguous implementation path — no
     open product/UX/architecture question the issue itself doesn't already answer, and
     nothing that would need Samuel's judgment call the way this session's own #103/#99
     sequencing did. "Confident to build without asking" is the actual bar, not any label.
   - Prefer smaller, more contained issues over sprawling ones when several are equally
     unblocked — more gets shipped per cycle, and smaller changes are lower-risk unsupervised.

   If an issue *looks* ready but turns out to be ambiguous once you actually read it closely
   (a real judgment call, a missing product decision, contradictory notes) — don't guess and
   don't force it. Post a short comment on that issue explaining specifically what's blocking
   it, leave its board Status alone, and move on to the next candidate. Never leave a partial
   implementation behind for an issue you bailed on.

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

5. **Decide whether to continue.** After finishing (or skipping) a candidate:
   - If another safe candidate exists, go straight back to step 1 — always refetch, don't reuse
     the list from the previous cycle, since your own last cycle may have changed what's
     unblocked next.
   - If nothing left on the board is both `Ready` and unambiguous, stop the loop (see below)
     and leave a short summary of what shipped, what got skipped and why, for Samuel to read
     when he's back.

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
