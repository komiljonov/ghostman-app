import { Index } from "solid-js";
import { editRow, isGhost, newRow, removeRow, Row, toggleRow } from "../rows";
import VarCell from "./VarCell";

interface Props {
  rows: Row[];
  onChange: (rows: Row[]) => void;
  keyPlaceholder?: string;
  valuePlaceholder?: string;
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
                  <VarCell value={row().key} placeholder={props.keyPlaceholder ?? "Key"} ariaLabel={props.keyPlaceholder ?? "Key"}
                    onChange={(text) => props.onChange(editRow(props.rows, i, { key: text }))} />
                </td>
                <td>
                  <VarCell value={row().value} placeholder={props.valuePlaceholder ?? "Value"} ariaLabel={props.valuePlaceholder ?? "Value"}
                    onChange={(text) => props.onChange(editRow(props.rows, i, { value: text }))} />
                </td>
                <td class="kv-remove">
                  <button type="button" class="icon-button" title="Remove row" aria-label="Remove row"
                    disabled={ghost()} onClick={() => props.onChange(removeRow(props.rows, i))}>×</button>
                </td>
              </tr>
            );
          }}
        </Index>
      </tbody>
    </table>
  );
}
