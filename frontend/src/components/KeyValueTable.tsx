import type { CompletionSource } from "@codemirror/autocomplete";
import { Index, JSX, Show } from "solid-js";
import { createRowDrag } from "../rowDrag";
import { reorderByIndex } from "../rowOrder";
import { editRow, isGhost, newRow, removeRow, Row, toggleRow } from "../rows";
import VarCell from "./VarCell";
import Icon from "./Icon";
import RowDragLayer from "./RowDragLayer";

interface Props {
  rows: Row[];
  onChange: (rows: Row[]) => void;
  keyPlaceholder?: string;
  valuePlaceholder?: string;
  plain?: boolean; // plain inputs instead of VarCells (no {{var}} machinery)
  // Headers only (KeyValueEditor kind "headers"): extra completion in KEY cells
  // (header names), in VALUE cells given the row's key (mime types for Content-Type),
  // a key committed (cell left with a key: the recent-keys list), and something
  // after a row's value (the "use the Auth tab" hint).
  keyCompletions?: CompletionSource[];
  valueCompletions?: (key: () => string) => CompletionSource[];
  onKeyCommit?: (key: string) => void;
  rowAside?: (row: () => Row, index: number) => JSX.Element;
}

const GHOST = newRow();

// Editable key/value rows (headers, query params, form fields) with a trailing
// empty row that becomes real as soon as you type into it. <Index> keeps each
// row's cells in place while typing, so focus and caret never jump. Cells are
// VarCells: {{var}} highlighting + hover, with a CodeMirror editor mounted lazily.
// Rows reorder by dragging their grip (handle-only: the cells are editors, so
// selecting text never starts a drag); a drop is an ordinary edit (autosave).
export default function KeyValueTable(props: Props) {
  const items = () => [...props.rows, GHOST];
  let body: HTMLTableSectionElement | undefined;
  const drag = createRowDrag({
    list: () => body,
    handle: ".drag-handle:not(.off)",
    label: (id) => props.rows[Number(id)]?.key || "(no key)",
    onDrop: (order) => props.onChange(reorderByIndex(props.rows, order)),
  });

  return (
    <>
      <RowDragLayer view={drag.view()} />
      <table class="kv-table">
        <thead>
          <tr><th class="kv-drag" /><th class="kv-check" /><th>Key</th><th>Value</th><th class="kv-remove" /></tr>
        </thead>
        <tbody ref={body} onPointerDown={drag.onPointerDown}>
          <Index each={items()}>
            {(row, i) => {
              const ghost = () => isGhost(props.rows, i);
              return (
                <tr classList={{ ghost: ghost(), disabled: !ghost() && !row().enabled, "drag-source": drag.isDragging(String(i)) }}
                  data-drag-id={ghost() ? undefined : String(i)}>
                  <td class="kv-drag">
                    <span classList={{ "drag-handle": true, off: ghost() }} title={ghost() ? undefined : "Drag to reorder"} aria-hidden="true">
                      <Icon name="grip" />
                    </span>
                  </td>
                  <td class="kv-check">
                    <input type="checkbox" aria-label="Enabled" checked={ghost() || row().enabled} disabled={ghost()}
                      onChange={() => props.onChange(toggleRow(props.rows, i))} />
                  </td>
                  <td onFocusOut={(e) => {
                    // Leaving the key cell with a key commits it (the recent header keys).
                    if (e.currentTarget.contains(e.relatedTarget as Node | null)) return;
                    if (!ghost() && row().key.trim()) props.onKeyCommit?.(row().key);
                  }}>
                    <Show when={props.plain} fallback={
                      <VarCell value={row().key} placeholder={props.keyPlaceholder ?? "Key"} ariaLabel={props.keyPlaceholder ?? "Key"}
                        completions={props.keyCompletions}
                        onChange={(text) => props.onChange(editRow(props.rows, i, { key: text }))} />
                    }>
                      <input class="kv-plain" type="text" spellcheck={false} value={row().key}
                        placeholder={props.keyPlaceholder ?? "Key"} aria-label={props.keyPlaceholder ?? "Key"}
                        onInput={(e) => props.onChange(editRow(props.rows, i, { key: e.currentTarget.value }))} />
                    </Show>
                  </td>
                  <td>
                    <Show when={props.plain} fallback={
                      <VarCell value={row().value} placeholder={props.valuePlaceholder ?? "Value"} ariaLabel={props.valuePlaceholder ?? "Value"}
                        completions={props.valueCompletions?.(() => row().key)}
                        onChange={(text) => props.onChange(editRow(props.rows, i, { value: text }))} />
                    }>
                      <input class="kv-plain" type="text" spellcheck={false} value={row().value}
                        placeholder={props.valuePlaceholder ?? "Value"} aria-label={props.valuePlaceholder ?? "Value"}
                        onInput={(e) => props.onChange(editRow(props.rows, i, { value: e.currentTarget.value }))} />
                    </Show>
                    <Show when={!ghost() && props.rowAside}>{(aside) => aside()(row, i)}</Show>
                  </td>
                  <td class="kv-remove">
                    <button type="button" class="icon-button" title="Remove row" aria-label="Remove row"
                      disabled={ghost()} onClick={() => props.onChange(removeRow(props.rows, i))}><Icon name="close" size={14} /></button>
                  </td>
                </tr>
              );
            }}
          </Index>
        </tbody>
      </table>
    </>
  );
}
