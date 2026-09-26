import { createSignal, JSX, onCleanup, Show } from "solid-js";

interface Props {
  trigger: JSX.Element;
  triggerLabel: string;
  triggerClass?: string;
  align?: "left" | "right";
  disabled?: boolean;
  onOpen?: () => void;
  // Render prop: receives `close` so menu items can dismiss the dropdown.
  children: (close: () => void) => JSX.Element;
}

// A top-bar dropdown. Closes on outside click and on Escape.
export default function Dropdown(props: Props) {
  const [open, setOpen] = createSignal(false);
  let root!: HTMLDivElement;

  const close = () => setOpen(false);
  const toggle = () => {
    if (props.disabled) return;
    const next = !open();
    setOpen(next);
    if (next) props.onOpen?.();
  };

  const onPointerDown = (e: PointerEvent) => {
    if (open() && !root.contains(e.target as Node)) close();
  };
  const onKeyDown = (e: KeyboardEvent) => {
    if (open() && e.key === "Escape") close();
  };
  document.addEventListener("pointerdown", onPointerDown);
  document.addEventListener("keydown", onKeyDown);
  onCleanup(() => {
    document.removeEventListener("pointerdown", onPointerDown);
    document.removeEventListener("keydown", onKeyDown);
  });

  return (
    <div class="dropdown" ref={root}>
      <button type="button" class={props.triggerClass ?? "dropdown-trigger"} aria-haspopup="menu"
        aria-expanded={open()} aria-label={props.triggerLabel} disabled={props.disabled} onClick={toggle}>
        {props.trigger}
      </button>
      <Show when={open()}>
        <div classList={{ "dropdown-menu": true, right: props.align === "right" }} role="menu">
          {props.children(close)}
        </div>
      </Show>
    </div>
  );
}
