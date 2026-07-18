# The Organizer — Design Philosophy

This document is the *why* behind every design decision in The Organizer. It
is **not** a pixel-perfect spec to implement to the letter. Figma mockups,
Samuel's sketches, and written prompts are a **visual conversation** about how
the workspace should feel and behave — treat them as direction, not law.
Implementation is free and propositional: Claude decides the concrete form,
grounded in the principles below.

**Claude is expected to act on this doc proactively.** You do not need to be
told "this bar is starting to get in the way." If a screen drifts against
these principles, flag it and propose a fix — declutter, collapse, defer,
give space back — as a first-class suggestion, the same way you'd flag a bug.
Not every query is about structural redesign, but every design decision,
however small, should be checkable against this document.

The doc has three layers, most-stable first:

1. **Principles** — the philosophy. Rarely changes.
2. **Norms** — verifiable rules that follow from the principles. Testable
   against any screen.
3. **Decisions** — per-screen applications. Evolve as we build.

---

## Layer 1 — Principles (Philosophy)

The Organizer is a *sacred space for thinking*, not a dashboard. Its purpose
is **assimilation** — turning saved things into understood things, and
understood things into part of the user. Everything below serves that.

### 1. Space is a first-class feature

Empty space is designed, protected, and weighted equal to or above any
button, tag, menu, or text. In most apps, content is whatever fills the space
left over after the chrome is placed. **The Organizer inverts this:** space is
the default; chrome is the exception that briefly intrudes and then leaves.
Never reach for "fill the empty area with a control" as a solution.

### 2. The sacred area — no death by features

There is a primary region where the *things* live and where the cognitive
work happens. Chrome (filters, bars, buttons, panels) is a **guest** in that
region, never a resident. "Death by features" — piling on affordances until
they crowd out the work — is uniquely toxic here, because the work *is* the
product. A control that would be harmless on a productivity dashboard can be
fatal in a tool for thinking.

### 3. Conditional, not resident

Controls are **summoned by intent** and **recede when done**. The resting
state of every view is maximum space, minimum chrome. Panels expand and
contract; they do not stack-and-persist. Fluidity over permanence.

### 4. Hide what isn't needed right now

If it is not being used in this moment, it should not be occupying space.
The **one-glance rule**: at rest, a view should read as its content, not as
its controls.

### 5. The process is the product

The KPI is not "items stored" or "collections created." It is **assimilation**
— the ladder in Samuel's sketch: *classification → interpretation →
familiarization → understanding → making a thing part of me*. Therefore
anything that interrupts flow is a **regression of the whole product**,
regardless of how useful the interrupting element is in isolation. Utility
does not equal value if it costs flow.

### 6. Classification is emergent, not scaffolding

Routing, folders, and grouping are **consequences of engagement**
("*if this is about X, then…*"), summoned and contextual — not a permanent
rigid grid the user must service. A group is a soft heading over things, not
a fixed column that reserves width whether or not it's needed.

### 7. Things breathe

The objects/cards are the inhabitants of the sacred space. Give them room.
**Density is the enemy of assimilation** — and where density is unavoidable
or desirable, it is a *dial the user turns*, not a fixed value we impose.

### Meta-principle: choreography, not subtraction

**This is not about removing features we worked hard to build.** Filters,
tags, facets, board, color search, similarity — all may exist. The discipline
is over the **choreography of appearance**: default hidden or peripheral,
summoned on intent, receding on completion. When these principles seem to
demand deleting a capability, the right move is almost always to change *when
and how it appears*, not to remove it.

---

## Layer 2 — Norms (Verifiable rules)

Concrete, checkable rules. Use these to self-audit a screen and to justify
proactive suggestions. Each is testable — you can look at a screen and say
yes/no.

**Resting-state chrome budget**
- N1. At rest (no active search/selection/hover), a view shows **at most one
  persistent horizontal band of chrome** above the content region. Everything
  else is summoned.
- N2. The primary content region occupies the **majority of the viewport** at
  rest. If chrome pushes content below the fold before any content is read,
  that's a violation.
- N3. Empty space is **never auto-filled** with controls to "use the room."

**Summon & recede**
- N4. Any control not part of the current intent must be **collapsible or
  summonable** (behind an icon, a hover, a keypress, a panel) — not
  permanently mounted.
- N5. Chrome that appears on intent must **recede** on the natural exit
  (blur, Escape, completion, click-away). Summoned things do not become
  resident by accident.
- N6. Panels **expand and contract** to fit intent (e.g. sidebar collapse,
  detail panel, classification panel). Reclaimed space flows to content.

**Grouping & classification**
- N7. Grouping renders as **soft labels over content**, not rigid columns
  that reserve permanent horizontal width regardless of use.
- N8. The reservoir of not-yet-assimilated things (currently "Unclassified")
  is treated as **generous space**, not a narrow residual backlog column with
  a count. It is the sacred space of §Principle 2, not leftover.

**Density**
- N9. Card/content density is **user-controllable** (a dial/slider), not a
  fixed constant baked into the layout.

**New-feature gate**
- N10. Any new UI element must declare its **resting visibility**: `hidden` /
  `summoned` / `peripheral` / `persistent`. Anything above `summoned`
  requires a justification against these principles. Default to `summoned`.
- N11. Adding a feature must not increase the resting-state chrome band count
  (N1). If it would, it needs a home behind a summon (menu, icon, panel).

**Motion & continuity**
- N12. Expansion/contraction is **animated and continuous**, never a hard
  cut — the space itself is a feature, so its changes should read as the
  space breathing, not as elements popping.

---

## Layer 3 — Decisions (Per-screen applications)

Concrete direction per surface. Grounded in Samuel's cleaned Figma
(`node 25:2`, the "Grid view" exploration) and the current implementation.
These evolve as we build — update this section when a screen's direction
changes.

### Top bar
- **Target:** one large, calm **search field, centered**, as the single
  primary action. A quiet secondary row (`Group by` / `Sort by` / `View as`)
  that reads as a whisper, not a toolbar. Everything else (sync, backup,
  full-resync) lives behind the **⚙ preferences icon** (already done, #74).
- **Against:** the current stacking of header → type filter → sync banner →
  chips → search+Filter → long tag wall → Type/Tone/Use-case tabs. That's
  six persistent bands before a single thing (violates N1, N2).

### Filter / facet bar
- **Target:** a **single soft row of a few contextual chips** (as in the
  Figma), summoned/expandable when the user wants the full tag universe — not
  a permanent wall of 30+ tags. A `+ Filter` affordance opens the deeper
  filtering; it recedes when done (N4, N5).
- The full facet apparatus is powerful and stays — it just stops being
  resident (meta-principle).

### Grouping / Board view
- **Target:** grouping as **soft headings over the flowing grid**
  (`POSTER (11)` style), so the waterfall still reads as one breathing space.
  Rigid always-on columns are reserved for when the user explicitly enters a
  board/kanban intent — not the default resting layout (N7).
- The "Unclassified" reservoir is the **generous center**, not a cramped
  column with a backlog count (N8).

### Sidebar
- **Target:** calm — title, "All items", a short list of smart/manual
  collections. **Collapsible to a thin rail** (already done, #70). Reclaimed
  width flows to the grid (N6).

### Cards / grid
- **Target:** near-borderless cards floating on the canvas, generous gaps,
  color-block or real-image thumbnails, monospace titles, muted tags — the
  "floating piles" direction. **Card-size slider** exposes density as a dial
  (N9). Masonry flows left-to-right and balances (already done, #76).

### Detail panel & modals
- **Target:** summoned overlays that take focus and **recede fully** on
  close (N5). While open, they may claim space; at rest they claim none.

### Quick actions
- **Target:** contextual, **floating** access (e.g. the bottom-right
  favorites / to-review / client-x chips in the Figma) — peripheral and
  summonable, never a fixed bar (N4).

### Typography & tone
- **Direction:** Space Mono for a calm, editorial, "archive" register (see
  the memory note on the Space Mono redesign direction). The visual tone
  should feel like a quiet reading room, not a control surface.

---

*When in doubt: give the space back. The room to think is the feature.*
