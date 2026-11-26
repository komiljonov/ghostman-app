import { Index } from "solid-js";
import type { PathParam } from "../urlParams";
import VarCell from "./VarCell";

interface Props {
  rows: PathParam[];
  onChange: (rows: PathParam[]) => void;
}

// The Params tab's "Path variables" section: one row per ":key" in the URL
// (urlParams.ts reconciles them). The key is read-only (it IS the URL text); the
// value is a VarCell ({{var}} highlight, hover, completion). No checkbox, no
// add / remove / reorder: rows exist exactly while the URL names them.
export default function PathVarsTable(props: Props) {
  const setValue = (i: number, value: string) =>
    props.onChange(props.rows.map((r, j) => (j === i ? { ...r, value } : r)));
  return (
    <section class="path-vars" aria-label="Path variables">
      <h4 class="params-heading">Path variables</h4>
      <table class="kv-table path-vars-table">
        <thead>
          {/* Empty grip / checkbox / remove columns keep the keys aligned with the query table's. */}
          <tr><th class="kv-drag" /><th class="kv-check" /><th>Key</th><th>Value</th><th class="kv-remove" /></tr>
        </thead>
        <tbody>
          <Index each={props.rows}>
            {(row, i) => (
              <tr>
                <td class="kv-drag" /><td class="kv-check" />
                <td class="path-var-key" title="From the URL — edit the URL to rename or remove">
                  <span class="path-var-token">:{row().key}</span>
                </td>
                <td>
                  <VarCell value={row().value} placeholder="Value (required)" ariaLabel={`Value of :${row().key}`}
                    onChange={(text) => setValue(i, text)} />
                </td>
                <td class="kv-remove" />
              </tr>
            )}
          </Index>
        </tbody>
      </table>
    </section>
  );
}
