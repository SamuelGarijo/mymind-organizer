// Tailwind's JIT compiler only picks up class names it can see literally in
// source, so arbitrary/dynamic group names can't map to Tailwind classes.
// Instead we hash the group name to a small fixed palette and apply it as an
// inline style — deterministic (the same group always gets the same color)
// without needing a color picker or a safelist.
const PALETTE: { bg: string; text: string; border: string }[] = [
  { bg: "rgba(106, 92, 255, 0.1)", text: "#6a5cff", border: "rgba(106, 92, 255, 0.25)" }, // accent purple
  { bg: "rgba(217, 119, 6, 0.1)", text: "#b45309", border: "rgba(217, 119, 6, 0.25)" }, // amber
  { bg: "rgba(13, 148, 136, 0.1)", text: "#0f766e", border: "rgba(13, 148, 136, 0.25)" }, // teal
  { bg: "rgba(219, 39, 119, 0.1)", text: "#be185d", border: "rgba(219, 39, 119, 0.25)" }, // pink
  { bg: "rgba(37, 99, 235, 0.1)", text: "#1d4ed8", border: "rgba(37, 99, 235, 0.25)" }, // blue
  { bg: "rgba(22, 163, 74, 0.1)", text: "#15803d", border: "rgba(22, 163, 74, 0.25)" }, // green
];

function hashString(s: string): number {
  let h = 0;
  for (let i = 0; i < s.length; i++) {
    h = (h << 5) - h + s.charCodeAt(i);
    h |= 0;
  }
  return Math.abs(h);
}

export function colorForGroup(group: string): { bg: string; text: string; border: string } {
  return PALETTE[hashString(group.trim().toLowerCase()) % PALETTE.length];
}
