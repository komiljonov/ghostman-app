// Where a context menu goes: its top-left corner at the pointer; if it would run
// past the window's right or bottom edge, it flips to the other side of the
// pointer on that axis (so a corner of the menu still touches the cursor). Only
// if the window is too small for either side is it clamped inside the margin.

export interface Point {
  x: number;
  y: number;
}

export interface Size {
  width: number;
  height: number;
}

export const MENU_MARGIN = 4;

function axis(at: number, size: number, viewport: number, margin: number): number {
  if (at + size <= viewport - margin) return at; // fits after the pointer
  if (at - size >= margin) return at - size; // flip: ends at the pointer
  return Math.max(margin, Math.min(at, viewport - margin - size));
}

export function menuPosition(pointer: Point, menu: Size, viewport: Size, margin = MENU_MARGIN): Point {
  return {
    x: axis(pointer.x, menu.width, viewport.width, margin),
    y: axis(pointer.y, menu.height, viewport.height, margin),
  };
}
