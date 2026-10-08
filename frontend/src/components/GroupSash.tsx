import type { JSX } from "solid-js";
import { findSplit, minFractions, SashRect } from "../layoutTree";
import { TabsController } from "../tabsController";

interface Props {
  sash: SashRect;
  controller: TabsController;
  area: () => DOMRect; // the editor area's current size, px
  onResizing: (on: boolean) => void;
}

const pct = (f: number) => `${f * 100}%`;

// The draggable boundary between two siblings of a split. Dragging moves it
// (minimum group size enforced by layoutTree.resize); double-click resets the
// split to equal sizes. A horizontal split has a vertical sash line.
export default function GroupSash(props: Props) {
  const vertical = () => props.sash.direction === "horizontal";

  const onPointerDown = (e: PointerEvent) => {
    if (e.button !== 0) return;
    e.preventDefault();
    const el = e.currentTarget as HTMLElement;
    el.setPointerCapture(e.pointerId);
    const area = props.area();
    const length = vertical() ? props.sash.split.w * area.width : props.sash.split.h * area.height;
    let last = vertical() ? e.clientX : e.clientY;
    props.onResizing(true);
    const move = (ev: PointerEvent) => {
      const pos = vertical() ? ev.clientX : ev.clientY;
      const d = pos - last;
      if (d === 0) return;
      const split = findSplit(props.controller.state.layout.root, props.sash.splitId);
      if (!split) return;
      const before = split.sizes[props.sash.index];
      props.controller.resize(props.sash.splitId, props.sash.index, d / length, minFractions(split, length));
      const after = findSplit(props.controller.state.layout.root, props.sash.splitId)?.sizes[props.sash.index] ?? before;
      last += (after - before) * length; // a clamped move does not run away from the pointer
    };
    const up = () => {
      el.removeEventListener("pointermove", move);
      el.removeEventListener("pointerup", up);
      el.removeEventListener("pointercancel", up);
      props.onResizing(false);
    };
    el.addEventListener("pointermove", move);
    el.addEventListener("pointerup", up);
    el.addEventListener("pointercancel", up);
  };

  const style = (): JSX.CSSProperties => vertical()
    ? { left: pct(props.sash.x), top: pct(props.sash.y), height: pct(props.sash.h) }
    : { left: pct(props.sash.x), top: pct(props.sash.y), width: pct(props.sash.w) };

  return (
    <div classList={{ "group-sash": true, vertical: vertical(), horizontal: !vertical() }} style={style()}
      role="separator" aria-orientation={vertical() ? "vertical" : "horizontal"} aria-label="Resize editor groups"
      title="Drag to resize · double-click to reset"
      onPointerDown={onPointerDown}
      onDblClick={() => props.controller.resetSizes(props.sash.splitId)} />
  );
}
