// Table cells (params / headers / form fields) render as plain highlighted text and
// mount a CodeMirror editor only while needed: focused (typing, Tab navigation),
// hovered (so the {{var}} hover tooltip works) or while a tooltip edit is open.
// A 30-row table therefore has at most one or two live editors.
export interface CellState {
  focused: boolean;
  hovered: boolean;
  tooltipOpen: boolean;
}

export const cellNeedsEditor = (s: CellState) => s.focused || s.hovered || s.tooltipOpen;
