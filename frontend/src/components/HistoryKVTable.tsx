import { For } from "solid-js";

interface Props {
  rows: { key: string; value: string; off: boolean }[];
}

// Read-only key/value rows of a history entry (headers, params); disabled rows muted.
export default function HistoryKVTable(props: Props) {
  return (
    <table class="history-kv">
      <tbody>
        <For each={props.rows}>
          {(r) => (
            <tr classList={{ off: r.off }} title={r.off ? "Disabled (not sent)" : undefined}>
              <td class="history-kv-key">{r.key}</td>
              <td class="history-kv-value">{r.value}</td>
            </tr>
          )}
        </For>
      </tbody>
    </table>
  );
}
