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

### 8. Every collection is a world

The Organizer is not one space — it is a space that **reconfigures itself per
collection**. Each collection (smart or manual) carries its own *workspace
schema*, the way Photoshop carries workspaces: which facets matter here, how
this world groups by default, what its header filters by. Cleaning the global
filter bar was right, but a space with no internal architecture is
*over-cleaned*. The resolution is not to bring the global bar back — it is to
make the header **belong to the collection**: what was noise globally (30
tags) becomes signal locally (the 4–5 facets that actually matter in *this*
world), read like a table header.

- **Homogeneous** collection (e.g. all typography): header = its 4–5 key
  facets (serif?, condensed?…).
- **Heterogeneous** collection (mixed roles — images + articles + notes):
  the first level is **Group by Role**, then each role reveals its own facets.

### 9. Fixed vs. conditional — two reasons a thing isn't resident

Nothing is resident by default, but for two different reasons — and the
distinction decides *how* it comes back:

- **Fixed** structure — the left panel: interface controls and the
  manually/smart-created collections. These are *stable concepts*, not tied to
  what you're exploring right now. So they are **collapsed by default** and
  expand on demand: when you **drag something toward them**, or when you
  **open them intentionally**. They are never summoned *by the exploration
  itself*.
- **Conditional** structure — the right-side / floating modules: the folders
  panel, the *similar items* strip, contextual filters. These *are* tied to
  the current exploration, so they are **summoned by context** and recede when
  the context passes.

The workspace is therefore **modular** — assembled from pieces that come and
go depending on context (Samuel's sketch: "modular pieces that come and go
depending on context"). Modularity is the mechanism behind Principle 3's
"conditional, not resident."

### 10. Facets are structure; tags are anecdote; provenance is quiet signal

Two classes of metadata, and their status is **relative to the world you're
in**:

- **Facets** — structural properties of *this* collection (typography → style;
  a research board → role). They drive the header and the grouping.
- **Anecdotal tags** — free notes with no relation to the collection's facets
  (a color note on a typography item). Secondary; never the header.

The *same* tag can be signal in one world and anecdote in another. Separately,
**provenance matters**: tags the user wrote (intentional) are distinguished
from tags the AI suggested — but as **quiet color, never a loud badge**. This
reconciles the discarded #50/#51: the badge/icon version was noise; a calm
highlight that separates *mine* from *suggested* is signal.

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

**Universal drag & drop (issue #132)**
- N22. **If you can see an object, you can pick it up.** Every rendered
  object — grid cards, table rows, the open detail object, same-vibe
  thumbs, classify-folder peeks, related-reading rows, bench cards — is a
  drag source carrying the one shared payload (`lib/objectDrag.ts`,
  DRAG_MIME id-array). New object surfaces MUST spread `objectDragProps`;
  a view that renders objects without it is a dead end and a regression.
- N23. Drops are **additive and reversible**, never destructive moves:
  filing into a manual collection, adding to the bench (undoable), setting
  a classify facet (editable) — nothing is removed from where it came
  from, and dragging never forces navigation.
- N24. A target that can't accept a drop **explains itself** instead of
  ignoring the gesture — smart collections take the drop and answer with
  a notice ("fills itself by rule — edit the rule or use a manual
  collection"), amber ring on hover, never a silent rule mutation.

**Motion & continuity**
- N12. Expansion/contraction is **animated and continuous**, never a hard
  cut — the space itself is a feature, so its changes should read as the
  space breathing, not as elements popping.
- N12a. All motion goes through the shared tokens in `src/lib/chrome.ts`
  (Adaptive Chrome): 120ms micro / 180ms reveal / 220ms panel, ease-out
  entrances, ease-in exits, no springs, no `transition-all`. Motion says
  where a surface came from or went — never decorates. `MotionConfig
  reducedMotion="user"` is the accessibility floor.
- N12b. Temporary chrome never reflows the workspace: peeks and drag
  reveals **overlay** the content (the sidebar's floating capsule + overlay
  pattern); only the explicit *pinned* state participates in layout.
  Sidebar chrome states — compact / peek / drag-reveal / pinned — resolve
  in one place (`useWorkspaceChrome`), from the two store primitives that
  already existed (`sidebarCollapsed`, `dragRevealSidebar`); transient
  intent (hover, grace timers, scroll-away) never touches persisted state.

**Per-collection workspace**
- N13. A collection's header filters by **that collection's key facets**
  (homogeneous) — not the global most-common tags. Surface ~4–5, like a table
  header.
- N14. A heterogeneous collection groups by **Role first**, then reveals
  role-specific facets within each group.
- N15. The workspace schema is **per-collection state** (builds on
  `ManualCollection.facetSchema`) — surfaced as the collection's header, not
  buried in the detail panel.

**Grouping order & honesty**
- N16. Grouping shows **classified groups first**; the uncategorized / "—"
  bucket goes last, never first. Foregrounding the un-assimilated violates the
  assimilation ladder (Principle 5).
- N17. Filter/facet options that are **near-empty noise** (e.g. an AI-filled
  facet matching only 2–3 items) are pruned or de-emphasized — structure must
  be real, not "noise disguised as structure."

**Metadata provenance & class**
- N18. Facets drive the header; **anecdotal tags stay secondary** and never
  colonize it.
- N19. User-authored tags are **visually distinct** from AI-authored tags
  (data already exists: `tagFlags` 2=AI, 8=Manual) via **quiet color**, never
  per-tag badges/icons.

**Fixed vs. conditional chrome**
- N20. **Fixed** structure (left panel) is collapsed by default and expands
  only on **drag-toward** or **intentional open** — never summoned by the
  exploration itself.
- N21. **Conditional** modules (right / floating) are summoned by context and
  recede when the context passes (N5 applies).

---

## Layer 3 — Decisions (Per-screen applications)

Concrete direction per surface. Grounded in Samuel's cleaned Figma
(`node 25:2`, the "Grid view" exploration) and the current implementation.
These evolve as we build — update this section when a screen's direction
changes.

### Command bar (the primary instrument)
- **Target:** one adaptive, centered command bar owns the top — quiet and
  compacted while scrolling, prominent under focus, with intent-adaptive
  suggestions (tags / collections / types / item types as chips; Enter =
  free text; alt-click = exclude). Active query state stays expressed as
  the pills row beneath it. Breadcrumb/collection context is secondary —
  it lives as vertical text in the sidebar rail, never as a horizontal
  band. Advanced filter categories stay behind the φ summon inside the bar.

### Workbench (the worktable)
- **Concept split:** *Classify* is structured, intentional, durable
  (roles/facets inside a collection). The *Workbench* is provisional,
  exploratory, reversible — it exists to **delay formalization**: gather
  things before they mean anything; only afterwards offer "save as
  collection / add to existing / clear". Never turn it into another
  collection system or metadata form.
- **Spatial:** a compartment sliding flush from the right edge (membrane),
  deliberately distinct from ClassifyPanel's floating module. They share
  the right edge — opening one closes the other. ⌘J toggles.
- **Safe temporary work:** contents persist across sessions
  (store.workbenchIds); removals/clear are undoable in place; no
  confirmation dialogs during normal flow.
- **Same-vibe is NOT a Workbench action** (corrected 2026-07-19 — the first
  cut routed "See more" into the bench, which hijacked its drag-curation
  space for a purely exploratory glance). Non-destructive exploration is
  its own mechanism: `store.viewBackStack` snapshots the current
  view/filters/scroll before jumping to the `similar` view, surfaced as a
  dismissible "← Back to {label}" pill (bottom-left, clear of both the
  Adaptive Chrome capsule and the toasts). Popping it restores everything
  exactly, browser-back-style. The Workbench stays reserved for deliberate
  drag-and-drop curation; its own per-item ✦ (pulling more same-vibe
  neighbours into an existing pile) is the one legitimate overlap, since
  that's an explicit in-bench enrichment action, not a navigation.

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

### Collection workspace (per-collection header)
- **Target:** entering a collection adapts the top into *that collection's*
  header — its 4–5 key facets for a homogeneous collection, or a
  **Group-by-Role** first level for a heterogeneous one, read like a table
  header (Principles 8/10, N13–N15). Builds on the existing `facetSchema`,
  promoting it from the detail panel up to the space's header.
- **Against:** one global tag wall shown identically in every collection —
  each collection is a world with its own architecture, not a filter of the
  same soup.

### Grouping / Board view
- **Target:** grouping as **soft headings over the flowing grid**
  (`POSTER (11)` style), so the waterfall still reads as one breathing space.
  Rigid always-on columns are reserved for when the user explicitly enters a
  board/kanban intent — not the default resting layout (N7).
- **Order:** classified groups first, the "—"/uncategorized bucket last
  (N16); prune near-empty AI-filled facet options (N17).
- The "Unclassified" reservoir is the **generous center**, not a cramped
  column with a backlog count (N8).

### Left panel (fixed structure)
- **Why collapsed by default:** it holds *fixed* concepts — interface controls
  and the manually/smart-created collections — that are stable, not
  conditional to the current exploration (Principle 9). **Collapsed to a thin
  rail by default** (#70); expands only on **drag-toward** (dropping a card
  into a collection) or **intentional open** — never summoned by the
  exploration itself (N20). Reclaimed width flows to the grid (N6).

### Right-side / floating contextual modules
- **Target:** conditional modules that come and go — a folders/collections
  panel (with tabs, "+ new folder"), a horizontal *similar items* strip —
  summoned by context and receding when it passes (Principle 9, N21). Samuel's
  sketch: modular pieces assembled per context.

### Tag provenance & facets vs. anecdotal
- **Target:** user-authored tags in a **quiet highlight** (e.g. blue), AI tags
  plain — reconciling the discarded #50/#51 as calm color, not badges
  (Principle 10, N19). Facets lead the header; anecdotal tags stay secondary
  (N18).

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
