import { createSignal, For, onMount, Show } from "solid-js";
import {
  ClearHistory, GetHistorySettings, GetHistoryStorageInfo, SetHistoryMaxEntries, SetHistoryMaxResponseBytes,
} from "../../wailsjs/go/main/App";
import {
  CLEAR_SCOPES, ClearScope, entriesToDelete, MAX_ENTRIES_CHOICES, MAX_RESPONSE_CHOICES, storageLine,
} from "../historyModel";
import { historyChanged } from "../historyStore";
import { currentProjectId } from "../workspaceStore";
import FormError from "./FormError";

// Settings → History: retention (max entries, max stored response size), the
// storage line and Clear. Applies right away; everything is on this computer only.
export default function HistorySettings() {
  const [maxEntries, setMaxEntries] = createSignal(1000);
  const [maxBytes, setMaxBytes] = createSignal(10 << 20);
  const [rows, setRows] = createSignal<number>();
  const [bytes, setBytes] = createSignal(0);
  // Lowering max entries below the current count asks first.
  const [pendingMax, setPendingMax] = createSignal<{ value: number; deletes: number }>();
  const [scope, setScope] = createSignal<ClearScope>("all");
  const [confirmClear, setConfirmClear] = createSignal(false);
  const [working, setWorking] = createSignal(false);
  const [message, setMessage] = createSignal<string>();
  const [error, setError] = createSignal<string>();

  const refreshStorage = async () => {
    const r = await GetHistoryStorageInfo();
    setError(r.error?.message);
    if (r.data) {
      setRows(r.data.row_count);
      setBytes(r.data.total_bytes);
    }
  };
  onMount(async () => {
    const s = await GetHistorySettings();
    setMaxEntries(s.max_entries);
    setMaxBytes(s.max_response_bytes);
    await refreshStorage();
  });

  const applyMax = async (value: number) => {
    setWorking(true);
    try {
      const r = await SetHistoryMaxEntries(value);
      setError(r.error?.message);
      if (r.error) return;
      setMaxEntries(value);
      setPendingMax(undefined);
      if (r.data > 0) {
        setMessage(`Deleted ${r.data.toLocaleString("en-US")} oldest ${r.data === 1 ? "entry" : "entries"}.`);
        historyChanged();
      }
      await refreshStorage();
    } finally {
      setWorking(false);
    }
  };

  const chooseMax = (value: number) => {
    setMessage(undefined);
    const deletes = entriesToDelete(rows() ?? 0, value);
    if (deletes > 0) setPendingMax({ value, deletes });
    else void applyMax(value);
  };

  const chooseBytes = async (value: number) => {
    const r = await SetHistoryMaxResponseBytes(value);
    setError(r.error?.message);
    if (!r.error) setMaxBytes(value);
  };

  const clear = async () => {
    setWorking(true);
    try {
      const r = await ClearHistory(scope(), currentProjectId());
      setError(r.error?.message);
      setConfirmClear(false);
      if (r.error) return;
      setMessage(`Deleted ${r.data.toLocaleString("en-US")} ${r.data === 1 ? "entry" : "entries"}.`);
      historyChanged();
      await refreshStorage();
    } finally {
      setWorking(false);
    }
  };

  const scopeInfo = () => CLEAR_SCOPES.find((s) => s.id === scope())!;
  const scopeDisabled = (id: ClearScope) => id === "current_project" && !currentProjectId();

  return (
    <fieldset class="settings-section" aria-label="History">
      <legend>History</legend>
      <div class="settings-grid">
        <label class="field">
          <span>Keep at most</span>
          <select aria-label="History max entries" value={pendingMax()?.value ?? maxEntries()} disabled={working() || !!pendingMax()}
            onChange={(e) => chooseMax(Number(e.currentTarget.value))}>
            <For each={MAX_ENTRIES_CHOICES}>{(c) => <option value={c.value}>{c.label}</option>}</For>
          </select>
        </label>
        <label class="field">
          <span>Store responses up to</span>
          <select aria-label="History max response size" value={maxBytes()} onChange={(e) => void chooseBytes(Number(e.currentTarget.value))}>
            <For each={MAX_RESPONSE_CHOICES}>{(c) => <option value={c.value}>{c.label}</option>}</For>
          </select>
        </label>
      </div>
      <Show when={pendingMax()}>
        {(p) => (
          <div class="warning settings-confirm" role="alert">
            <span>Delete {p().deletes.toLocaleString("en-US")} oldest {p().deletes === 1 ? "entry" : "entries"} now?</span>
            <button type="button" class="small danger" disabled={working()} onClick={() => void applyMax(p().value)}>Delete</button>
            <button type="button" class="small" disabled={working()} onClick={() => setPendingMax(undefined)}>Cancel</button>
          </div>
        )}
      </Show>
      <p class="settings-hint">
        Larger responses keep their first part (marked truncated). With “Unlimited”, whole responses are also held in
        memory while they download.
      </p>
      <div class="settings-storage">
        <span class="muted" aria-label="History storage">{rows() === undefined ? "…" : storageLine(rows()!, bytes())}</span>
        <span class="row-spacer" />
        <select aria-label="Clear scope" value={scope()} disabled={confirmClear()}
          onChange={(e) => setScope(e.currentTarget.value as ClearScope)}>
          <For each={CLEAR_SCOPES}>{(s) => <option value={s.id} disabled={scopeDisabled(s.id)}>{s.label}</option>}</For>
        </select>
        <Show when={!confirmClear()}>
          <button type="button" class="small danger-outline" disabled={working() || rows() === 0 || scopeDisabled(scope())}
            title={rows() === 0 ? "History is empty" : undefined}
            onClick={() => {
              setMessage(undefined);
              setConfirmClear(true);
            }}>Clear…</button>
        </Show>
      </div>
      <Show when={confirmClear()}>
        <div class="warning settings-confirm" role="alert">
          <span>{scopeInfo().confirm}</span>
          <button type="button" class="small danger" disabled={working()} onClick={() => void clear()}>
            {working() ? "Deleting…" : "Delete"}
          </button>
          <button type="button" class="small" disabled={working()} onClick={() => setConfirmClear(false)}>Cancel</button>
        </div>
      </Show>
      <Show when={message()}><p class="settings-hint" role="status">{message()}</p></Show>
      <FormError message={error()} />
      <p class="settings-hint">
        Stored only on this computer, including resolved requests with secret values.
      </p>
    </fieldset>
  );
}
