// Sidebar sizing rules. Pure, so unit-testable; SidebarResizer applies them.

export const SIDEBAR_DEFAULT = 260; // mirrors main.DefaultSidebarWidth
export const SIDEBAR_MIN = 180;

// The sidebar width in px: at least 180, at most half the window (the minimum wins
// when the window is tiny), rounded to whole pixels.
export function clampSidebar(px: number, windowWidth: number): number {
  const max = Math.max(SIDEBAR_MIN, Math.floor(windowWidth / 2));
  return Math.round(Math.min(max, Math.max(SIDEBAR_MIN, px)));
}
