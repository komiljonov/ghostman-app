import { createEffect, createSignal, JSX, onCleanup, Show } from "solid-js";
import { Portal } from "solid-js/web";

interface Props {
  trigger: JSX.Element;
  triggerLabel: string;
  triggerClass?: string;
  align?: "left" | "right";
  disabled?: boolean;
  onOpen?: () => void;
  // Controlled mode (e.g. a tree row opening its menu on right-click).
  open?: boolean;
  onOpenChange?: (open: boolean) => void;
  // Render prop: receives `close` so menu items can dismiss the dropdown.
  children: (close: () => void) => JSX.Element;
}

const GAP = 4; // px between trigger and menu
const MARGIN = 8; // px kept free at the viewport edges

// A dropdown menu. The menu is rendered in a portal with fixed positioning, so
// scroll/overflow containers (the sidebar, the main pane) can never clip it; it
// flips above the trigger when there is no room below and is kept inside the
// viewport. Closes on outside click, Escape, window resize and outside scroll.
export default function Dropdown(props: Props) {
  const [internalOpen, setInternalOpen] = createSignal(false);
  const open = () => props.open ?? internalOpen();
  const setOpen = (v: boolean) => {
    setInternalOpen(v);
    props.onOpenChange?.(v);
  };
  const [pos, setPos] = createSignal<JSX.CSSProperties>({ visibility: "hidden" });
  let trigger!: HTMLButtonElement;
  let menu: HTMLDivElement | undefined;

  const close = () => setOpen(false);
  const toggle = () => {
    if (props.disabled) return;
    const next = !open();
    setOpen(next);
    if (next) props.onOpen?.();
  };

  // Measure after the menu is in the DOM, then place it next to the trigger.
  const place = () => {
    if (!menu) return;
    const t = trigger.getBoundingClientRect();
    const m = menu.getBoundingClientRect();
    const vw = window.innerWidth;
    const vh = window.innerHeight;

    let left = props.align === "right" ? t.right - m.width : t.left;
    left = Math.max(MARGIN, Math.min(left, vw - m.width - MARGIN));

    const below = vh - t.bottom - GAP - MARGIN;
    const above = t.top - GAP - MARGIN;
    const style: JSX.CSSProperties = { left: `${left}px`, visibility: "visible" };
    if (m.height <= below || below >= above) {
      style.top = `${t.bottom + GAP}px`;
      style["max-height"] = `${below}px`;
    } else {
      style.top = `${Math.max(MARGIN, t.top - GAP - Math.min(m.height, above))}px`;
      style["max-height"] = `${above}px`;
    }
    setPos(style);
  };

  const inside = (target: EventTarget | null) =>
    target instanceof Node && (trigger.contains(target) || !!menu?.contains(target));
  const onPointerDown = (e: PointerEvent) => {
    if (!inside(e.target)) close();
  };
  const onKeyDown = (e: KeyboardEvent) => {
    if (e.key === "Escape") close();
  };
  // A fixed menu would drift away from its trigger when something scrolls.
  const onScroll = (e: Event) => {
    if (!menu?.contains(e.target as Node)) close();
  };

  // Listen only while open: every tree row has a menu, so always-on listeners would scale with the tree.
  createEffect(() => {
    if (!open()) {
      setPos({ visibility: "hidden" });
      return;
    }
    document.addEventListener("pointerdown", onPointerDown);
    document.addEventListener("keydown", onKeyDown);
    document.addEventListener("scroll", onScroll, true);
    window.addEventListener("resize", close);
    requestAnimationFrame(place);
    onCleanup(() => {
      document.removeEventListener("pointerdown", onPointerDown);
      document.removeEventListener("keydown", onKeyDown);
      document.removeEventListener("scroll", onScroll, true);
      window.removeEventListener("resize", close);
    });
  });

  return (
    <div class="dropdown">
      <button type="button" ref={trigger} class={props.triggerClass ?? "dropdown-trigger"} aria-haspopup="menu"
        aria-expanded={open()} aria-label={props.triggerLabel} disabled={props.disabled} onClick={toggle}>
        {props.trigger}
      </button>
      <Show when={open()}>
        <Portal>
          <div class="dropdown-menu" role="menu" ref={menu} style={pos()}>
            {props.children(close)}
          </div>
        </Portal>
      </Show>
    </div>
  );
}
