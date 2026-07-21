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

_(nothing yet — the collection-meaning flow lands here once the multi-entity
setup wizard replaces it; see the "what's in your mind" work.)_
