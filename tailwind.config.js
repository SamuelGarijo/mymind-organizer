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
      colors: {
        canvas: "#f4f3f0",
        panel: "#ffffff",
        ink: "#1c1c1c",
        muted: "#8a8a85",
        line: "#e7e5e0",
        accent: "#6a5cff",
      },
      borderRadius: {
        card: "14px",
      },
      boxShadow: {
        card: "0 1px 2px rgba(0,0,0,0.04), 0 4px 14px rgba(0,0,0,0.05)",
        cardHover: "0 2px 4px rgba(0,0,0,0.06), 0 10px 24px rgba(0,0,0,0.09)",
      },
    },
  },
  plugins: [],
};
