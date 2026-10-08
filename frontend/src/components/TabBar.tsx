import { createSignal, For, Match, Show, Switch } from "solid-js";
import { CloseMode } from "../tabModel";
import { TabsController } from "../tabsController";
import MethodBadge from "./MethodBadge";
import ContextMenu, { MenuEntry } from "./ContextMenu";
import Icon from "./Icon";

interface Props {
  controller: TabsController;
  groupId: string;
  focused: boolean;
  // A press on a tab: EditorGroups turns it into a drag after 5 px (clicks stay clicks).
  onTabPointerDown: (e: PointerEvent, key: string) => void;
  draggingKey?: string;
  consumeClick: () => boolean; // true right after a drag ended: that click is not an activation
}

// One editor group's tabs (requests, environments, the environment list, History).
// Click activates, middle-click or × closes; dragging (reorder, move to another
// group, split) is handled by EditorGroups. Right-click: Close / Close Others /
// Close All (this group), Split Right / Split Down, Move to Group N.
export default function TabBar(props: Props) {
  const [menu, setMenu] = createSignal<{ key: string; x: number; y: number }>();
  const group = () => props.controller.group(props.groupId);
  const keys = () => group()?.tabs ?? [];

  // Values captured now: the menu closes (and its accessor dies) before the pick runs.
  const menuItems = (key: string): MenuEntry[] => {
    const c = props.controller;
    const close = (mode: CloseMode) => () => void c.closeMany(key, mode);
    const groups = c.groups();
    const others = groups.map((g, i) => ({ g, n: i + 1 })).filter(({ g }) => g.id !== props.groupId);
    return [
      { label: "Close", icon: "close", hint: "Ctrl+W", onSelect: close("close") },
      { label: "Close Others", onSelect: close("others"), disabled: keys().length < 2 },
      { label: "Close All", onSelect: close("all") },
      "separator",
      { label: "Split Right", hint: "Ctrl+\\", onSelect: () => c.split(key, "right") },
      { label: "Split Down", onSelect: () => c.split(key, "bottom") },
      ...(others.length > 0 ? ["separator" as const] : []),
      ...others.map(({ g, n }): MenuEntry => ({ label: `Move to Group ${n}`, onSelect: () => c.moveToGroup(key, g.id) })),
    ];
  };

  return (
    <div classList={{ "tab-bar": true, focused: props.focused }} role="tablist" aria-label="Open tabs">
      <For each={keys()}>
        {(key) => {
          const tab = () => props.controller.tabByKey(key);
          return (
            <Show when={tab()}>
              {(t) => (
                <div role="tab" aria-selected={group()?.activeTabId === key} tabIndex={0}
                  classList={{
                    tab: true,
                    active: group()?.activeTabId === key,
                    dragging: props.draggingKey === key,
                    "env-tab": t().kind !== "request",
                  }}
                  title={t().name}
                  onPointerDown={(e) => {
                    if (e.button !== 0 || (e.target as HTMLElement).closest(".tab-close")) return;
                    props.onTabPointerDown(e, key);
                  }}
                  onClick={() => {
                    if (props.consumeClick()) return;
                    props.controller.activate(key);
                  }}
                  onMouseDown={(e) => e.button === 1 && e.preventDefault()}
                  onContextMenu={(e) => {
                    e.preventDefault();
                    setMenu({ key, x: e.clientX, y: e.clientY });
                  }}
                  onAuxClick={(e) => {
                    if (e.button === 1) void props.controller.close(key);
                  }}>
                  <Switch>
                    <Match when={t().kind === "request"}>
                      <Show when={t().status === "ready"} fallback={<span class="method-badge muted">…</span>}>
                        <MethodBadge method={t().draft.method} />
                      </Show>
                    </Match>
                    <Match when={t().kind === "env"}>
                      <span class="env-chip">ENV</span>
                    </Match>
                    <Match when={t().kind === "env_list"}>
                      <span class="env-chip"><Icon name="settings" size={12} /></span>
                    </Match>
                    <Match when={t().kind === "history"}>
                      <span class="env-chip"><Icon name="history" size={12} /></span>
                    </Match>
                  </Switch>
                  <span class="tab-name">{t().name || "Loading…"}</span>
                  <Show when={t().save === "error"}><span class="tab-unsaved" title="Not saved">●</span></Show>
                  <button type="button" class="tab-close" aria-label={`Close ${t().name}`}
                    onClick={(e) => {
                      e.stopPropagation();
                      void props.controller.close(key);
                    }}><Icon name="close" size={14} /></button>
                </div>
              )}
            </Show>
          );
        }}
      </For>
      <Show when={menu()}>
        {(m) => (
          <ContextMenu x={m().x} y={m().y} label="Tab actions" onClose={() => setMenu(undefined)}
            items={menuItems(m().key)} />
        )}
      </Show>
    </div>
  );
}
