import { createSignal, For, Match, Show, Switch } from "solid-js";
import { dropSlot } from "../tabModel";
import { TabsController, TabState } from "../tabsController";
import MethodBadge from "./MethodBadge";
import TabContextMenu from "./TabContextMenu";

interface Props {
  controller: TabsController;
}

const DRAG_THRESHOLD_PX = 5;

// Open tabs (requests, environments, the environment list). Click activates,
// middle-click or × closes, and tabs reorder by dragging within the bar (pointer
// events; a press only becomes a drag after moving 5 px, so clicks stay clicks).
export default function TabBar(props: Props) {
  let bar!: HTMLDivElement;
  const [drag, setDrag] = createSignal<{ key: string; from: number; dx: number; slot: number }>();
  let suppressClick = false;
  const [menu, setMenu] = createSignal<{ key: string; x: number; y: number }>();

  const tabElements = () => [...bar.querySelectorAll<HTMLElement>(".tab")];

  const onPointerDown = (e: PointerEvent, tab: TabState, index: number) => {
    if (e.button !== 0 || (e.target as HTMLElement).closest(".tab-close")) return;
    const startX = e.clientX;
    const el = e.currentTarget as HTMLElement;
    const start = el.getBoundingClientRect();
    const bounds = bar.getBoundingClientRect();
    let dragging = false;

    const move = (ev: PointerEvent) => {
      // The ghost stays inside the bar (tabs cannot be dragged out of it).
      const dx = Math.max(bounds.left - start.left, Math.min(ev.clientX - startX, bounds.right - start.right));
      if (!dragging && Math.abs(ev.clientX - startX) < DRAG_THRESHOLD_PX) return;
      if (!dragging) {
        dragging = true;
        el.setPointerCapture(ev.pointerId);
      }
      const rects = tabElements().map((t) => t.getBoundingClientRect());
      setDrag({ key: tab.key, from: index, dx, slot: dropSlot(ev.clientX, rects) });
    };
    const up = () => {
      window.removeEventListener("pointermove", move);
      window.removeEventListener("pointerup", up);
      window.removeEventListener("pointercancel", up);
      const d = drag();
      setDrag(undefined);
      if (dragging && d) {
        // The click that may follow a drag (same event turn) is not an activation.
        // With pointer capture it does not always fire, so clear the flag right after,
        // or it would swallow the next real click.
        suppressClick = true;
        setTimeout(() => (suppressClick = false), 0);
        props.controller.moveTab(d.from, d.slot);
      }
    };
    window.addEventListener("pointermove", move);
    window.addEventListener("pointerup", up);
    window.addEventListener("pointercancel", up);
  };

  // Where the drop indicator goes: before tab `slot`, or after the last tab.
  const indicatorAt = (index: number) => {
    const d = drag();
    if (!d || d.slot === d.from || d.slot === d.from + 1) return false;
    return d.slot === index;
  };
  const indicatorAtEnd = () => {
    const d = drag();
    return !!d && d.slot === props.controller.state.tabs.length && d.from !== d.slot - 1;
  };

  return (
    <div class="tab-bar" role="tablist" aria-label="Open tabs" ref={bar}>
      <For each={props.controller.state.tabs}>
        {(tab, i) => (
          <div role="tab" aria-selected={props.controller.state.activeKey === tab.key} tabIndex={0}
            classList={{
              tab: true,
              active: props.controller.state.activeKey === tab.key,
              dragging: drag()?.key === tab.key,
              "drop-before": indicatorAt(i()),
              "env-tab": tab.kind !== "request",
            }}
            style={drag()?.key === tab.key ? { transform: `translateX(${drag()!.dx}px)` } : undefined}
            title={tab.name}
            onPointerDown={(e) => onPointerDown(e, tab, i())}
            onClick={() => {
              if (suppressClick) {
                suppressClick = false;
                return;
              }
              props.controller.activate(tab.key);
            }}
            onMouseDown={(e) => e.button === 1 && e.preventDefault()}
            onContextMenu={(e) => {
              e.preventDefault();
              setMenu({ key: tab.key, x: e.clientX, y: e.clientY });
            }}
            onAuxClick={(e) => {
              if (e.button === 1) void props.controller.close(tab.key);
            }}>
            <Switch>
              <Match when={tab.kind === "request"}>
                <Show when={tab.status === "ready"} fallback={<span class="method-badge muted">…</span>}>
                  <MethodBadge method={tab.draft.method} />
                </Show>
              </Match>
              <Match when={tab.kind === "env"}>
                <span class="env-chip">ENV</span>
              </Match>
              <Match when={tab.kind === "env_list"}>
                <span class="env-chip">⚙</span>
              </Match>
            </Switch>
            <span class="tab-name">{tab.name || "Loading…"}</span>
            <Show when={tab.save === "error"}><span class="tab-unsaved" title="Not saved">●</span></Show>
            <button type="button" class="tab-close" aria-label={`Close ${tab.name}`}
              onClick={(e) => {
                e.stopPropagation();
                void props.controller.close(tab.key);
              }}>×</button>
          </div>
        )}
      </For>
      <Show when={indicatorAtEnd()}><div class="drop-end" aria-hidden="true" /></Show>
      <Show when={menu()}>
        {(m) => (
          <TabContextMenu x={m().x} y={m().y} onClose={() => setMenu(undefined)}
            onPick={(mode) => void props.controller.closeMany(m().key, mode)} />
        )}
      </Show>
    </div>
  );
}
