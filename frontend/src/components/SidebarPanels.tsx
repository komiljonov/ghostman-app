import { createEffect, createMemo, createSignal, on, onCleanup, onMount, Show } from "solid-js";
import { GetSidebarPanels, SetSidebarPanels } from "../../wailsjs/go/main/App";
import { main } from "../../wailsjs/go/models";
import { anyExpanded, areaHeight, DEFAULT_PANELS, expandSection, normalizePanels, PanelState, Section, toggleSection } from "../sidebarPanels";
import { clampPanel, PANEL_DEFAULT_FRACTION, panelFraction } from "../webhookModel";
import ProxiesSection from "./ProxiesSection";
import WebhooksSection from "./WebhooksSection";

interface Props {
  projectId: string;
  refreshTick: number;
  onOpenWebhook: (id: string, name: string) => void;
  onOpenProxy: (id: string, name: string) => void;
  isOpen: (key: string) => boolean; // a tab with this key is open ("webhook:<id>", "proxy:<id>")
}

// The sidebar's bottom area (rules: sidebarPanels.ts): collapsible sections in a
// fixed order — Webhooks, then Proxies — each one bar tall, independently
// expandable; expanded sections share the area equally. While any is expanded the
// area has the stored height and a drag divider on its top edge (tree ≥ 160 px,
// area ≥ 120 px; double-click → 30 %); the divider rewrites only this element's
// height while dragging and saves once on release. Everything persists per
// project (GetSidebarPanels / SetSidebarPanels).
export default function SidebarPanels(props: Props) {
  const [state, setState] = createSignal<PanelState>(DEFAULT_PANELS);
  const [total, setTotal] = createSignal(0); // the sidebar's height
  let areaEl!: HTMLDivElement;

  const projectId = createMemo(() => props.projectId);
  createEffect(on(projectId, async (id) => {
    const prefs = normalizePanels(await GetSidebarPanels(id));
    if (id === props.projectId) setState(prefs);
  }));

  onMount(() => {
    const stack = areaEl.parentElement!;
    const ro = new ResizeObserver(() => setTotal(stack.clientHeight));
    ro.observe(stack);
    setTotal(stack.clientHeight);
    onCleanup(() => ro.disconnect());
  });

  const save = (next: PanelState) => {
    setState(next);
    void SetSidebarPanels(props.projectId, main.SidebarPanelPrefs.createFrom(next));
  };
  const toggle = (s: Section) => save(toggleSection(state(), s));
  const expand = (s: Section) => {
    const next = expandSection(state(), s);
    if (next !== state()) save(next);
  };
  const height = () => areaHeight(state(), total());

  const onResizeStart = (e: PointerEvent) => {
    if (e.button !== 0) return;
    e.preventDefault();
    const handle = e.currentTarget as HTMLElement;
    handle.setPointerCapture(e.pointerId);
    const startY = e.clientY;
    const startH = areaEl.getBoundingClientRect().height;
    const all = total();
    let lastY = startY;
    let frame = 0;
    document.documentElement.classList.add("resizing-hooks");
    const px = () => clampPanel(startH + startY - lastY, all);
    const move = (ev: PointerEvent) => {
      lastY = ev.clientY;
      if (frame) return;
      frame = requestAnimationFrame(() => {
        frame = 0;
        areaEl.style.height = `${px()}px`;
      });
    };
    const up = () => {
      handle.removeEventListener("pointermove", move);
      handle.removeEventListener("pointerup", up);
      handle.removeEventListener("pointercancel", up);
      if (frame) cancelAnimationFrame(frame);
      document.documentElement.classList.remove("resizing-hooks");
      if (lastY === startY) return;
      save({ ...state(), fraction: panelFraction(px(), all) });
      areaEl.style.height = `${height()}px`;
    };
    handle.addEventListener("pointermove", move);
    handle.addEventListener("pointerup", up);
    handle.addEventListener("pointercancel", up);
  };
  const resetHeight = () => {
    save({ ...state(), fraction: PANEL_DEFAULT_FRACTION });
    areaEl.style.height = `${height()}px`;
  };

  return (
    <div ref={areaEl} classList={{ "sidebar-panels": true, expanded: anyExpanded(state()) }}
      style={height() !== undefined ? { height: `${height()}px` } : { height: "auto" }}>
      <Show when={anyExpanded(state())}>
        <div class="hooks-resizer" role="separator" aria-orientation="horizontal" aria-label="Resize the sidebar panels"
          title="Drag to resize · double-click to reset" onPointerDown={onResizeStart} onDblClick={resetHeight} />
      </Show>
      <WebhooksSection projectId={props.projectId} refreshTick={props.refreshTick} onOpen={props.onOpenWebhook}
        isOpen={(id) => props.isOpen(`webhook:${id}`)}
        expanded={state().webhooks} onToggle={() => toggle("webhooks")} onExpand={() => expand("webhooks")} />
      <ProxiesSection projectId={props.projectId} onOpen={props.onOpenProxy}
        isOpen={(id) => props.isOpen(`proxy:${id}`)}
        expanded={state().proxies} onToggle={() => toggle("proxies")} onExpand={() => expand("proxies")} />
    </div>
  );
}
