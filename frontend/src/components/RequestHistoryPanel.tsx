import { createEffect, createSignal, For, on, Show } from "solid-js";
import { ListHistory } from "../../wailsjs/go/main/App";
import { main } from "../../wailsjs/go/models";
import { handleProblem } from "../authStore";
import {
  formatBytes, formatDuration, groupByDay, nextCursor, requestHistoryQuery, statusChip, timeOfDay,
} from "../historyModel";
import { focusHistory, historyTick } from "../historyStore";

interface Props {
  requestId: string;
  requestName: string;
  onOpenHistory: () => void; // opens (or focuses) the History tab
}

// The request editor's History sub-tab: this request's sends on this computer,
// newest first (summary rows from Go, filtered by request in SQL, pages of 100).
// A row opens the History tab filtered to this request with that entry selected.
export default function RequestHistoryPanel(props: Props) {
  const [items, setItems] = createSignal<main.HistorySummary[]>([]);
  const [hasMore, setHasMore] = createSignal(false);
  const [loaded, setLoaded] = createSignal(false);
  const [loading, setLoading] = createSignal(false);
  const [error, setError] = createSignal<string>();
  const [now, setNow] = createSignal(Date.now());

  let seq = 0;
  const load = async (append: boolean) => {
    const mine = ++seq;
    setLoading(true);
    const cursor = append ? nextCursor(items()) : undefined;
    const result = await ListHistory(main.HistoryFilter.createFrom(requestHistoryQuery(props.requestId, cursor)));
    if (mine !== seq) return;
    setLoading(false);
    setLoaded(true);
    handleProblem(result.error);
    setError(result.error?.message);
    if (!result.data) return;
    setNow(Date.now());
    setItems(append ? [...items(), ...result.data.items] : result.data.items);
    setHasMore(result.data.has_more);
  };

  // Re-fetch after every send (and Settings clears / prunes).
  createEffect(on([() => props.requestId, historyTick], () => void load(false)));

  const open = (entryId?: number) => {
    focusHistory({ requestId: props.requestId, requestName: props.requestName, entryId });
    props.onOpenHistory();
  };

  return (
    <div class="req-history">
      <div class="req-history-head">
        <span class="muted small">Sends of this request on this computer</span>
        <span class="row-spacer" />
        <button type="button" class="small" onClick={() => open()}>Open in History</button>
      </div>
      <Show when={error()}><p class="form-error">{error()}</p></Show>
      <Show when={loaded() && items().length === 0 && !error()}>
        <p class="placeholder small">No sends yet. Each Send is recorded here.</p>
      </Show>
      <div class="req-history-list" role="list">
        <For each={groupByDay(items(), now())}>
          {(g) => (
            <>
              <div class="req-history-day">{g.label}</div>
              <For each={g.items}>
                {(s) => {
                  const chip = statusChip(s);
                  return (
                    <button type="button" role="listitem" class="req-history-row" title={s.error || s.url_resolved || s.url_template}
                      onClick={() => open(s.id)}>
                      <span class="req-history-time">{timeOfDay(s.created_at)}</span>
                      <span class={`history-status st-${chip.cls}`}>{chip.text}</span>
                      <span class="req-history-dur">{formatDuration(s.duration_ms)}</span>
                      <span class="req-history-size muted">{s.error ? "" : formatBytes(s.resp_body_size)}</span>
                      <span class="req-history-env">
                        <Show when={s.env_name} fallback={<span class="muted">No environment</span>}>
                          <span class="env-chip">{s.env_name}</span>
                        </Show>
                      </span>
                      <span class="req-history-note muted">{s.error}</span>
                    </button>
                  );
                }}
              </For>
            </>
          )}
        </For>
        <Show when={hasMore()}>
          <button type="button" class="history-more small" disabled={loading()} onClick={() => void load(true)}>
            {loading() ? "Loading…" : "Load more"}
          </button>
        </Show>
      </div>
    </div>
  );
}
