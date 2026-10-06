import { createSignal } from "solid-js";
import { SIDEBAR_DEFAULT } from "../layout";
import { applySidebarWidth, currentSidebarWidth } from "../uiPrefs";

// The drag handle on the sidebar's right edge. Dragging only rewrites the
// --sidebar-width CSS variable (no Solid state, no re-render of the tree), and the
// width is saved once on release. Double-click resets to the default.
export default function SidebarResizer() {
  const [dragging, setDragging] = createSignal(false);

  const onPointerDown = (e: PointerEvent) => {
    if (e.button !== 0) return;
    e.preventDefault(); // no text selection while dragging
    const el = e.currentTarget as HTMLElement;
    el.setPointerCapture(e.pointerId);
    const startX = e.clientX;
    const startWidth = currentSidebarWidth();
    let frame = 0;
    let lastX = startX;
    setDragging(true);
    document.documentElement.classList.add("resizing-sidebar");

    const move = (ev: PointerEvent) => {
      lastX = ev.clientX;
      if (frame) return;
      frame = requestAnimationFrame(() => {
        frame = 0;
        applySidebarWidth(startWidth + lastX - startX);
      });
    };
    const up = () => {
      el.removeEventListener("pointermove", move);
      el.removeEventListener("pointerup", up);
      el.removeEventListener("pointercancel", up);
      if (frame) cancelAnimationFrame(frame);
      setDragging(false);
      document.documentElement.classList.remove("resizing-sidebar");
      if (lastX !== startX) applySidebarWidth(startWidth + lastX - startX, true);
    };
    el.addEventListener("pointermove", move);
    el.addEventListener("pointerup", up);
    el.addEventListener("pointercancel", up);
  };

  return (
    <div classList={{ "sidebar-resizer": true, dragging: dragging() }} role="separator" aria-orientation="vertical"
      aria-label="Resize sidebar" title="Drag to resize · double-click to reset"
      onPointerDown={onPointerDown}
      onDblClick={() => applySidebarWidth(SIDEBAR_DEFAULT, true)} />
  );
}
