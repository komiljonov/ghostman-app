import { createEffect, createMemo, createSignal, For, on, onCleanup, onMount, Show } from "solid-js";
import {
  ClearCaptures, CopyCaptureAsRequest, CopyCaptureBody, CopyCaptureFilteredResult, GetCaptureDetail, GetWebhook, SaveCaptureBodyToFile,
  SaveCaptureFilteredToFile, UpdateWebhook,
} from "../../wailsjs/go/main/App";
import { api, main } from "../../wailsjs/go/models";
import { ClipboardSetText } from "../../wailsjs/runtime/runtime";
import { handleProblem } from "../authStore";
import { createAutosaver, SaveState } from "../autosave";
import { formatBytes } from "../historyModel";
import type { Row } from "../rows";
import { requestTreeReload } from "../treeStore";
import {
  capturePathLabel, effectiveDomain, hookUrls, NOT_CONFIGURED_TEXT, parseStatus, relativeTime, responseContentType,
} from "../webhookModel";
import {
  feedCleared, feedOf, hookDomains, listenState, markSeen, registerWebhookFlush, reloadWebhooks, responseOpen, selectedCapture,
  setPinned, webhooks,
} from "../webhookStore";
import CaptureDetailView from "./CaptureDetailView";
import FormError from "./FormError";
import Icon from "./Icon";
import KeyValueEditor from "./KeyValueEditor";
import MethodBadge from "./MethodBadge";
import PlainEditor from "./PlainEditor";
import SaveIndicator from "./SaveIndicator";

interface Props {
  webhookId: string;
  onOpenRequest: (id: string) => void;
}

const SAVE_DELAY_MS = 600;
const NOW_TICK_MS = 15_000;

interface Config {
  status: number;
  headers: Row[];
  body: string;
}

const keyed = (rows: Row[]) => rows.filter((r) => r.key.trim() !== "").map((r) => ({ key: r.key, value: r.value, enabled: r.enabled }));

// A webhook endpoint's tab: its URLs (path form primary, subdomain form
// secondary), the domain, the static response senders get (autosaved like a
// request: 600 ms debounce, only the changed fields), and the captured requests
// — newest first, polled every 2 s by webhookStore while this tab exists (also
// when it is not shown) — with a history-like detail of the selected one.
export default function WebhookView(props: Props) {
  const [hook, setHook] = createSignal<api.WebhookDetail>();
  const [loadError, setLoadError] = createSignal<string>();
  const [statusText, setStatusText] = createSignal("");
  const [headers, setHeaders] = createSignal<Row[]>([]);
  const [body, setBody] = createSignal("");
  const [saveState, setSaveState] = createSignal<SaveState>("idle");
  const [saveError, setSaveError] = createSignal<string>();
  const [domainError, setDomainError] = createSignal<string>();
  const [open, setOpen] = createSignal(responseOpen.get(props.webhookId) ?? false);
  const [copied, setCopied] = createSignal<"primary" | "subdomain">();
  const [selected, setSelected] = createSignal<number | undefined>(selectedCapture.get(props.webhookId));
  const [detail, setDetail] = createSignal<main.CaptureDetail>();
  const [detailError, setDetailError] = createSignal<string>();
  const [confirmClear, setConfirmClear] = createSignal(false);
  const [busy, setBusy] = createSignal(false);
  const [notice, setNotice] = createSignal<{ text: string; error?: boolean }>();
  const [now, setNow] = createSignal(Date.now());
  let base: Config | undefined;
  let listEl: HTMLDivElement | undefined;
  let copiedTimer: ReturnType<typeof setTimeout> | undefined;
  let noticeTimer: ReturnType<typeof setTimeout> | undefined;

  const id = () => props.webhookId;
  const feed = () => feedOf(id());
  const captures = () => feed()?.captures ?? [];
  const listen = () => listenState(id());
  // The list's name follows renames from the panel without a re-fetch of the detail.
  const name = () => webhooks().find((w) => w.id === id())?.name ?? hook()?.name ?? "";
  const domain = () => effectiveDomain(hook()?.domain ?? "", hookDomains());
  const urls = () => (hook() && !domain().off ? hookUrls(hook()!.slug, domain().domain) : undefined);
  const status = () => parseStatus(statusText());

  const flash = (text: string, error = false) => {
    clearTimeout(noticeTimer);
    setNotice({ text, error });
    noticeTimer = setTimeout(() => setNotice(undefined), 8000);
  };

  const adopt = (d: api.WebhookDetail) => {
    setHook(d);
    base = { status: d.resp_status, headers: (d.resp_headers ?? []).map((h) => ({ ...h })), body: d.resp_body };
    setStatusText(String(d.resp_status));
    setHeaders(base.headers.map((h) => ({ ...h })));
    setBody(d.resp_body);
  };
  const load = async () => {
    const r = await GetWebhook(id());
    handleProblem(r.error);
    setLoadError(r.error?.message);
    if (r.data) adopt(r.data);
  };

  // Autosave of the configured response: one PATCH with the changed fields; an
  // invalid status is left out (and shown) until it is valid.
  const saver = createAutosaver({
    delayMs: SAVE_DELAY_MS,
    onState: (s) => {
      setSaveState(s);
      if (s !== "error") setSaveError(undefined);
    },
    save: async () => {
      const b = base;
      if (!b) return true;
      const patch: Partial<main.WebhookPatchInput> = {};
      const st = status();
      if (st.ok && st.status !== b.status) patch.resp_status = st.status;
      const rows = keyed(headers());
      if (JSON.stringify(rows) !== JSON.stringify(keyed(b.headers))) patch.resp_headers = rows;
      if (body() !== b.body) patch.resp_body = body();
      if (Object.keys(patch).length === 0) return true;
      const r = await UpdateWebhook(id(), main.WebhookPatchInput.createFrom(patch));
      handleProblem(r.error);
      if (r.error || !r.data) {
        setSaveError(r.error?.message);
        return false;
      }
      // The server's answer is the new base; the draft keeps what is being typed.
      base = { status: r.data.resp_status, headers: (r.data.resp_headers ?? []).map((h) => ({ ...h })), body: r.data.resp_body };
      setHook(r.data);
      return true;
    },
  });
  const edit = (fn: () => void) => {
    fn();
    saver.change();
  };
  const unregister = registerWebhookFlush(() => saver.flush());
  onCleanup(() => {
    unregister();
    clearTimeout(copiedTimer);
    clearTimeout(noticeTimer);
    void saver.flush().then(() => saver.dispose()); // pending edits still reach the server
  });

  onMount(() => {
    void load();
    markSeen(id());
    const t = setInterval(() => setNow(Date.now()), NOW_TICK_MS);
    onCleanup(() => clearInterval(t));
  });
  createEffect(() => {
    if ((feed()?.unseen ?? 0) > 0) markSeen(id()); // mounted = shown
  });

  const changeDomain = async (value: string) => {
    setDomainError(undefined);
    const r = await UpdateWebhook(id(), main.WebhookPatchInput.createFrom({ domain: value }));
    handleProblem(r.error);
    setDomainError(r.error?.message);
    await load(); // re-fetch: the server's view is the truth
    void reloadWebhooks();
  };

  const copy = (which: "primary" | "subdomain") => {
    const u = urls();
    if (!u) return;
    void ClipboardSetText(which === "primary" ? u.primary : u.subdomain);
    clearTimeout(copiedTimer);
    setCopied(which);
    copiedTimer = setTimeout(() => setCopied(undefined), 1500);
  };

  // ---- Captures ----
  let detailSeq = 0;
  const select = async (captureId: number | undefined) => {
    setSelected(captureId);
    if (captureId === undefined) selectedCapture.delete(id());
    else selectedCapture.set(id(), captureId);
    setDetailError(undefined);
    const mine = ++detailSeq;
    if (captureId === undefined) return setDetail(undefined);
    const r = await GetCaptureDetail(id(), captureId);
    if (mine !== detailSeq) return;
    handleProblem(r.error);
    setDetailError(r.error?.message);
    setDetail(r.data ?? undefined);
  };
  onMount(() => {
    const s = selected();
    if (s !== undefined) void select(s);
  });
  // A cleared list drops the selection.
  createEffect(on(captures, (list) => {
    const s = selected();
    if (s !== undefined && feed()?.loaded && !list.some((c) => c.id === s)) void select(undefined);
  }, { defer: true }));

  const onListScroll = () => {
    if (listEl) setPinned(id(), listEl.scrollTop < 4);
  };
  const toTop = () => {
    listEl?.scrollTo({ top: 0, behavior: "smooth" });
    setPinned(id(), true);
  };
  onMount(() => setPinned(id(), true)); // a remounted list starts at its top

  const clearAll = async () => {
    setBusy(true);
    const r = await ClearCaptures(id());
    setBusy(false);
    handleProblem(r.error);
    setConfirmClear(false);
    if (r.error) return flash(r.error.message, true);
    void select(undefined);
    feedCleared(id());
  };
  const copyAsRequest = async (captureId: number) => {
    setBusy(true);
    const r = await CopyCaptureAsRequest(id(), captureId);
    setBusy(false);
    handleProblem(r.error);
    if (r.error || !r.data) return flash(r.error?.message ?? "Could not create the request", true);
    requestTreeReload(); // re-fetch the tree, then open the new request
    props.onOpenRequest(r.data.id);
  };
  const copyBody = async (captureId: number) => {
    const r = await CopyCaptureBody(id(), captureId);
    handleProblem(r.error);
    flash(r.error ? r.error.message : "Copied the body", !!r.error);
  };
  const saveBody = async (captureId: number) => {
    const r = await SaveCaptureBodyToFile(id(), captureId);
    handleProblem(r.error);
    if (r.error) return flash(r.error.message, true);
    if (r.data) flash(`Saved ${formatBytes(r.data.bytes_written)} to ${r.data.path}${r.data.truncated_at_cap ? " — the server kept only the first part of this body." : ""}`);
  };
  const saveFiltered = async (captureId: number, query: string) => {
    const r = await SaveCaptureFilteredToFile(id(), captureId, query);
    handleProblem(r.error);
    if (r.error) return flash(r.error.message, true);
    if (r.data) flash(`Saved the filtered result (${formatBytes(r.data.bytes_written)}) to ${r.data.path}`);
  };
  const copyFiltered = async (captureId: number, query: string) => {
    const r = await CopyCaptureFilteredResult(id(), captureId, query);
    handleProblem(r.error);
    flash(r.error ? r.error.message : "Copied the filtered result", !!r.error);
  };

  const listenTitle = createMemo(() => {
    switch (listen()) {
      case "listening": return "Listening — checking for new requests every 2 s";
      case "error": return `Polling failed — retrying: ${feed()?.error ?? ""}`;
      case "paused": return "Paused while the window is in the background";
      default: return "Not listening";
    }
  });

  return (
    <div class="webhook-view">
      <header class="webhook-head">
        <div class="webhook-title">
          <span classList={{ "listen-dot": true, [listen()]: true, pulse: listen() === "listening" }} title={listenTitle()}
            role="status" aria-label={listenTitle()} />
          <h2 class="webhook-name" title={name()}>{name() || "Webhook"}</h2>
          <span class="row-spacer" />
          <label class="webhook-domain">
            <span class="muted small">Domain</span>
            <select aria-label="Domain" disabled={domain().off || !hook()} value={domain().domain}
              title={domain().off ? NOT_CONFIGURED_TEXT : "The capture domain senders use"}
              onChange={(e) => void changeDomain(e.currentTarget.value)}>
              <Show when={domain().off}><option value="">—</option></Show>
              <For each={hookDomains()}>{(d, i) => <option value={d}>{d}{i() === 0 ? " (default)" : ""}</option>}</For>
            </select>
          </label>
        </div>
        <Show when={domain().missing}>
          <p class="muted small webhook-domain-hint" title={`Stored preference: ${hook()?.domain}`}>
            Domain {hook()?.domain} is no longer offered by the server — using the default.
          </p>
        </Show>
        <FormError message={loadError() || domainError()} />
        <Show when={urls()} fallback={<p class="muted small">{hook() && domain().off ? NOT_CONFIGURED_TEXT : "Loading…"}</p>}>
          {(u) => (
            <div class="webhook-urls">
              <div class="webhook-url primary">
                <code class="webhook-url-text" title={u().primary}>{u().primary}</code>
                <button type="button" class="small" onClick={() => copy("primary")} aria-label="Copy URL">
                  <Icon name="duplicate" size={14} /> {copied() === "primary" ? "Copied" : "Copy"}
                </button>
              </div>
              <div class="webhook-url secondary">
                <code class="webhook-url-text" title={u().subdomain}>{u().subdomain}</code>
                <button type="button" class="small" onClick={() => copy("subdomain")} aria-label="Copy subdomain URL">
                  <Icon name="duplicate" size={14} /> {copied() === "subdomain" ? "Copied" : "Copy"}
                </button>
                <span class="muted small">subdomain form — requires wildcard DNS on the server</span>
              </div>
            </div>
          )}
        </Show>
      </header>

      <section classList={{ "webhook-response": true, open: open() }} aria-label="Response to senders">
        <div class="webhook-section-head">
          <button type="button" class="hooks-toggle" aria-expanded={open()} onClick={() => {
            setOpen(!open());
            responseOpen.set(id(), open());
          }}>
            <Icon name="chevron" class={open() ? "hooks-chevron open" : "hooks-chevron"} size={14} />
            <span class="webhook-section-title">Response to senders</span>
          </button>
          <span class="muted small">{hook() ? `${hook()!.resp_status}` : ""}</span>
          <span class="row-spacer" />
          <SaveIndicator state={saveState()} error={saveError()} onRetry={() => void saver.retry()} />
        </div>
        <Show when={open()}>
          <div class="webhook-response-body">
            <label class="webhook-status">
              <span>Status</span>
              <input type="text" inputmode="numeric" maxLength={3} aria-label="Response status" value={statusText()}
                aria-invalid={!status().ok} disabled={!hook()}
                onInput={(e) => edit(() => setStatusText(e.currentTarget.value))} />
              <Show when={!status().ok}>
                <span class="form-error inline small" role="alert">{(status() as { error: string }).error}</span>
              </Show>
            </label>
            <h4>Headers</h4>
            <KeyValueEditor kind="headers" rows={headers()} keyPlaceholder="Header"
              onChange={(rows) => edit(() => setHeaders(rows))} />
            <h4>Body</h4>
            <div class="webhook-body-editor">
              <PlainEditor value={body()} json={responseContentType(headers()).toLowerCase().includes("json")}
                ariaLabel="Response body" placeholder="Empty body"
                onChange={(t) => edit(() => setBody(t))} />
            </div>
            <p class="muted small">Sent back as-is to every sender; {"{{variables}}"} are not resolved here.</p>
          </div>
        </Show>
      </section>

      <section class="webhook-captures" aria-label="Captured requests">
        <div class="capture-list-pane">
          <div class="webhook-section-head">
            <span class="webhook-section-title">Captured requests</span>
            <span class="muted small">{captures().length}</span>
            <span class="row-spacer" />
            <Show when={confirmClear()} fallback={
              <button type="button" class="small danger-outline" disabled={captures().length === 0}
                title={captures().length === 0 ? "Nothing captured" : "Delete every captured request of this endpoint"}
                onClick={() => setConfirmClear(true)}>
                <Icon name="trash" size={14} /> Clear all
              </button>
            }>
              <span class="history-confirm small">
                Delete all?
                <button type="button" class="small danger" disabled={busy()} onClick={() => void clearAll()}>Clear</button>
                <button type="button" class="small" onClick={() => setConfirmClear(false)}>Cancel</button>
              </span>
            </Show>
          </div>
          <div class="capture-list-wrap">
            <Show when={(feed()?.fresh ?? 0) > 0}>
              <button type="button" class="new-chip" onClick={toTop}>
                {feed()!.fresh} new ↑
              </button>
            </Show>
            <div class="capture-list" role="listbox" aria-label="Captured requests" ref={listEl} onScroll={onListScroll}>
              <Show when={feed()?.loaded && captures().length === 0}>
                <p class="placeholder small history-empty">Waiting for requests… send one to the URL above.</p>
              </Show>
              <Show when={!feed()?.loaded}><p class="placeholder small history-empty">Loading…</p></Show>
              <For each={captures()}>
                {(c) => (
                  <button type="button" role="option" class="history-row capture-row" aria-selected={selected() === c.id}
                    classList={{ selected: selected() === c.id }} onClick={() => void select(c.id)}>
                    <MethodBadge method={c.method} />
                    <span class="history-row-main">
                      <span class="history-row-name" title={capturePathLabel(c)}>{capturePathLabel(c)}</span>
                      <span class="history-row-sub muted">
                        <span class="capture-ct" title={c.content_type}>{c.content_type || "no body type"}</span>
                        <span class="capture-size">
                          {formatBytes(c.body_size)}
                          <Show when={c.body_truncated}>
                            <span class="capture-cut" title="The server kept only the first part of this body"><Icon name="scissors" size={12} /></span>
                          </Show>
                        </span>
                        <span title="Source IP">{c.source_ip}</span>
                        <span class="history-row-time" title={new Date(c.received_at).toLocaleString()}>{relativeTime(c.received_at, now())}</span>
                      </span>
                    </span>
                  </button>
                )}
              </For>
            </div>
          </div>
          <Show when={notice()}>
            {(n) => <p classList={{ "history-notice small": true, error: !!n().error }} role="status">{n().text}</p>}
          </Show>
        </div>
        <div class="history-detail-pane capture-detail-pane">
          <FormError message={detailError()} />
          <Show when={detail()} keyed fallback={
            <p class="placeholder">{selected() === undefined ? "Select a captured request to see its headers and body." : detailError() ? "" : "Loading…"}</p>
          }>
            {(d) => (
              <CaptureDetailView webhookId={id()} detail={d} busy={busy()}
                onCopyAsRequest={() => void copyAsRequest(d.summary.id)}
                onCopyBody={() => void copyBody(d.summary.id)}
                onSave={() => void saveBody(d.summary.id)}
                onSaveFiltered={(q) => void saveFiltered(d.summary.id, q)}
                onCopyFiltered={(q) => void copyFiltered(d.summary.id, q)} />
            )}
          </Show>
        </div>
      </section>
    </div>
  );
}
