// The ONE row drag-and-drop mechanism for flat lists (environments, variables,
// proxies, webhooks, examples, projects, key/value rows). Same feel as the tree
// and tab drags: a press becomes a drag after 5 px (clicks and context menus keep
// working), a ghost follows the pointer, an insertion line shows the target (none
// for a no-op), the scroll container auto-scrolls near its edges, Escape cancels.
// Rows are the elements matching `rowSelector` inside `list()`, read once per frame
// in screen order; each carries its id in data-drag-id. The order math is
// rowOrder.ts; the overlay is RowDragLayer.tsx; the drop hands the new full order
// to the surface, which persists it through its own order endpoint.
import { createSignal } from "solid-js";
import { insertIndex, lineY, reorderIds, RowRect } from "./rowOrder";

export const DRAG_THRESHOLD_PX = 5;
const SCROLL_EDGE_PX = 28;
const SCROLL_STEP_PX = 10;
// Presses on these never start a row drag (unless they are inside the handle).
export const DEFAULT_IGNORE = "input, textarea, select, button, a, .cm-editor, [contenteditable], .var-cell";

export interface RowDragView {
  draggedId: string;
  label: string;
  x: number;
  y: number;
  line: { y: number; left: number; width: number } | null; // null: a no-op target
}

export interface RowDragOptions {
  list: () => HTMLElement | undefined;
  rowSelector?: string; // default "[data-drag-id]"
  handle?: string; // only presses inside a match start a drag (rows with editable cells)
  ignore?: string; // presses inside a match never start one (default DEFAULT_IGNORE; "" = none)
  scroller?: () => HTMLElement | undefined; // default: the list's nearest scrollable ancestor
  stickyTop?: () => number; // px at the scroller's top covered by a sticky header
  canStart?: () => boolean;
  label?: (id: string, row: HTMLElement) => string;
  onDrop: (order: string[], draggedId: string) => void;
  // Test seams (default: the window, the DOM, requestAnimationFrame).
  events?: EventTarget;
  readRows?: () => RowRect[];
  frame?: (fn: () => void) => () => void;
}

interface PressTarget {
  closest: (selector: string) => Element | null;
}

// <html>.row-dragging: grabbing cursor, no text selection while a row drags.
const draggingClass = (on: boolean) => {
  if (typeof document !== "undefined") document.documentElement.classList.toggle("row-dragging", on);
};

function nearestScroller(el: HTMLElement | undefined): HTMLElement | undefined {
  for (let a = el?.parentElement; a; a = a.parentElement) {
    if (/(auto|scroll)/.test(getComputedStyle(a).overflowY)) return a;
  }
  return undefined;
}

export function createRowDrag(opts: RowDragOptions) {
  const [view, setView] = createSignal<RowDragView>();
  const rowSelector = opts.rowSelector ?? "[data-drag-id]";
  const ignore = opts.ignore ?? DEFAULT_IGNORE;
  const events = () => opts.events ?? window;
  let suppressClick = false;

  const domRows = (): RowRect[] => {
    const list = opts.list();
    if (!list) return [];
    return [...list.querySelectorAll<HTMLElement>(rowSelector)]
      .filter((el) => el.offsetParent !== null)
      .map((el) => {
        const r = el.getBoundingClientRect();
        return { id: el.dataset.dragId!, top: r.top, bottom: r.bottom };
      });
  };
  const readRows = opts.readRows ?? domRows;
  const frame = opts.frame ?? ((fn: () => void) => {
    let id = requestAnimationFrame(function tick() {
      id = requestAnimationFrame(tick);
      fn();
    });
    return () => cancelAnimationFrame(id);
  });

  // The row a press would drag (its id), or undefined.
  const pressedRow = (target: PressTarget): Element | undefined => {
    if (opts.handle && !target.closest(opts.handle)) return undefined;
    if (!opts.handle && ignore && target.closest(ignore)) return undefined;
    return target.closest(rowSelector) ?? undefined;
  };

  const onPointerDown = (e: { button: number; clientX: number; clientY: number; target: EventTarget | null }) => {
    if (e.button !== 0 || (opts.canStart && !opts.canStart())) return;
    const row = pressedRow(e.target as unknown as PressTarget) as HTMLElement | undefined;
    if (!row) return;
    const draggedId = row.dataset.dragId!;
    const label = opts.label?.(draggedId, row) ?? row.textContent?.trim() ?? "";
    const startX = e.clientX;
    const startY = e.clientY;
    let dragging = false;
    let x = startX;
    let y = startY;
    let stopFrame: (() => void) | undefined;
    let target: number | null = null; // the insert index of the shown line (null: no-op)
    const scroller = () => opts.scroller?.() ?? nearestScroller(opts.list());

    const recompute = () => {
      const rows = readRows();
      const sc = scroller();
      const box = sc?.getBoundingClientRect();
      // Never aim under a sticky header or past the visible part of the list.
      const top = box ? box.top + (opts.stickyTop?.() ?? 0) : -Infinity;
      const yy = box ? Math.min(Math.max(y, top), box.bottom) : y;
      const index = insertIndex(rows, yy);
      const order = reorderIds(rows.map((r) => r.id), draggedId, index);
      target = order ? index : null;
      const list = opts.list()?.getBoundingClientRect();
      setView({
        draggedId, label, x, y,
        line: order ? { y: lineY(rows, index), left: list?.left ?? 0, width: list?.width ?? 0 } : null,
      });
    };

    // Auto-scroll while the pointer is near the scroller's top (below a sticky header) or bottom.
    const tick = () => {
      const sc = scroller();
      if (!sc) return;
      const r = sc.getBoundingClientRect();
      const top = r.top + (opts.stickyTop?.() ?? 0);
      const delta = y < top + SCROLL_EDGE_PX ? -SCROLL_STEP_PX : y > r.bottom - SCROLL_EDGE_PX ? SCROLL_STEP_PX : 0;
      if (delta === 0) return;
      const before = sc.scrollTop;
      sc.scrollTop += delta;
      if (sc.scrollTop !== before) recompute();
    };

    const start = () => {
      dragging = true;
      draggingClass(true);
      events().addEventListener("keydown", onKey, true);
      stopFrame = frame(tick);
    };
    const move = (ev: Event) => {
      const p = ev as PointerEvent;
      x = p.clientX;
      y = p.clientY;
      if (!dragging) {
        if (Math.hypot(x - startX, y - startY) < DRAG_THRESHOLD_PX) return;
        start();
      }
      recompute();
    };
    const cleanup = () => {
      events().removeEventListener("pointermove", move);
      events().removeEventListener("pointerup", up);
      events().removeEventListener("pointercancel", cleanup);
      events().removeEventListener("keydown", onKey, true);
      stopFrame?.();
      draggingClass(false);
      setView(undefined);
    };
    const up = () => {
      const v = view();
      const wasDragging = dragging;
      cleanup();
      if (!wasDragging) return;
      suppressClick = true; // the click after this release is not a row click
      setTimeout(() => (suppressClick = false), 0);
      if (!v?.line || target === null) return;
      const order = reorderIds(readRows().map((r) => r.id), draggedId, target);
      if (order) opts.onDrop(order, draggedId);
    };
    const onKey = (ev: Event) => {
      if ((ev as KeyboardEvent).key !== "Escape") return;
      ev.preventDefault();
      ev.stopPropagation();
      cleanup();
    };
    events().addEventListener("pointermove", move);
    events().addEventListener("pointerup", up);
    events().addEventListener("pointercancel", cleanup);
  };

  return {
    view,
    onPointerDown,
    isDragging: (id: string) => view()?.draggedId === id,
    // True once, right after a drag ended: a row's click handler skips that click.
    consumeClick: () => {
      const s = suppressClick;
      suppressClick = false;
      return s;
    },
  };
}
