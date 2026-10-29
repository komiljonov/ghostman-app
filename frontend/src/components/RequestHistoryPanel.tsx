import { createEffect, createSignal, For, on, Show } from "solid-js";
import { ListHistory } from "../../wailsjs/go/main/App";
import { main } from "../../wailsjs/go/models";
import { handleProblem } from "../authStore";
import {
  canSaveAsExample, formatBytes, formatDuration, groupByDay, nextCursor, requestHistoryQuery, statusChip, timeOfDay,
} from "../historyModel";
import { focusHistory, historyTick } from "../historyStore";
import { currentTree } from "../treeStore";
import ContextMenu, { MenuEntry } from "./ContextMenu";
import Icon from "./Icon";
import SaveExampleDialog from "./SaveExampleDialog";

interface Props {
  requestId: string;
  requestName: string;
  onOpenHistory: () => void; // opens (or focuses) the History tab
}

// The request editor's History sub-tab: this request's sends on this computer,
// newest first (summary rows from Go, filtered by request in SQL, pages of 100).
// A row opens the History tab filtered to this request with that entry selected;
// its hover button / context menu saves the stored response as an example of the
// request (the shared SaveExampleDialog).
export default function RequestHistoryPanel(props: Props) {
  const [items, setItems] = createSignal<main.HistorySummary[]>([]);
  const [hasMore, setHasMore] = createSignal(false);
  const [loaded, setLoaded] = createSignal(false);
  const [loading, setLoading] = createSignal(false);
  const [error, setError] = createSignal<string>();
  const [now, setNow] = createSignal(Date.now());
  const [menu, setMenu] = createSignal<{ x: number; y: number; item: main.HistorySummary }>();
  const [savingExample, setSavingExample] = createSignal<number>(); // history entry id
  const [saved, setSaved] = createSignal<string>(); // inline confirmation
  const requestIds = () => new Set(currentTree().requests.keys());
  const canSave = (s: main.HistorySummary) => canSaveAsExample(s, s.project_id, requestIds());

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
  const saveTitle = (s: main.HistorySummary) => {
    const c = canSave(s);
    return c.ok ? "Save this response as an example of the request (shared with your team)" : c.why;
  };
  const menuItems = (s: main.HistorySummary): MenuEntry[] => [
    { label: "Open in History", onSelect: () => open(s.id) },
    { label: "Save as example…", icon: "bookmark", disabled: !canSave(s).ok, title: canSave(s).why || undefined,
      onSelect: () => setSavingExample(s.id) },
  ];

  return (
    <div class="req-history">
      <div class="req-history-head">
        <span class="muted small">Sends of this request on this computer</span>
        <span class="row-spacer" />
        <Show when={saved()}>
          {(n) => <span class="history-saved small" role="status"><Icon name="check-circle" size={14} /> Saved example “{n()}”</span>}
        </Show>
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
                    <div role="listitem" tabIndex={0} class="req-history-row" classList={{ "menu-open": menu()?.item.id === s.id }}
                      title={s.error || s.url_resolved || s.url_template}
                      onClick={() => open(s.id)}
                      onKeyDown={(e) => {
                        if (e.key === "Enter" && e.target === e.currentTarget) open(s.id);
                      }}
                      onContextMenu={(e) => {
                        e.preventDefault();
                        setMenu({ x: e.clientX, y: e.clientY, item: s });
                      }}>
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
                      <span class="req-history-actions" title={saveTitle(s)} onClick={(e) => e.stopPropagation()}>
                        <button type="button" class="toolbar-icon" aria-label="Save as example" disabled={!canSave(s).ok}
                          onClick={() => setSavingExample(s.id)}><Icon name="bookmark" size={14} /></button>
                      </span>
                    </div>
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
      <Show when={menu()}>
        {(m) => <ContextMenu x={m().x} y={m().y} label="History entry actions" items={menuItems(m().item)} onClose={() => setMenu(undefined)} />}
      </Show>
      <Show when={savingExample()}>
        {(id) => (
          <SaveExampleDialog source={main.ExampleSource.createFrom({ kind: "history", tab_id: "", history_id: id() })}
            onSaved={(name) => setSaved(name)} onClose={() => setSavingExample(undefined)} />
        )}
      </Show>
    </div>
  );
}
