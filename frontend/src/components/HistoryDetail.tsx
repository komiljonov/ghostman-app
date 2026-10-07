import { createSignal, Show } from "solid-js";
import { main } from "../../wailsjs/go/models";
import { formatBytes, formatDuration, formRows, RequestForm, rowLabel, timeOfDay } from "../historyModel";
import { BodyView, hasStructure, prettyFallback } from "../responseView";
import { responseWrap, setResponseWrap } from "../uiPrefs";
import Icon from "./Icon";
import MethodBadge from "./MethodBadge";
import ResponseBody from "./ResponseBody";
import StatusBadge from "./StatusBadge";
import TimingPanel from "./TimingPanel";
import HistoryKVTable from "./HistoryKVTable";
import MediaPreview from "./MediaPreview";
import { MEDIA_VIEW_TITLE } from "../historyModel";
import { authRows, effectiveName, normalizeAuth } from "../auth";

interface Props {
  entry: main.HistoryEntry;
  openOriginal: { ok: boolean; why: string };
  busy: boolean;
  onRestore: () => void;
  onOpenOriginal: () => void;
  onCopyURL: () => void;
  onDelete: () => void;
  onSave: () => void; // save the stored response body to a file (any type)
}

type Section = "request" | "response" | "timing";

// One history entry in full: the request in template or resolved form (resolved
// includes secret values — this machine only), the stored response (reusing the
// response viewer: Pretty/Raw, collapsible JSON, search) and the per-hop timings.
// Controls that do not apply are disabled, never hidden.
export default function HistoryDetail(props: Props) {
  const [form, setForm] = createSignal<RequestForm>("template");
  const [section, setSection] = createSignal<Section>("response");
  const [respPart, setRespPart] = createSignal<"body" | "headers">("body");
  const [view, setView] = createSignal<BodyView>("pretty");
  const [confirmDelete, setConfirmDelete] = createSignal(false);

  const s = () => props.entry.summary;
  const resp = () => props.entry.response ?? undefined;
  const req = () => formRows(form() === "template" ? props.entry.template : props.entry.resolved, form());
  const like = () => {
    const r = resp();
    return r ? { contentType: r.content_type, formatted: r.formatted, body: r.body, rawBody: r.raw_body, truncated: r.preview_cut } : undefined;
  };
  const structured = () => !!like() && hasStructure(like()!);
  // Pretty: collapsible JSON, or the flat text + notice for JSON cut at 256 KB.
  // A media / binary body: shown by HistoryMedia, never as text (Pretty/Raw/Wrap disabled).
  const media = () => !!resp()?.media;
  const prettyOK = () => structured() || (!!like() && prettyFallback(like()!));
  const effective = (): BodyView => (view() === "pretty" && !prettyOK() ? "raw" : view());
  const text = () => {
    const r = resp();
    if (!r) return "";
    return effective() === "raw" && r.formatted ? r.raw_body : r.body;
  };
  const noResponse = "No response: the request failed";

  return (
    <div class="history-detail">
      <header class="history-detail-head">
        <div class="history-detail-title">
          <MethodBadge method={s().method} />
          <span class="history-detail-name" title={rowLabel(s())}>{rowLabel(s())}</span>
          <StatusBadge status={s().status} text={resp()?.status_text} />
        </div>
        <div class="history-detail-meta muted small">
          <span>{new Date(s().created_at).toLocaleDateString()} {timeOfDay(s().created_at)}</span>
          <span>{formatDuration(s().duration_ms)}</span>
          <span>{s().env_name ? <span class="env-chip">{s().env_name}</span> : "No environment"}</span>
          <Show when={resp()}>{(r) => <span>{formatBytes(r().body_size)}</span>}</Show>
          <Show when={resp()?.stored_truncated}>
            <span class="history-badge warn" title={`History kept the first ${formatBytes(resp()!.stored_bytes)} of ${formatBytes(resp()!.body_size)} (Settings → History)`}>
              truncated
            </span>
          </Show>
        </div>
        <div class="history-actions">
          <button type="button" class="small" disabled={props.busy} onClick={() => props.onRestore()}
            title="Create a new request at the project root from this entry (as authored, {{vars}} kept)">
            Restore to new request
          </button>
          <span title={props.openOriginal.why}>
            <button type="button" class="small" disabled={!props.openOriginal.ok} onClick={() => props.onOpenOriginal()}>
              Open original request
            </button>
          </span>
          <button type="button" class="small" disabled={!s().url_resolved} onClick={() => props.onCopyURL()}
            title={s().url_resolved ? "Copy the URL as sent" : "No resolved URL for this entry"}>
            Copy resolved URL
          </button>
          <button type="button" class="small" disabled={!resp()} onClick={() => props.onSave()}
            title={resp() ? "Save the stored response body to a file" : noResponse}>
            Save response…
          </button>
          <Show when={confirmDelete()} fallback={
            <button type="button" class="small danger-outline" onClick={() => setConfirmDelete(true)}>
              <Icon name="trash" size={14} /> Delete
            </button>
          }>
            <span class="history-confirm">
              Delete this entry?
              <button type="button" class="small danger" disabled={props.busy} onClick={() => props.onDelete()}>Delete</button>
              <button type="button" class="small" onClick={() => setConfirmDelete(false)}>Cancel</button>
            </span>
          </Show>
        </div>
      </header>

      <Show when={s().error}>
        <p class="form-error history-error" role="alert">{s().error}</p>
      </Show>

      <div class="history-sections">
        <div class="segmented small" role="tablist" aria-label="Entry part">
          <button type="button" role="tab" aria-selected={section() === "request"} classList={{ active: section() === "request" }}
            onClick={() => setSection("request")}>Request</button>
          <button type="button" role="tab" aria-selected={section() === "response"} classList={{ active: section() === "response" }}
            onClick={() => setSection("response")}>Response</button>
          <button type="button" role="tab" aria-selected={section() === "timing"} classList={{ active: section() === "timing" }}
            onClick={() => setSection("timing")}>Timing</button>
        </div>
        <span class="row-spacer" />
        <Show when={section() === "request"}>
          <div class="segmented small" role="radiogroup" aria-label="Request form">
            <button type="button" role="radio" aria-checked={form() === "template"} classList={{ active: form() === "template" }}
              title="As authored, {{vars}} unresolved" onClick={() => setForm("template")}>Template</button>
            <button type="button" role="radio" aria-checked={form() === "resolved"} classList={{ active: form() === "resolved" }}
              title="As sent, variables (secrets included) resolved" onClick={() => setForm("resolved")}>Resolved</button>
          </div>
        </Show>
        <Show when={section() === "response"}>
          <div class="segmented small" role="tablist" aria-label="Response part" title={resp() ? undefined : noResponse}>
            <button type="button" role="tab" disabled={!resp()} classList={{ active: !!resp() && respPart() === "body" }}
              onClick={() => setRespPart("body")}>Body</button>
            <button type="button" role="tab" disabled={!resp()} classList={{ active: !!resp() && respPart() === "headers" }}
              onClick={() => setRespPart("headers")}>Headers <span class="muted resp-count">{resp()?.headers.length ?? ""}</span></button>
          </div>
          <div class="segmented small" role="radiogroup" aria-label="Body view"
            title={!resp() ? noResponse : respPart() === "headers" ? "Applies to the body" : undefined}>
            <button type="button" role="radio" disabled={!resp() || respPart() !== "body" || media() || !prettyOK()}
              title={media() ? MEDIA_VIEW_TITLE : resp() && !prettyOK() ? "Pretty is for JSON responses" : undefined}
              classList={{ active: !!resp() && effective() === "pretty" }} onClick={() => setView("pretty")}>Pretty</button>
            <button type="button" role="radio" disabled={!resp() || respPart() !== "body" || media()}
              title={media() ? MEDIA_VIEW_TITLE : undefined}
              classList={{ active: !!resp() && !media() && effective() === "raw" }} onClick={() => setView("raw")}>Raw</button>
          </div>
          <label classList={{ "choice small": true, disabled: !resp() || respPart() !== "body" || media() }}
            title={media() ? MEDIA_VIEW_TITLE : undefined}>
            <input type="checkbox" checked={responseWrap()} disabled={!resp() || respPart() !== "body" || media()}
              onChange={(e) => setResponseWrap(e.currentTarget.checked)} />
            Wrap
          </label>
        </Show>
      </div>

      <div class="history-section-body">
        <Show when={section() === "request"}>
          <div class="history-request">
            <div class="history-url"><MethodBadge method={s().method} /><code>{req().url || "—"}</code></div>
            <Show when={form() === "resolved"}>
              <p class="settings-hint">Resolved as sent, secret values included. Stored only on this computer.</p>
            </Show>
            <Show when={req().params.length > 0}>
              <h4>Query params</h4>
              <HistoryKVTable rows={req().params} />
            </Show>
            <Show when={form() === "template"}>
              <h4>Auth <span class="muted small">
                {props.entry.auth ? `${effectiveName(normalizeAuth(props.entry.auth))} (${props.entry.auth_source})` : "No auth"}
              </span></h4>
              <Show when={props.entry.auth}>
                {(a) => <HistoryKVTable rows={authRows(normalizeAuth(a())).map((r) => ({ ...r, off: false }))} />}
              </Show>
            </Show>
            <h4>Headers</h4>
            <Show when={req().headers.length > 0} fallback={<p class="muted small">No headers</p>}>
              <HistoryKVTable rows={req().headers} />
            </Show>
            <h4>Body <Show when={req().bodyLabel}><span class="muted small">{req().bodyLabel}</span></Show></h4>
            <Show when={req().body} fallback={<p class="muted small">No body</p>}>
              <pre class="history-pre">{req().body}</pre>
            </Show>
          </div>
        </Show>
        <Show when={section() === "response"}>
          <Show when={resp()} fallback={<p class="placeholder small">{noResponse}{s().error ? ` (${s().error})` : ""}</p>}>
            {(r) => (
              <Show when={respPart() === "body"} fallback={<HistoryKVTable rows={r().headers.map((h) => ({ key: h.key, value: h.value, off: false }))} />}>
                <Show when={!r().media} fallback={<MediaPreview media={r().media} url={r().media_url}
                  contentType={r().content_type} bytes={r().stored_bytes} onSave={() => props.onSave()}
                  note={r().stored_truncated ? `History kept the first ${formatBytes(r().stored_bytes)} of ${formatBytes(r().body_size)} (Settings → History), so this may be incomplete.` : undefined} />}>
                <Show when={r().preview_cut}>
                  <p class="settings-hint">Showing the first 256 KB of {formatBytes(r().stored_bytes)} stored.</p>
                </Show>
                <Show when={text()} fallback={<p class="placeholder small">Empty body</p>}>
                  <div class="history-body">
                    <ResponseBody text={text()} structured={effective() === "pretty" && structured()}
                      fallbackNotice={effective() === "pretty" && !structured()} wrap={responseWrap()}
                      onFolds={() => undefined} ref={() => undefined} />
                  </div>
                </Show>
                </Show>
              </Show>
            )}
          </Show>
        </Show>
        <Show when={section() === "timing"}>
          <Show when={props.entry.hops.length > 0} fallback={<p class="placeholder small">No timing recorded for this entry</p>}>
            <TimingPanel hops={props.entry.hops} />
          </Show>
        </Show>
      </div>
    </div>
  );
}
