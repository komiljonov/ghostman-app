import { onCleanup, onMount } from "solid-js";
import { Portal } from "solid-js/web";
import { CloseMode } from "../tabModel";

interface Props {
  x: number;
  y: number;
  onPick: (mode: CloseMode) => void;
  onClose: () => void;
}

// Right-click menu for a tab, at the pointer. Same dismissal rules as the other
// menus: outside click, Escape, scroll, resize.
export default function TabContextMenu(props: Props) {
  let menu!: HTMLDivElement;
  const outside = (e: PointerEvent) => {
    if (!menu.contains(e.target as Node)) props.onClose();
  };
  const key = (e: KeyboardEvent) => e.key === "Escape" && props.onClose();
  const dismiss = () => props.onClose();
  onMount(() => {
    // Keep the menu inside the window.
    const r = menu.getBoundingClientRect();
    menu.style.left = `${Math.max(8, Math.min(props.x, innerWidth - r.width - 8))}px`;
    menu.style.top = `${Math.max(8, Math.min(props.y, innerHeight - r.height - 8))}px`;
    menu.style.visibility = "visible";
    document.addEventListener("pointerdown", outside, true);
    document.addEventListener("keydown", key);
    document.addEventListener("scroll", dismiss, true);
    window.addEventListener("resize", dismiss);
  });
  onCleanup(() => {
    document.removeEventListener("pointerdown", outside, true);
    document.removeEventListener("keydown", key);
    document.removeEventListener("scroll", dismiss, true);
    window.removeEventListener("resize", dismiss);
  });
  const item = (label: string, mode: CloseMode) => (
    <button type="button" role="menuitem" class="menu-item" onClick={() => {
      props.onPick(mode); // before onClose: closing unmounts the menu and its target
      props.onClose();
    }}>{label}</button>
  );
  return (
    <Portal>
      <div class="dropdown-menu tab-menu" role="menu" ref={menu} style={{ visibility: "hidden" }}>
        {item("Close", "close")}
        {item("Close Others", "others")}
        {item("Close All", "all")}
      </div>
    </Portal>
  );
}
