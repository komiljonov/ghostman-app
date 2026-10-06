import { For, onCleanup, onMount, Show } from "solid-js";
import { Portal } from "solid-js/web";
import { menuPosition } from "../menuPosition";
import Icon, { IconName } from "./Icon";

export type MenuEntry =
  | {
    label: string;
    icon?: IconName;
    hint?: string; // keyboard shortcut, shown right-aligned
    danger?: boolean;
    disabled?: boolean;
    onSelect: () => void;
  }
  | "separator";

interface Props {
  x: number; // anchor (the pointer, or a trigger's corner), viewport px
  y: number;
  label: string;
  items: MenuEntry[];
  onClose: () => void;
}

// The one context menu of the app (tree rows, tabs). Top-left corner at the
// anchor, flipped on an axis where it would leave the window (menuPosition.ts).
// Dismissed by an outside press, Escape, scroll or resize; Up/Down move between
// items, Enter/click picks.
export default function ContextMenu(props: Props) {
  let menu!: HTMLDivElement;
  const buttons = () => [...menu.querySelectorAll<HTMLButtonElement>("button:not(:disabled)")];

  const outside = (e: PointerEvent) => {
    if (!menu.contains(e.target as Node)) props.onClose();
  };
  const onKey = (e: KeyboardEvent) => {
    // The open menu owns the keyboard. Solid's delegated events bubble out of a
    // Portal into its owner (e.g. the tree's keydown), so stop them here.
    e.stopPropagation();
    if (e.key === "Escape") {
      e.preventDefault();
      props.onClose();
    } else if (e.key === "ArrowDown" || e.key === "ArrowUp") {
      e.preventDefault();
      const list = buttons();
      const i = list.indexOf(document.activeElement as HTMLButtonElement);
      const next = i < 0
        ? (e.key === "ArrowDown" ? 0 : list.length - 1)
        : e.key === "ArrowDown" ? (i + 1) % list.length : (i - 1 + list.length) % list.length;
      list[next]?.focus();
    }
  };
  const dismiss = () => props.onClose();

  onMount(() => {
    const r = menu.getBoundingClientRect();
    const at = menuPosition({ x: props.x, y: props.y }, { width: r.width, height: r.height },
      { width: window.innerWidth, height: window.innerHeight });
    menu.style.left = `${at.x}px`;
    menu.style.top = `${at.y}px`;
    menu.style.visibility = "visible";
    // Focus the menu itself (keys work, nothing looks hovered); arrows enter the items.
    menu.focus({ preventScroll: true });
    document.addEventListener("pointerdown", outside, true);
    document.addEventListener("scroll", dismiss, true);
    window.addEventListener("resize", dismiss);
  });
  onCleanup(() => {
    document.removeEventListener("pointerdown", outside, true);
    document.removeEventListener("scroll", dismiss, true);
    window.removeEventListener("resize", dismiss);
  });

  return (
    <Portal>
      <div class="context-menu" role="menu" aria-label={props.label} ref={menu} tabIndex={-1} style={{ visibility: "hidden" }}
        onKeyDown={onKey} onContextMenu={(e) => e.preventDefault()}>
        <For each={props.items}>
          {(entry) => (
            <Show when={entry !== "separator" && entry} fallback={<div class="context-sep" role="separator" />}>
              {(item) => (
                <button type="button" role="menuitem" classList={{ "context-item": true, "context-danger": !!item().danger }}
                  disabled={item().disabled}
                  onClick={() => {
                    const pick = item().onSelect;
                    props.onClose();
                    pick();
                  }}>
                  <span class="context-icon">
                    <Show when={item().icon}>{(name) => <Icon name={name()} />}</Show>
                  </span>
                  <span class="context-label">{item().label}</span>
                  <Show when={item().hint}><kbd class="context-hint">{item().hint}</kbd></Show>
                </button>
              )}
            </Show>
          )}
        </For>
      </div>
    </Portal>
  );
}
