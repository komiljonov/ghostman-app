import { JSX, onMount, Show } from "solid-js";
import type { Rect, Side } from "../layoutTree";
import { TabsController, TabState } from "../tabsController";
import TabBar from "./TabBar";

interface Props {
  controller: TabsController;
  groupId: string;
  rect: Rect; // fractions of the editor area
  focused: boolean;
  entering: Side | null; // a new group grows in from this side (split animation)
  resizing: boolean; // a sash is being dragged: no size transitions
  renderTab: (tab: TabState) => JSX.Element;
  onTabPointerDown: (e: PointerEvent, key: string) => void;
  draggingKey?: string;
  consumeClick: () => boolean;
}

const pct = (f: number) => `${f * 100}%`;

// One editor group: its tab bar and its own active editor. Groups are rendered
// FLAT and absolutely positioned from the layout's rects (EditorGroups), so a
// split or collapse only changes this element's position and size — its editor
// never re-mounts (only a tab that moves in or out does). Position and size
// changes animate (CSS, off with prefers-reduced-motion and while resizing).
export default function EditorGroup(props: Props) {
  let el!: HTMLDivElement;
  const group = () => props.controller.group(props.groupId);
  const active = () => {
    const key = group()?.activeTabId;
    return key ? props.controller.tabByKey(key) : undefined;
  };
  onMount(() => {
    if (!props.entering) return;
    // Grow in from the split side: start clipped to nothing, then reveal.
    el.classList.add(`group-enter-${props.entering}`);
    requestAnimationFrame(() => requestAnimationFrame(() => el.classList.remove(`group-enter-${props.entering}`)));
  });

  const style = (): JSX.CSSProperties => ({
    left: pct(props.rect.x), top: pct(props.rect.y), width: pct(props.rect.w), height: pct(props.rect.h),
  });

  return (
    <div ref={el} class="editor-group" classList={{ focused: props.focused, resizing: props.resizing }}
      data-group-id={props.groupId} style={style()}
      onPointerDown={() => props.controller.focusGroup(props.groupId)}
      onFocusIn={() => props.controller.focusGroup(props.groupId)}>
      <TabBar controller={props.controller} groupId={props.groupId} focused={props.focused}
        onTabPointerDown={props.onTabPointerDown} draggingKey={props.draggingKey} consumeClick={props.consumeClick} />
      <div class="group-content">
        <Show when={active()} keyed fallback={<div class="empty-pane"><p class="placeholder">Open a request from the sidebar.</p></div>}>
          {(tab) => props.renderTab(tab)}
        </Show>
      </div>
    </div>
  );
}
