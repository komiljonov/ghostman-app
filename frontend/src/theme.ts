// Theme: the preference ("system" | "dark" | "light") is stored in Go; the
// resolved theme is applied as <html data-theme="dark|light">, which switches the
// design tokens (tokens.css). CodeMirror's theme reads the same tokens, so editors
// follow without being reconfigured.

export type ThemePref = "system" | "dark" | "light";
export type Theme = "dark" | "light";

export function resolveTheme(pref: ThemePref, systemPrefersDark: boolean): Theme {
  if (pref === "dark" || pref === "light") return pref;
  return systemPrefersDark ? "dark" : "light";
}

export const asPref = (v: string): ThemePref => (v === "dark" || v === "light" ? v : "system");

interface MediaQueryLike {
  matches: boolean;
  addEventListener: (type: "change", fn: () => void) => void;
  removeEventListener: (type: "change", fn: () => void) => void;
}

// Applies a preference and keeps following the OS while it is "system".
export function createThemeController(root: { dataset: Record<string, string | undefined> }, mql: MediaQueryLike) {
  let pref: ThemePref = "system";
  const apply = () => {
    root.dataset.theme = resolveTheme(pref, mql.matches);
  };
  const onSystemChange = () => {
    if (pref === "system") apply();
  };
  mql.addEventListener("change", onSystemChange);
  apply();
  return {
    set(next: ThemePref) {
      pref = next;
      apply();
    },
    get: () => pref,
    current: () => root.dataset.theme as Theme,
    dispose: () => mql.removeEventListener("change", onSystemChange),
  };
}
