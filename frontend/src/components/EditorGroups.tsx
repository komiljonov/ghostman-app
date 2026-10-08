import { createEffect, createMemo, createSignal, For, JSX, on, onCleanup, onMount, Show } from "solid-js";
import { Portal } from "solid-js/web";
import { DropTarget, GroupHit, hitTest, insertionX, isNoop, overlayRect, PxRect } from "../dropZone";
import { entrySide, layoutRects, Side } from "../layoutTree";
import { TabsController, TabState } from "../tabsController";
import EditorGroup from "./EditorGroup";
import GroupSash from "./GroupSash";
import Icon from "./Icon";
import MethodBadge from "./MethodBadge";

interface Props {
  controller: TabsController;
  renderTab: (tab: TabState) => JSX.Element;
}

const DRAG_THRESHOLD_PX = 5;

interface DragState {
  key: string;
  x: number; // pointer, viewport px (the ghost)
  y: number;
  target: DropTarget | null; // null: a drop here cancels (or is a no-op)
  overlay?: PxRect; // zone preview, relative to the editor area
  line?: { x: number; top: number; height: number }; // tab-bar insertion line, area-relative
}

const rectOf = (el: Element | null): PxRect => {
  const r = el?.getBoundingClientRect();
  return r ? { left: r.left, top: r.top, width: r.width, height: r.height } : { left: 0, top: 0, width: 0, height: 0 };
};

// The editor area: editor groups (VS Code style) laid out from the controller's
// split tree. Groups and sashes are FLAT siblings positioned from computed rects
// (layoutTree.layoutRects), keyed by group id, so splits never re-mount editors.
//
// Tab drag & drop (rules in dropZone.ts): a press becomes a drag after 5 px; the
// group rects are captured then and hit-tested once per animation frame. Over a
// tab bar → insertion line; over a group's content → the zone preview (whole
// group or the half on that side, animated between zones, fading in and out).
// Drop applies it; Escape or a drop outside any target cancels.
export default function EditorGroups(props: Props) {
  let area!: HTMLDivElement;
  const c = () => props.controller;
  const rects = createMemo(() => layoutRects(c().state.layout.root));
  // Ids only (strings): <For> keeps each group's component while the tree changes.
  const ids = createMemo(() => rects().groups.map((g) => g.id), [], { equals: (a, b) => a.length === b.length && a.every((x, i) => x === b[i]) });
  const groupRect = (id: string) => rects().groups.find((g) => g.id === id) ?? { x: 0, y: 0, w: 0, h: 0 };
  // Sashes by stable key too: a resize changes their position, never their element
  // (a re-created sash would drop the drag in progress).
  const sashKey = (s: { splitId: string; index: number }) => `${s.splitId}:${s.index}`;
  const sashKeys = createMemo(() => rects().sashes.map(sashKey), [], { equals: (a, b) => a.length === b.length && a.every((x, i) => x === b[i]) });
  const sashOf = (key: string) => rects().sashes.find((s) => sashKey(s) === key);
  const [resizing, setResizing] = createSignal(false);

  // A group that appears after the layout was restored grows in from its side.
  const seen = new Set<string>();
  let primed = false;
  const enteringFor = (id: string): Side | null => {
    const isNew = primed && !seen.has(id);
    seen.add(id);
    return isNew ? entrySide(c().state.layout.root, id) : null;
  };
  createEffect(on(() => c().state.restored, (r) => {
    if (r) queueMicrotask(() => (primed = true));
  }));

  // Sizes below the minimums for this window (restored on a smaller window, or
  // the window shrank) are lifted — once the area has settled (debounced), never
  // from a transient size during startup or a window drag.
  onMount(() => {
    let timer: ReturnType<typeof setTimeout> | undefined;
    const fit = () => {
      clearTimeout(timer);
      timer = setTimeout(() => {
        if (!c().state.restored) return;
        const r = area.getBoundingClientRect();
        if (r.width > 0 && r.height > 0) c().fitTo(r.width, r.height);
      }, 200);
    };
    const ro = new ResizeObserver(fit);
    ro.observe(area);
    createEffect(on(() => c().state.restored, (r) => r && fit()));
    onCleanup(() => {
      ro.disconnect();
      clearTimeout(timer);
    });
  });

  // ---- Drag & drop ----
  const [drag, setDrag] = createSignal<DragState>();
  const [overlayShown, setOverlayShown] = createSignal(false);
  const [overlayRectPx, setOverlayRectPx] = createSignal<PxRect>({ left: 0, top: 0, width: 0, height: 0 });
  const [overlaySnap, setOverlaySnap] = createSignal(false);
  // After a drag (dropped or cancelled) the click that may follow is not an
  // activation. The flag stays until that click consumes it or the next press
  // clears it — no timers (the click can come well after the release, e.g. Esc).
  let justDragged = false;
  onMount(() => {
    const clear = () => (justDragged = false);
    window.addEventListener("pointerdown", clear, true);
    onCleanup(() => window.removeEventListener("pointerdown", clear, true));
  });

  const consumeClick = () => {
    if (!justDragged) return false;
    justDragged = false;
    return true;
  };

  const showOverlay = (r: PxRect | undefined) => {
    if (!r) {
      setOverlayShown(false); // fades out where it is
      return;
    }
    if (!overlayShown()) {
      // Entering: appear in place (fade in), no slide from wherever it was last.
      setOverlaySnap(true);
      setOverlayRectPx(r);
      requestAnimationFrame(() => setOverlaySnap(false));
      setOverlayShown(true);
      return;
    }
    setOverlayRectPx(r); // between zones: animates position + size
  };

  const startDrag = (e: PointerEvent, key: string) => {
    const sx = e.clientX;
    const sy = e.clientY;
    const tabEl = e.currentTarget as HTMLElement;
    let started = false;
    let hits: GroupHit[] = [];
    let origin = { left: 0, top: 0 };
    let px = sx;
    let py = sy;
    let frame = 0;

    const update = () => {
      frame = 0;
      let target = hitTest(hits, px, py);
      if (target && isNoop(c().state.layout, key, target)) target = null;
      let overlay: PxRect | undefined;
      let line: DragState["line"];
      if (target?.kind === "zone") {
        const hit = hits.find((h) => h.id === target!.groupId)!;
        const r = overlayRect(hit.content, target.zone);
        overlay = { left: r.left - origin.left, top: r.top - origin.top, width: r.width, height: r.height };
      } else if (target?.kind === "bar") {
        const hit = hits.find((h) => h.id === target!.groupId)!;
        line = { x: insertionX(hit, target.index) - origin.left, top: hit.bar.top - origin.top, height: hit.bar.height };
      }
      showOverlay(overlay);
      setDrag({ key, x: px, y: py, target, overlay, line });
    };

    const move = (ev: PointerEvent) => {
      px = ev.clientX;
      py = ev.clientY;
      if (!started) {
        if (Math.hypot(px - sx, py - sy) < DRAG_THRESHOLD_PX) return;
        started = true;
        try {
          tabEl.setPointerCapture(ev.pointerId);
        } catch {
          // the element may be gone; window listeners still see the moves
        }
        const a = area.getBoundingClientRect();
        origin = { left: a.left, top: a.top };
        hits = [...area.querySelectorAll<HTMLElement>("[data-group-id]")].map((g) => ({
          id: g.dataset.groupId!,
          bar: rectOf(g.querySelector(".tab-bar")),
          content: rectOf(g.querySelector(".group-content")),
          tabs: [...g.querySelectorAll(".tab-bar .tab")].map(rectOf),
        }));
        document.body.classList.add("tab-dragging");
      }
      if (!frame) frame = requestAnimationFrame(update);
    };

    const finish = (apply: boolean) => {
      window.removeEventListener("pointermove", move);
      window.removeEventListener("pointerup", onUp);
      window.removeEventListener("pointercancel", onCancel);
      window.removeEventListener("keydown", onKey, true);
      if (frame) cancelAnimationFrame(frame);
      document.body.classList.remove("tab-dragging");
      if (!started) return;
      justDragged = true;
      if (apply) update(); // the drop uses the pointer's final position
      const d = drag();
      showOverlay(undefined);
      setDrag(undefined);
      if (apply && d?.target) c().drop(key, d.target);
    };
    const onUp = () => finish(true);
    const onCancel = () => finish(false);
    const onKey = (ev: KeyboardEvent) => {
      if (ev.key !== "Escape" || !started) return;
      ev.preventDefault();
      ev.stopPropagation();
      finish(false); // the release that follows must not click the tab: see justDragged
    };
    window.addEventListener("pointermove", move);
    window.addEventListener("pointerup", onUp);
    window.addEventListener("pointercancel", onCancel);
    window.addEventListener("keydown", onKey, true);
  };

  const ghostTab = () => {
    const d = drag();
    return d ? c().tabByKey(d.key) : undefined;
  };

  const px = (n: number) => `${n}px`;

  return (
    <div class="editor-groups" ref={area} classList={{ resizing: resizing() }}>
      <For each={ids()}>
        {(id) => (
          <EditorGroup controller={c()} groupId={id} rect={groupRect(id)} focused={c().state.layout.focusedGroupId === id}
            entering={enteringFor(id)} resizing={resizing()} renderTab={props.renderTab}
            onTabPointerDown={startDrag} draggingKey={drag()?.key} consumeClick={consumeClick} />
        )}
      </For>
      <For each={sashKeys()}>
        {(key) => (
          <Show when={sashOf(key)}>
            {(s) => <GroupSash sash={s()} controller={c()} area={() => area.getBoundingClientRect()} onResizing={setResizing} />}
          </Show>
        )}
      </For>
      {/* The drop preview: one rectangle that moves between zones. */}
      <div classList={{ "drop-overlay": true, shown: overlayShown(), snap: overlaySnap() }} aria-hidden="true"
        style={{
          left: px(overlayRectPx().left), top: px(overlayRectPx().top),
          width: px(overlayRectPx().width), height: px(overlayRectPx().height),
        }} />
      <Show when={drag()?.line}>
        {(l) => <div class="drop-line" aria-hidden="true" style={{ left: px(l().x - 1), top: px(l().top + 4), height: px(l().height - 8) }} />}
      </Show>
      <Show when={ghostTab()}>
        {(t) => (
          <Portal>
            <div class="tab-drag-ghost" aria-hidden="true" style={{ left: px(drag()!.x + 12), top: px(drag()!.y + 10) }}>
              <Show when={t().kind === "request"} fallback={<span class="env-chip"><Icon name="settings" size={12} /></span>}>
                <MethodBadge method={t().draft.method} />
              </Show>
              <span>{t().name || "Loading…"}</span>
            </div>
          </Portal>
        )}
      </Show>
    </div>
  );
}
