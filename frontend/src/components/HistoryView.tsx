import { createEffect, createSignal, For, on, onCleanup, Show } from "solid-js";
import { DeleteHistoryEntry, GetHistoryEntry, ListHistory, RestoreHistoryEntry } from "../../wailsjs/go/main/App";
import { main } from "../../wailsjs/go/models";
import { ClipboardSetText } from "../../wailsjs/runtime/runtime";
import { handleProblem } from "../authStore";
import {
  canOpenOriginal, defaultFilter, FilterState, filterToQuery, formatDuration, groupByDay, METHODS, nextCursor,
  restoreAndOpen, rowLabel, STATUS_CLASSES, StatusClass, statusChip, timeOfDay,
} from "../historyModel";
import { historyChanged, historyTick } from "../historyStore";
import { requestTreeReload } from "../treeStore";
import ContextMenu, { MenuEntry } from "./ContextMenu";
import HistoryDetail from "./HistoryDetail";
import Icon from "./Icon";
import MethodBadge from "./MethodBadge";

interface Props {
  projectId: string;
  requestIds: Set<string>; // the current project's tree (for "Open original request")
  onOpenRequest: (id: string) => void;
}

const SEARCH_DEBOUNCE_MS = 250;

// The History tab: every send on this computer, newest first, grouped by day.
// Filtering and paging (100 per page) happen in SQL; rows carry summary columns
// only, and the full entry (request forms, response, timings) is fetched when a
// row is selected.
export default function HistoryView(props: Props) {
  const [filter, setFilter] = createSignal<FilterState>(defaultFilter());
  const [text, setText] = createSignal("");
  const [items, setItems] = createSignal<main.HistorySummary[]>([]);
  const [hasMore, setHasMore] = createSignal(false);
  const [loading, setLoading] = createSignal(false);
  const [loaded, setLoaded] = createSignal(false);
  const [error, setError] = createSignal<string>();
  const [selected, setSelected] = createSignal<number>();
  const [entry, setEntry] = createSignal<main.HistoryEntry>();
  const [busy, setBusy] = createSignal(false);
  const [menu, setMenu] = createSignal<{ x: number; y: number; item: main.HistorySummary }>();
  const [now, setNow] = createSignal(Date.now());

  // Every fetch gets a sequence number; a stale answer (filters changed since) is dropped.
  let seq = 0;
  const load = async (append: boolean) => {
    const mine = ++seq;
    setLoading(true);
    const cursor = append ? nextCursor(items()) : undefined;
    const result = await ListHistory(main.HistoryFilter.createFrom(filterToQuery(filter(), props.projectId, cursor)));
    if (mine !== seq) return;
    setLoading(false);
    setLoaded(true);
    handleProblem(result.error);
    setError(result.error?.message);
    if (!result.data) return;
    setNow(Date.now());
    setItems(append ? [...items(), ...result.data.items] : result.data.items);
    setHasMore(result.data.has_more);
    const sel = selected();
    if (sel !== undefined && !append && !result.data.items.some((i) => i.id === sel)) select(undefined);
  };

  // Filters, the project and outside changes (a send, Settings) reload page one.
  createEffect(on([filter, () => props.projectId, historyTick], () => void load(false)));

  let debounce: ReturnType<typeof setTimeout> | undefined;
  const onSearch = (v: string) => {
    setText(v);
    clearTimeout(debounce);
    debounce = setTimeout(() => setFilter({ ...filter(), text: v }), SEARCH_DEBOUNCE_MS);
  };
  onCleanup(() => clearTimeout(debounce));
  const patch = (p: Partial<FilterState>) => setFilter({ ...filter(), ...p });

  let entrySeq = 0;
  const select = async (id: number | undefined) => {
    setSelected(id);
    const mine = ++entrySeq;
    if (id === undefined) return setEntry(undefined);
    const result = await GetHistoryEntry(id);
    if (mine !== entrySeq) return;
    handleProblem(result.error);
    if (result.error) setError(result.error.message);
    setEntry(result.data ?? undefined);
  };

  const original = (s: main.HistorySummary) => canOpenOriginal(s, props.projectId, props.requestIds);

  const restore = async (id: number) => {
    setBusy(true);
    try {
      const err = await restoreAndOpen(id, props.projectId, {
        restore: async (eid, pid) => {
          const r = await RestoreHistoryEntry(eid, pid);
          handleProblem(r.error);
          return r;
        },
        reloadTree: requestTreeReload,
        open: props.onOpenRequest,
      });
      setError(err);
    } finally {
      setBusy(false);
    }
  };

  const remove = async (id: number) => {
    setBusy(true);
    try {
      const result = await DeleteHistoryEntry(id);
      handleProblem(result.error);
      setError(result.error?.message);
      if (!result.error) {
        if (selected() === id) void select(undefined);
        historyChanged(); // re-fetch (also refreshes other views of history)
      }
    } finally {
      setBusy(false);
    }
  };

  const copyURL = (s: main.HistorySummary) => void ClipboardSetText(s.url_resolved);

  const menuItems = (s: main.HistorySummary): MenuEntry[] => {
    const orig = original(s);
    return [
      { label: "Restore to new request", icon: "plus", disabled: busy(), onSelect: () => void restore(s.id) },
      { label: "Open original request", disabled: !orig.ok, onSelect: () => props.onOpenRequest(s.request_id) },
      { label: "Copy resolved URL", disabled: !s.url_resolved, onSelect: () => copyURL(s) },
      "separator",
      { label: "Delete entry", icon: "trash", danger: true, onSelect: () => void remove(s.id) },
    ];
  };

  const empty = () => {
    const f = filter();
    return f.text || f.method || f.status ? "No history matches these filters." : f.currentProjectOnly
      ? "No requests sent in this project yet." : "No requests sent yet.";
  };

  return (
    <div class="history-view">
      <div class="history-list-pane">
        <div class="history-filters" role="search">
          <label class="history-search">
            <Icon name="search" size={14} />
            <input type="search" placeholder="Search URL or name" aria-label="Search history" spellcheck={false}
              value={text()} onInput={(e) => onSearch(e.currentTarget.value)} />
          </label>
          <div class="history-filter-row">
            <select aria-label="Method" value={filter().method} onChange={(e) => patch({ method: e.currentTarget.value })}>
              <option value="">Any method</option>
              <For each={METHODS}>{(m) => <option value={m}>{m}</option>}</For>
            </select>
            <select aria-label="Status" value={filter().status} onChange={(e) => patch({ status: e.currentTarget.value as StatusClass })}>
              <For each={STATUS_CLASSES}>{(c) => <option value={c.id}>{c.label}</option>}</For>
            </select>
            <label class="choice small" title="Only requests sent from the current project">
              <input type="checkbox" checked={filter().currentProjectOnly}
                onChange={(e) => patch({ currentProjectOnly: e.currentTarget.checked })} />
              This project
            </label>
          </div>
        </div>
        <Show when={error()}><p class="form-error history-list-error" role="alert">{error()}</p></Show>
        <div class="history-list" role="listbox" aria-label="History entries">
          <Show when={loaded() && items().length === 0}>
            <p class="placeholder small history-empty">{empty()}</p>
          </Show>
          <For each={groupByDay(items(), now())}>
            {(g) => (
              <section class="history-day">
                <h3 class="history-day-label">{g.label}</h3>
                <For each={g.items}>
                  {(s) => {
                    const chip = statusChip(s);
                    return (
                      <button type="button" role="option" class="history-row" aria-selected={selected() === s.id}
                        classList={{ selected: selected() === s.id }}
                        onClick={() => void select(s.id)}
                        onContextMenu={(e) => {
                          e.preventDefault();
                          void select(s.id);
                          setMenu({ x: e.clientX, y: e.clientY, item: s });
                        }}>
                        <MethodBadge method={s.method} />
                        <span class="history-row-main">
                          <span class="history-row-name" title={s.url_resolved || s.url_template}>{rowLabel(s)}</span>
                          <span class="history-row-sub muted">
                            <span class="history-row-time">{timeOfDay(s.created_at)}</span>
                            <span>{formatDuration(s.duration_ms)}</span>
                            <Show when={s.env_name}><span class="env-chip">{s.env_name}</span></Show>
                          </span>
                        </span>
                        <span class={`history-status st-${chip.cls}`} title={s.error || undefined}>{chip.text}</span>
                      </button>
                    );
                  }}
                </For>
              </section>
            )}
          </For>
          <Show when={hasMore()}>
            <button type="button" class="history-more" disabled={loading()} onClick={() => void load(true)}>
              {loading() ? "Loading…" : "Load more"}
            </button>
          </Show>
        </div>
        <footer class="history-footer muted small">History is stored only on this computer.</footer>
      </div>
      <div class="history-detail-pane">
        <Show when={entry()} keyed fallback={<p class="placeholder">{selected() === undefined ? "Select an entry to see the request and response." : "Loading…"}</p>}>
          {(e) => (
            <HistoryDetail entry={e} busy={busy()} openOriginal={original(e.summary)}
              onRestore={() => void restore(e.summary.id)}
              onOpenOriginal={() => props.onOpenRequest(e.summary.request_id)}
              onCopyURL={() => copyURL(e.summary)}
              onDelete={() => void remove(e.summary.id)} />
          )}
        </Show>
      </div>
      <Show when={menu()}>
        {(m) => <ContextMenu x={m().x} y={m().y} label="History entry actions" items={menuItems(m().item)} onClose={() => setMenu(undefined)} />}
      </Show>
    </div>
  );
}
