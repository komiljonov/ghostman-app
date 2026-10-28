import { Index, Show } from "solid-js";
import { editRow, isGhost, newRow, removeRow, Row, toggleRow } from "../rows";
import VarCell from "./VarCell";
import Icon from "./Icon";

interface Props {
  rows: Row[];
  onChange: (rows: Row[]) => void;
  keyPlaceholder?: string;
  valuePlaceholder?: string;
  plain?: boolean; // plain inputs instead of VarCells (no {{var}} machinery)
}

const GHOST = newRow();

// Editable key/value rows (headers, query params, form fields) with a trailing
// empty row that becomes real as soon as you type into it. <Index> keeps each
// row's cells in place while typing, so focus and caret never jump. Cells are
// VarCells: {{var}} highlighting + hover, with a CodeMirror editor mounted lazily.
export default function KeyValueTable(props: Props) {
  const items = () => [...props.rows, GHOST];

  return (
    <table class="kv-table">
      <thead>
        <tr><th class="kv-check" /><th>Key</th><th>Value</th><th class="kv-remove" /></tr>
      </thead>
      <tbody>
        <Index each={items()}>
          {(row, i) => {
            const ghost = () => isGhost(props.rows, i);
            return (
              <tr classList={{ ghost: ghost(), disabled: !ghost() && !row().enabled }}>
                <td class="kv-check">
                  <input type="checkbox" aria-label="Enabled" checked={ghost() || row().enabled} disabled={ghost()}
                    onChange={() => props.onChange(toggleRow(props.rows, i))} />
                </td>
                <td>
                  <Show when={props.plain} fallback={
                    <VarCell value={row().key} placeholder={props.keyPlaceholder ?? "Key"} ariaLabel={props.keyPlaceholder ?? "Key"}
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
                      onChange={(text) => props.onChange(editRow(props.rows, i, { value: text }))} />
                  }>
                    <input class="kv-plain" type="text" spellcheck={false} value={row().value}
                      placeholder={props.valuePlaceholder ?? "Value"} aria-label={props.valuePlaceholder ?? "Value"}
                      onInput={(e) => props.onChange(editRow(props.rows, i, { value: e.currentTarget.value }))} />
                  </Show>
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
  );
}
