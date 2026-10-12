import { createSignal, For, onCleanup, Show } from "solid-js";
import type { importer } from "../../wailsjs/go/models";
import { ClipboardSetText } from "../../wailsjs/runtime/runtime";
import { reportSections, summaryLine } from "../importReport";
import Icon from "./Icon";
import Modal from "./Modal";

interface Props {
  report: importer.Report;
  onClose: () => void;
}

// The end-of-import report (always shown, success included): the stop banner if
// the import stopped early, then Imported / Imported with changes / Dropped /
// Failed as collapsible sections with counts (empty ones hidden). Scripts and
// other preserved texts sit collapsed inside their entry; "Copy full report"
// copies Go's plain-text rendering, which includes all of them.
// "Pre-request script (4 lines)", but "Variables (2)": only a script counts lines.
const detailCount = (label: string, text: string) => {
  const n = text.split("\n").length;
  if (!/script/i.test(label)) return `${n}`;
  return n === 1 ? "1 line" : `${n} lines`;
};

export default function ImportReport(props: Props) {
  const r = () => props.report;
  const [copied, setCopied] = createSignal(false);
  let timer: ReturnType<typeof setTimeout> | undefined;
  onCleanup(() => clearTimeout(timer));

  const copy = async () => {
    await ClipboardSetText(r().text);
    setCopied(true);
    clearTimeout(timer);
    timer = setTimeout(() => setCopied(false), 1800);
  };

  const what = () => (r().kind === "openapi" ? "API spec" : r().kind === "environment" ? "Postman environment" : "Postman collection");

  return (
    <Modal title="Import report" onClose={props.onClose} class="import-report">
      <p class="import-report-head">
        {what()} <strong>{r().name || r().source}</strong>
        <span class="muted"> ({r().format}, {r().source})</span>
        <Show when={r().target}>
          {" "}→ <strong>{r().target}</strong>
        </Show>
      </p>
      <Show when={r().stopped}>
        <div class="import-stopped" role="alert">
          <Icon name="x-circle" size={16} />
          <span>{r().stopped}</span>
        </div>
      </Show>
      <Show when={(r().notes ?? []).length > 0}>
        <ul class="import-notes" aria-label="Notes">
          <For each={r().notes}>
            {(n) => (
              <li><Icon name="info" size={14} /><span>{n}</span></li>
            )}
          </For>
        </ul>
      </Show>
      <div class="import-sections">
        <For each={reportSections(r())}>
          {(s) => (
            <details class={`import-section ${s.key}`} open={s.open}>
              <summary>
                <Icon name="chevron" size={12} />
                <span class="import-section-icon"><Icon name={s.icon} size={16} /></span>
                <span class="import-section-title">{s.title}</span>
                <span class="badge count">{s.entries.length}</span>
                <Show when={s.key === "imported"}>
                  <span class="muted small import-summary">{summaryLine(r())}</span>
                </Show>
              </summary>
              <ul class="import-entries">
                <For each={s.entries}>
                  {(e) => (
                    <li>
                      <div class="import-entry">
                        <Show when={e.kind && s.key === "imported"}><span class="import-kind">{e.kind}</span></Show>
                        <Show when={e.path}><strong class="import-path">{e.path}</strong><span class="muted"> — </span></Show>
                        <span>{e.message}</span>
                        <Show when={e.location}><span class="muted import-location"> → {e.location}</span></Show>
                        <Show when={e.action}><span class="import-action"> {e.action}</span></Show>
                      </div>
                      <Show when={e.detail}>
                        {(detail) => (
                          <details class="import-detail">
                            <summary>{e.detail_label || "Details"} ({detailCount(e.detail_label ?? "", detail())})</summary>
                            <pre>{detail()}</pre>
                          </details>
                        )}
                      </Show>
                    </li>
                  )}
                </For>
              </ul>
            </details>
          )}
        </For>
      </div>
      <div class="modal-actions">
        <span class="muted small import-copied" aria-live="polite">{copied() ? "Copied to the clipboard" : ""}</span>
        <button type="button" onClick={() => void copy()}>Copy full report</button>
        <button type="button" class="primary" onClick={props.onClose}>Close</button>
      </div>
    </Modal>
  );
}
