import { createSignal, Show } from "solid-js";
import { EvalCaptureFilter, WarmCaptureFilter } from "../../wailsjs/go/main/App";
import { main } from "../../wailsjs/go/models";
import { formatBytes } from "../historyModel";
import { BodyView, hasStructure, prettyFallback } from "../responseView";
import { filterAvailability, filterDisplay, FilterState, NO_FILTER, saveChoices } from "../responseFilter";
import { responseWrap, setResponseWrap } from "../uiPrefs";
import { capturePathLabel } from "../webhookModel";
import ContextMenu from "./ContextMenu";
import HistoryKVTable from "./HistoryKVTable";
import Icon from "./Icon";
import MediaPreview from "./MediaPreview";
import MethodBadge from "./MethodBadge";
import ResponseBody from "./ResponseBody";
import ResponseFilterBar from "./ResponseFilterBar";

interface Props {
  webhookId: string;
  detail: main.CaptureDetail;
  busy: boolean;
  onCopyAsRequest: () => void;
  onCopyBody: () => void;
  onSave: () => void; // the stored body, any type
  onSaveFiltered: (query: string) => void;
  onCopyFiltered: (query: string) => void;
}

const NOT_TEXT = "Not a text body — save it to a file";

// One captured request in full (history-like): its headers, and the body through
// the shared response viewer (Pretty JSON with folding + search, Raw, Wrap, the
// jq filter for JSON). A binary / media body is never shown as text: a file card
// with Save. Controls that do not apply are disabled, never hidden.
export default function CaptureDetailView(props: Props) {
  const [part, setPart] = createSignal<"body" | "headers">("body");
  const [view, setView] = createSignal<BodyView>("pretty");
  const [fquery, setFquery] = createSignal("");
  const [fstate, setFstate] = createSignal<FilterState>(NO_FILTER);
  const [saveMenu, setSaveMenu] = createSignal<{ x: number; y: number }>();
  const filtered = () => filterDisplay(fstate());

  const d = () => props.detail;
  const s = () => d().summary;
  const hasBody = () => d().stored_bytes > 0;
  const media = () => !!d().media;
  const like = () => ({ contentType: s().content_type, formatted: d().formatted, body: d().body, rawBody: d().raw_body, truncated: d().preview_cut });
  const structured = () => hasStructure(like());
  const prettyOK = () => hasBody() && !media() && (structured() || prettyFallback(like()));
  const effective = (): BodyView => (view() === "pretty" && !prettyOK() ? "raw" : view());
  const text = () => (effective() === "raw" && d().formatted ? d().raw_body : d().body);
  const bodyControls = () => part() === "body" && hasBody() && !media();
  const truncatedNote = () => `The server kept the first ${formatBytes(d().stored_bytes)} of ${formatBytes(s().body_size)} received.`;

  return (
    <div class="history-detail capture-detail">
      <header class="history-detail-head">
        <div class="history-detail-title">
          <MethodBadge method={s().method} />
          <span class="history-detail-name" title={capturePathLabel(s())}>{capturePathLabel(s())}</span>
        </div>
        <div class="history-detail-meta muted small">
          <span>{new Date(s().received_at).toLocaleString()}</span>
          <span>from {s().source_ip || "unknown"}</span>
          <span>{s().content_type || "no Content-Type"}</span>
          <span>{formatBytes(s().body_size)}</span>
          <Show when={s().body_truncated}>
            <span class="history-badge warn" title={truncatedNote()}>truncated</span>
          </Show>
        </div>
        <div class="history-actions">
          <button type="button" class="small" disabled={props.busy} onClick={() => props.onCopyAsRequest()}
            title="Create a request at the project root from this capture (without Host, Content-Length, Connection, Accept-Encoding) and open it">
            Copy as request
          </button>
          <button type="button" class="small" disabled={!hasBody() || media()} onClick={() => props.onCopyBody()}
            title={!hasBody() ? "This request had no body" : media() ? NOT_TEXT : "Copy the body to the clipboard"}>
            Copy body
          </button>
          <button type="button" class="small" disabled={!hasBody()} aria-haspopup={saveChoices(fstate()) ? "menu" : undefined}
            title={hasBody() ? "Save the body to a file" : "This request had no body"}
            onClick={(e) => {
              if (!saveChoices(fstate())) return props.onSave();
              const b = e.currentTarget.getBoundingClientRect();
              setSaveMenu({ x: b.left, y: b.bottom + 2 });
            }}>
            <Icon name="download" size={14} /> Save body…
          </button>
        </div>
      </header>

      <div class="history-sections">
        <div class="segmented small" role="tablist" aria-label="Capture part">
          <button type="button" role="tab" aria-selected={part() === "body"} classList={{ active: part() === "body" }}
            onClick={() => setPart("body")}>Body</button>
          <button type="button" role="tab" aria-selected={part() === "headers"} classList={{ active: part() === "headers" }}
            onClick={() => setPart("headers")}>Headers <span class="muted resp-count">{d().headers.length}</span></button>
        </div>
        <span class="row-spacer" />
        <div class="segmented small" role="radiogroup" aria-label="Body view"
          title={part() === "headers" ? "Applies to the body" : !hasBody() ? "No body" : undefined}>
          <button type="button" role="radio" disabled={!bodyControls() || !prettyOK()}
            title={media() ? NOT_TEXT : hasBody() && !prettyOK() ? "Pretty is for JSON bodies" : undefined}
            classList={{ active: bodyControls() && effective() === "pretty" }} onClick={() => setView("pretty")}>Pretty</button>
          <button type="button" role="radio" disabled={!bodyControls()} title={media() ? NOT_TEXT : undefined}
            classList={{ active: bodyControls() && effective() === "raw" }} onClick={() => setView("raw")}>Raw</button>
        </div>
        <label classList={{ "choice small": true, disabled: !bodyControls() }} title={media() ? NOT_TEXT : undefined}>
          <input type="checkbox" checked={responseWrap()} disabled={!bodyControls()}
            onChange={(e) => setResponseWrap(e.currentTarget.checked)} />
          Wrap
        </label>
      </div>

      <div class="history-section-body">
        <ResponseFilterBar query={fquery()} onQuery={setFquery} state={fstate()} onState={setFstate}
          evaluate={(q) => EvalCaptureFilter(props.webhookId, s().id, q)}
          availability={hasBody() ? filterAvailability({ ...like(), media: d().media }) : { enabled: false, title: "No body" }}
          onCopy={() => props.onCopyFiltered(fquery())} onWarm={() => void WarmCaptureFilter(props.webhookId, s().id)} />
        <Show when={part() === "body"} fallback={
          <HistoryKVTable rows={d().headers.map((h) => ({ key: h.key, value: h.value, off: false }))} />
        }>
          <Show when={hasBody()} fallback={<p class="placeholder small">No body</p>}>
            <Show when={!media()} fallback={
              <MediaPreview media={d().media} url="" contentType={s().content_type} bytes={d().stored_bytes}
                onSave={() => props.onSave()} note={s().body_truncated ? truncatedNote() : undefined} />
            }>
              <Show when={s().body_truncated}><p class="settings-hint">{truncatedNote()}</p></Show>
              <Show when={d().preview_cut}>
                <p class="settings-hint">Showing the first 256 KB of {formatBytes(d().stored_bytes)}.</p>
              </Show>
              <Show when={filtered().mode === "full"} fallback={
                <Show when={filtered().mode === "result" ? filtered() : undefined}
                  fallback={<p class="placeholder small">No matches for this filter.</p>}>
                  {(f) => (
                    <div class="history-body">
                      <ResponseBody text={(f() as { text: string }).text} structured={(f() as { structured: boolean }).structured}
                        fallbackNotice={false} wrap={responseWrap()} onFolds={() => undefined} ref={() => undefined} />
                    </div>
                  )}
                </Show>
              }>
                <div class="history-body">
                  <ResponseBody text={text()} structured={effective() === "pretty" && structured()}
                    fallbackNotice={effective() === "pretty" && !structured()} wrap={responseWrap()}
                    onFolds={() => undefined} ref={() => undefined} />
                </div>
              </Show>
            </Show>
          </Show>
        </Show>
      </div>
      <Show when={saveMenu()}>
        {(m) => (
          <ContextMenu x={m().x} y={m().y} label="Save body" onClose={() => setSaveMenu(undefined)}
            items={(saveChoices(fstate()) ?? []).map((c) => ({
              label: c.label, disabled: !c.enabled,
              onSelect: () => (c.id === "full" ? props.onSave() : props.onSaveFiltered(fquery())),
            }))} />
        )}
      </Show>
    </div>
  );
}
