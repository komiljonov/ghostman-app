// Vertically resizable script editors (ScriptEditor.tsx): a handle under each
// editor drags its height between 80 px and 60 % of the pane it scrolls in (the
// request Scripts sub-tab, the folder Settings… modal), so the pane's own scroll
// always reaches everything. One height per editor KIND (pre / post), global,
// persisted (Go: ui_script_height_<kind>, 0 = default); double-click resets.

export const SCRIPT_HEIGHT_DEFAULT = 150;
export const SCRIPT_HEIGHT_MIN = 80;
export const SCRIPT_HEIGHT_MAX_SHARE = 0.6;

// The height to apply: the wanted one clamped to [min, 60 % of the pane] (the
// minimum wins in a pane too small for both).
export function clampScriptHeight(px: number, paneHeight: number): number {
  const max = Math.max(SCRIPT_HEIGHT_MIN, Math.floor(paneHeight * SCRIPT_HEIGHT_MAX_SHARE));
  return Math.round(Math.min(Math.max(px, SCRIPT_HEIGHT_MIN), max));
}

// A stored height (0 = default) as the height to show.
export const shownScriptHeight = (stored: number, paneHeight: number) =>
  clampScriptHeight(stored > 0 ? stored : SCRIPT_HEIGHT_DEFAULT, paneHeight);

// What a finished drag saves: the clamped height; the default itself saves as 0.
export const storedScriptHeight = (px: number) => (px === SCRIPT_HEIGHT_DEFAULT ? 0 : px);
