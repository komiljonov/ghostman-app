import { Index } from "solid-js";
import { editRow, isGhost, newRow, removeRow, Row, toggleRow } from "../rows";

interface Props {
  rows: Row[];
  onChange: (rows: Row[]) => void;
  keyPlaceholder?: string;
  valuePlaceholder?: string;
}

const GHOST = newRow();

// Editable key/value rows (headers, query params, form fields) with a trailing
// empty row that becomes real as soon as you type into it. <Index> keeps each
// row's inputs in place while typing, so focus and caret never jump.
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
                  <input type="text" spellcheck={false} placeholder={props.keyPlaceholder ?? "Key"} value={row().key}
                    onInput={(e) => props.onChange(editRow(props.rows, i, { key: e.currentTarget.value }))} />
                </td>
                <td>
                  <input type="text" spellcheck={false} placeholder={props.valuePlaceholder ?? "Value"} value={row().value}
                    onInput={(e) => props.onChange(editRow(props.rows, i, { value: e.currentTarget.value }))} />
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
