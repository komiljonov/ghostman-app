import { createSignal } from "solid-js";
import { GetTheme, SetTheme } from "../wailsjs/go/main/App";
import { asPref, createThemeController, ThemePref } from "./theme";

// App-wide theme state: the preference lives in Go (settings key "theme"); the
// controller applies it to <html data-theme> and follows the OS while on System.
const controller = createThemeController(document.documentElement, window.matchMedia("(prefers-color-scheme: dark)"));
const [pref, setPrefSignal] = createSignal<ThemePref>("system");

export { pref as themePref };

export async function initTheme() {
  const saved = asPref(await GetTheme());
  setPrefSignal(saved);
  controller.set(saved);
}

// Applies instantly, then persists.
export async function setThemePref(next: ThemePref): Promise<string | undefined> {
  setPrefSignal(next);
  controller.set(next);
  const res = await SetTheme(next);
  return res.error?.message;
}
