// Pointer-driven drag-and-drop for the sidebar tree (the rules live in treeDnd.ts).
// Same feel as tab dragging: a press becomes a drag only after 5 px, so clicks and
// context menus keep working. While dragging: a ghost follows the cursor, an
// insertion line or a folder highlight shows the target (nothing, and a no-drop
// cursor, on invalid targets), a collapsed folder opens after 700 ms of hovering,
// and the sidebar scrolls near its top/bottom edge. Escape cancels.
import { createSignal } from "solid-js";
import type { Tree } from "./tree";
import { computeDrop, DndRow, Drop, Dragged, NodeKind, PlaceArgs, placement } from "./treeDnd";

export const DRAG_THRESHOLD_PX = 5;
const EXPAND_AFTER_MS = 700;
const SCROLL_EDGE_PX = 28;
const SCROLL_STEP_PX = 10;

export interface DragView {
  dragged: Dragged;
  label: string;
  method?: string;
  x: number;
  y: number;
  drop: Drop | null;
  listLeft: number;
  listWidth: number;
}

export interface TreeDragOptions {
  tree: () => Tree;
  list: () => HTMLElement | undefined; // ul.tree
  scroller: () => HTMLElement | undefined; // the scrolling sidebar
  canStart: () => boolean;
  expand: (folderId: string) => void;
  drop: (dragged: Dragged, args: PlaceArgs) => Promise<void>;
}

// Rows in screen order from the DOM (each li.tree-item carries data-* about its node).
function readRows(list: HTMLElement): DndRow[] {
  return [...list.querySelectorAll<HTMLElement>("li.tree-item")].map((li) => {
    const row = li.querySelector<HTMLElement>(":scope > .tree-row")!.getBoundingClientRect();
    const block = li.getBoundingClientRect();
    return {
      id: li.dataset.id!,
      kind: li.dataset.kind as NodeKind,
      parentId: li.dataset.parent || null,
      depth: Number(li.dataset.depth),
      expanded: li.dataset.expanded === "true",
      rowTop: row.top, rowBottom: row.bottom, blockTop: block.top, blockBottom: block.bottom,
    };
  });
}

export function createTreeDrag(opts: TreeDragOptions) {
  const [view, setView] = createSignal<DragView>();
  let suppressClick = false;

  const onPointerDown = (e: PointerEvent) => {
    if (e.button !== 0 || !opts.canStart()) return;
    const target = e.target as HTMLElement;
    if (target.closest(".row-menu-trigger, .tree-rename, input")) return;
    const li = target.closest<HTMLElement>("li.tree-item");
    const list = opts.list();
    if (!li || !list) return;
    const dragged: Dragged = { id: li.dataset.id!, kind: li.dataset.kind as NodeKind };
    const label = li.dataset.name ?? "";
    const method = li.dataset.method || undefined;
    const startX = e.clientX;
    const startY = e.clientY;
    let dragging = false;
    let x = startX;
    let y = startY;
    let frame = 0;
    let expandTimer: ReturnType<typeof setTimeout> | undefined;
    let expandFor: string | undefined;

    const recompute = () => {
      const rows = readRows(list);
      const lr = list.getBoundingClientRect();
      // Only over the sidebar: dragging out over the editor drops nowhere.
      const drop = x < lr.left || x > lr.right ? null : computeDrop(rows, opts.tree(), dragged, y);
      // Hovering a collapsed folder (as a drop INTO it) opens it after a moment.
      const into = drop?.type === "into" && !rows.find((r) => r.id === drop.folderId)?.expanded ? drop.folderId : undefined;
      if (into !== expandFor) {
        clearTimeout(expandTimer);
        expandFor = into;
        if (into) {
          expandTimer = setTimeout(() => {
            opts.expand(into);
            queueMicrotask(recompute); // the rows below just moved
          }, EXPAND_AFTER_MS);
        }
      }
      setView({ dragged, label, method, x, y, drop, listLeft: lr.left, listWidth: lr.width });
      document.documentElement.classList.toggle("tree-nodrop", drop === null);
    };

    // Auto-scroll while the pointer is near the sidebar's top/bottom edge.
    const tick = () => {
      frame = requestAnimationFrame(tick);
      const sc = opts.scroller();
      if (!sc) return;
      const r = sc.getBoundingClientRect();
      const delta = y < r.top + SCROLL_EDGE_PX ? -SCROLL_STEP_PX : y > r.bottom - SCROLL_EDGE_PX ? SCROLL_STEP_PX : 0;
      if (delta === 0) return;
      const before = sc.scrollTop;
      sc.scrollTop += delta;
      if (sc.scrollTop !== before) recompute();
    };

    const start = () => {
      dragging = true;
      document.documentElement.classList.add("tree-dragging");
      window.addEventListener("keydown", onKey, true);
      frame = requestAnimationFrame(tick);
    };
    const move = (ev: PointerEvent) => {
      x = ev.clientX;
      y = ev.clientY;
      if (!dragging) {
        if (Math.hypot(x - startX, y - startY) < DRAG_THRESHOLD_PX) return;
        start();
      }
      recompute();
    };
    const cleanup = () => {
      window.removeEventListener("pointermove", move);
      window.removeEventListener("pointerup", up);
      window.removeEventListener("pointercancel", cancel);
      window.removeEventListener("keydown", onKey, true);
      cancelAnimationFrame(frame);
      clearTimeout(expandTimer);
      document.documentElement.classList.remove("tree-dragging", "tree-nodrop");
      setView(undefined);
    };
    const up = () => {
      const drop = view()?.drop ?? null;
      const wasDragging = dragging;
      cleanup();
      if (!wasDragging) return;
      // The click that follows this release is not a row click (open / toggle).
      suppressClick = true;
      setTimeout(() => (suppressClick = false), 0);
      const args = drop ? placement(opts.tree(), dragged, drop) : null;
      if (args) void opts.drop(dragged, args);
    };
    const cancel = () => cleanup();
    const onKey = (ev: KeyboardEvent) => {
      if (ev.key !== "Escape") return;
      ev.preventDefault();
      ev.stopPropagation();
      cleanup();
    };
    window.addEventListener("pointermove", move);
    window.addEventListener("pointerup", up);
    window.addEventListener("pointercancel", cancel);
  };

  return {
    view,
    onPointerDown,
    // True once, right after a drag ended: the row's click handler skips that click.
    consumeClick: () => {
      const s = suppressClick;
      suppressClick = false;
      return s;
    },
  };
}
