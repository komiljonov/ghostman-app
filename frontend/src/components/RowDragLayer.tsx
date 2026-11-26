import { Show } from "solid-js";
import { Portal } from "solid-js/web";
import type { RowDragView } from "../rowDrag";

interface Props {
  view: RowDragView | undefined;
}

// The overlay of a row drag (rowDrag.ts): the ghost under the pointer and the
// insertion line (absent for a no-op target). Fixed-positioned in a portal, so
// scroll containers and sticky headers never clip it.
export default function RowDragLayer(props: Props) {
  return (
    <Show when={props.view}>
      {(v) => (
        <Portal>
          <div class="tree-drag-ghost row-drag-ghost" aria-hidden="true"
            style={{ transform: `translate(${v().x + 14}px, ${v().y + 8}px)` }}>
            <span>{v().label}</span>
          </div>
          <Show when={v().line}>
            {(l) => (
              <div class="tree-drop-line" aria-hidden="true"
                style={{ top: `${l().y - 1}px`, left: `${l().left + 4}px`, width: `${Math.max(24, l().width - 8)}px` }} />
            )}
          </Show>
        </Portal>
      )}
    </Show>
  );
}
