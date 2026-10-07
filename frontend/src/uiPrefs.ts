// Persisted layout preferences (Go settings: ui_sidebar_width, ui_response_wrap),
// loaded once at startup. The sidebar width is applied as a CSS variable on <html>
// (no component re-renders while dragging); wrap is a signal read by every tab.
import { createSignal } from "solid-js";
import { GetUIPrefs, SetBulkMode, SetResponseWrap, SetSidebarWidth } from "../wailsjs/go/main/App";
import type { BulkKind } from "./bulkEdit";
import { clampSidebar, SIDEBAR_DEFAULT } from "./layout";

const [wrap, setWrapSignal] = createSignal(true);
// What the user chose (dragged or saved); the applied width is this clamped to the
// current window, so shrinking the window and growing it back restores it.
let preferredWidth = SIDEBAR_DEFAULT;

export const responseWrap = wrap;

// Bulk text view per kind of key/value table — global (ui_bulk_mode_<kind>):
// preferring bulk for form bodies shows every request's form body in bulk.
const [bulk, setBulk] = createSignal<Record<BulkKind, boolean>>({ params: false, headers: false, form: false });

export const bulkMode = (kind: BulkKind) => bulk()[kind];

export function setBulkMode(kind: BulkKind, on: boolean) {
  setBulk({ ...bulk(), [kind]: on });
  void SetBulkMode(kind, on);
}

export function setResponseWrap(next: boolean) {
  setWrapSignal(next);
  void SetResponseWrap(next);
}

const applyWidth = () => {
  const px = clampSidebar(preferredWidth, window.innerWidth);
  document.documentElement.style.setProperty("--sidebar-width", `${px}px`);
  return px;
};

// The width on screen right now.
export const currentSidebarWidth = () => clampSidebar(preferredWidth, window.innerWidth);

// Sets the width live (CSS variable only); persist=true also saves it.
export function applySidebarWidth(px: number, persist = false) {
  preferredWidth = clampSidebar(px, window.innerWidth);
  applyWidth();
  if (persist) void SetSidebarWidth(preferredWidth);
}

export async function initUIPrefs() {
  applyWidth();
  try {
    const prefs = await GetUIPrefs();
    preferredWidth = prefs.sidebar_width; // clamped on apply, kept as chosen
    applyWidth();
    setWrapSignal(prefs.response_wrap);
    setBulk({ params: prefs.bulk_params, headers: prefs.bulk_headers, form: prefs.bulk_form });
  } catch {
    // Bridge not ready (should not happen): keep the defaults.
  }
  window.addEventListener("resize", applyWidth);
}
