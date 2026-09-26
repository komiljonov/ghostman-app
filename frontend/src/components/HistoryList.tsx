import { For, Show } from "solid-js";
import { store } from "../../wailsjs/go/models";
import StatusBadge from "./StatusBadge";

interface Props {
  entries: store.History[];
  onSelect: (entry: store.History) => void;
}

export default function HistoryList(props: Props) {
  return (
    <section class="history">
      <h2>History</h2>
      <Show when={props.entries.length > 0} fallback={<p class="placeholder">No requests yet.</p>}>
        <ul>
          <For each={props.entries}>
            {(entry) => (
              <li>
                <button type="button" onClick={() => props.onSelect(entry)} title={entry.url}>
                  <span class="history-method">{entry.method}</span>
                  <span class="history-url">{entry.url}</span>
                  <StatusBadge status={entry.status} />
                  <span class="muted">{entry.durationMs} ms</span>
                  <span class="muted">{new Date(entry.createdAt).toLocaleTimeString()}</span>
                </button>
              </li>
            )}
          </For>
        </ul>
      </Show>
    </section>
  );
}
