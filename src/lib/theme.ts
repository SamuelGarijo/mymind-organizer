/**
 * Light, dark, and follow-the-system (Samuel, 2026-07-21).
 *
 * "System" is a PREFERENCE, not a third palette: it's resolved here and
 * written to `data-theme` exactly like an explicit choice, so one mechanism
 * decides the theme and the CSS never has to arbitrate between an attribute
 * and a media query. That's also why index.css has no
 * `prefers-color-scheme` block — two sources of truth for one visual fact
 * is how a toggle ends up appearing to do nothing.
 */

export type ThemeChoice = "light" | "dark" | "system";

const QUERY = "(prefers-color-scheme: dark)";

export function systemPrefersDark(): boolean {
  return typeof window !== "undefined" && window.matchMedia?.(QUERY).matches === true;
}

export function resolveTheme(choice: ThemeChoice): "light" | "dark" {
  if (choice === "system") return systemPrefersDark() ? "dark" : "light";
  return choice;
}

/** Writes the resolved theme to the document. Also sets `color-scheme` via
 * the stylesheet, which is what makes native form controls, scrollbars and
 * the empty space around the page match — a dark app framed by white browser
 * chrome looks broken rather than themed. */
export const THEME_HINT_KEY = "organizer-theme";

export function applyTheme(choice: ThemeChoice): void {
  if (typeof document === "undefined") return;
  document.documentElement.setAttribute("data-theme", resolveTheme(choice));
  // A localStorage mirror of the CHOICE, read by the inline script in
  // index.html before first paint. The real value lives in the persisted
  // store, but that's IndexedDB and therefore async — by the time it
  // rehydrates the page has already painted, and a dark-mode user would see
  // a white flash on every single launch. localStorage is the only
  // synchronous store available that early, and this is the one thing it's
  // used for.
  try {
    localStorage.setItem(THEME_HINT_KEY, choice);
  } catch {
    /* private mode, quota — a flash is survivable, a crash isn't */
  }
}

/** Re-resolves when the OS flips, but only while the choice is "system" —
 * an explicit light/dark must not be overridden at sunset. Returns an
 * unsubscribe. */
export function watchSystemTheme(choice: ThemeChoice, onChange: () => void): () => void {
  if (choice !== "system" || typeof window === "undefined" || !window.matchMedia) {
    return () => {};
  }
  const media = window.matchMedia(QUERY);
  media.addEventListener("change", onChange);

  // Belt and braces, and the braces matter more than they look. The OS
  // almost never flips while you're staring at the window — it flips at
  // sunset, while the app sits behind a browser tab or a full-screen
  // editor. A `change` listener alone is also the only signal here, and
  // signals that fire in exactly one situation are the ones that quietly
  // stop working: Chrome's own media emulation, for instance, updates
  // `matches` without ever dispatching `change` (measured, 2026-07-21).
  // Re-resolving when the window comes back is cheap and catches both.
  // No visibility guard on `focus`: the window receiving focus IS the
  // window being looked at, and gating it on `visibilityState` only adds a
  // way to fail — an embedded/backgrounded frame can report "hidden" while
  // focused, and then the theme silently stops tracking (measured,
  // 2026-07-21). Re-resolving is one matchMedia read and an attribute
  // write; there is nothing to protect against here.
  const recheck = () => onChange();
  const onVisible = () => {
    if (document.visibilityState === "visible") onChange();
  };
  window.addEventListener("focus", recheck);
  document.addEventListener("visibilitychange", onVisible);

  return () => {
    media.removeEventListener("change", onChange);
    window.removeEventListener("focus", recheck);
    document.removeEventListener("visibilitychange", onVisible);
  };
}

export const THEME_LABELS: Record<ThemeChoice, string> = {
  light: "Light",
  dark: "Dark",
  system: "System",
};
