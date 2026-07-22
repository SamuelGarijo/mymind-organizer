# Deprecated approaches — kept, not deleted

Code that a redesign replaced but that Samuel wants recoverable ("elimina o
archiva el código en alguna carpeta de deprecated approach por si lo
queremos utilizar", 2026-07-21).

This directory is **excluded from `tsconfig.json`**, so nothing here is
type-checked, and nothing imports it, so Vite never bundles it. It is
read-only reference — a place to look, not a place the app runs from. If you
want a piece back, move it out of here and wire it up deliberately.

Do not import from `src/deprecated/` in live code. If you find yourself
wanting to, that's the signal the thing wasn't really deprecated — pull it
out properly instead.

## Archived here

- **`roleSuggestion.ts`** + **`curatedRoleFields.ts`** (2026-07-23) — the
  old 8-kind starter catalog and the tag/entity_type rule table that guessed
  a type per object. Both superseded by `src/lib/designerKinds.ts`, which
  holds the designed 22-kind taxonomy and classifies 100% of the archive.
  Kept because the rule table is a readable record of which signals were
  tried; nothing imports either.

- **`TypologyPanel.tsx`** + **`collectionTypology.ts`** (2026-07-22) — the
  old single "what does this collection mean?" chooser (selection / quality
  / kind) and its proposal engine. Replaced by the multi-entity
  `CollectionWizard` (a collection declares the KINDS it contains and, per
  kind, which properties it shows). Its relative imports point at the old
  `src/components` / `src/lib` locations — fix them if you ever wire it
  back. `src/lib/classifier.ts` (the Gemini "ask what else is worth
  knowing" client it used) was left in `lib/`, unused, ready to re-attach to
  the wizard's field step.
