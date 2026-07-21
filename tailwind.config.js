/** @type {import('tailwindcss').Config} */
export default {
  content: ["./index.html", "./src/**/*.{ts,tsx}"],
  theme: {
    extend: {
      fontFamily: {
        // The archive register (docs/design-philosophy.md, Typography &
        // tone): Space Mono for breadcrumbs, labels, counts — the quiet
        // editorial voice. Body text stays system sans.
        mono: ['"Space Mono"', "ui-monospace", "monospace"],
      },
      // Every colour is a CSS variable so the whole app can change register
      // without a single className changing (dark mode, 2026-07-21). The
      // variables hold space-separated RGB CHANNELS rather than hex,
      // because that's what lets Tailwind's slash-opacity keep working —
      // `text-ink/70` and `bg-accent/5` are used all over this codebase and
      // would silently break against a plain `var(--x)`.
      colors: {
        canvas: "rgb(var(--color-canvas) / <alpha-value>)",
        panel: "rgb(var(--color-panel) / <alpha-value>)",
        ink: "rgb(var(--color-ink) / <alpha-value>)",
        muted: "rgb(var(--color-muted) / <alpha-value>)",
        line: "rgb(var(--color-line) / <alpha-value>)",
        accent: "rgb(var(--color-accent) / <alpha-value>)",
        // Success and failure were fixed Tailwind palette classes
        // (emerald-50, red-700) until dark mode: an emerald-50 panel on a
        // near-black canvas is a fluorescent slab, and red-700 on it is
        // barely legible. Semantic tokens instead, so both registers get a
        // green and a red that belong to them.
        ok: "rgb(var(--color-ok) / <alpha-value>)",
        danger: "rgb(var(--color-danger) / <alpha-value>)",
      },
      // Sharp corners everywhere (Samuel: "borde radios afilados, máximo 2
      // píxeles") — the ONE deliberate exception is `full`, left at
      // Tailwind's default 9999px so the search capsule (and its attached
      // φ button) keeps its pill shape. Every other radius utility
      // (sm/md/lg/xl/2xl/card) collapses to 2px globally from here, so no
      // component className needs touching — this is the single source.
      borderRadius: {
        sm: "2px",
        DEFAULT: "2px",
        md: "2px",
        lg: "2px",
        xl: "2px",
        "2xl": "2px",
        card: "2px",
      },
      // Shadows are variables for the same reason, and it isn't cosmetic: a
      // black drop shadow is simply invisible on a dark canvas, so cards
      // would lose the lift that makes them read as separate pieces. Dark
      // mode swaps in a deeper, wider shadow instead of a lighter one.
      boxShadow: {
        card: "var(--shadow-card)",
        cardHover: "var(--shadow-card-hover)",
      },
    },
  },
  plugins: [],
};
