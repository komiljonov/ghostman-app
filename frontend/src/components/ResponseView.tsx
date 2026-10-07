import { createSignal, For, Match, onCleanup, onMount, Show, Switch } from "solid-js";
import { SaveResponseToFile } from "../../wailsjs/go/main/App";
import { ClipboardSetText } from "../../wailsjs/runtime/runtime";
import { handleProblem } from "../authStore";
import { responseFindTarget } from "../responseSearch";
import {
  allHeadersText, BODY_VIEWS, bodyText, effectiveView, hasStructure, headerLine, prettyFallback, previewFrameAttrs,
  responseMenuKind, toolbarControls, viewAvailability,
} from "../responseView";
import { TabState } from "../tabsController";
import { isEditableTarget } from "../treeNav";
import { responseWrap, setResponseWrap } from "../uiPrefs";
import ContextMenu, { MenuEntry } from "./ContextMenu";
import Icon from "./Icon";
import ResponseBody, { ResponseBodyApi } from "./ResponseBody";
import StatusBadge from "./StatusBadge";

interface Props {
  tab: TabState;
  onView: (fn: (t: TabState) => void) => void;
}

function formatBytes(n: number): string {
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KB`;
  return `${(n / (1024 * 1024)).toFixed(1)} MB`;
}

// The response half of a tab. Per tab, in memory only.
//
// The toolbar is ONE row with a fixed layout that never changes shape: Body |
// Headers on the left; on the right the Pretty | Raw | Preview switcher, Wrap,
// then status · duration · size in fixed-width slots. Controls that do not apply
// (no response yet, Headers mode, Preview, a non-HTML response) are disabled
// with a tooltip — never hidden — so nothing moves (rules in responseView.ts).
export default function ResponseView(props: Props) {
  // The response the toolbar describes: none while sending or after a failure.
  const shown = () => (props.tab.sending || props.tab.responseError ? undefined : props.tab.response);
  const view = () => {
    const r = shown();
    return r ? effectiveView(r, props.tab.responseView) : props.tab.responseView;
  };
  const structured = () => {
    const r = shown();
    return !!r && hasStructure(r);
  };
  const controls = () => toolbarControls({
    hasResponse: !!shown(), section: props.tab.responseSection, view: view(), structured: structured(),
  });
  const views = () => viewAvailability(shown());

  let section!: HTMLElement;
  let body: ResponseBodyApi | undefined;
  const [pointerIn, setPointerIn] = createSignal(false);
  const [headerMenu, setHeaderMenu] = createSignal<{ x: number; y: number; row?: number }>();
  const [toast, setToast] = createSignal<{ ok: boolean; text: string }>();
  let toastTimer: ReturnType<typeof setTimeout> | undefined;
  const showToast = (ok: boolean, text: string) => {
    clearTimeout(toastTimer);
    setToast({ ok, text });
    toastTimer = setTimeout(() => setToast(undefined), 8000);
  };

  // Ctrl/Cmd+F: see the focus rule in responseSearch.ts (responseFindTarget). The
  // request body editor and the viewer itself handle the key first (CodeMirror
  // keymaps), so their events arrive here already defaultPrevented.
  const onKey = (e: KeyboardEvent) => {
    if (e.defaultPrevented || e.altKey || e.shiftKey || !(e.ctrlKey || e.metaKey) || e.key.toLowerCase() !== "f") return;
    const active = document.activeElement as HTMLElement | null;
    const focusInResponse = !!active && section.contains(active);
    const target = responseFindTarget({
      focusInResponse,
      pointerInResponse: pointerIn(),
      focusInOtherEditable: !focusInResponse && isEditableTarget(active),
    });
    if (!target || document.querySelector(".modal-backdrop")) return;
    e.preventDefault();
    if (controls().search.enabled) body?.openSearch();
  };
  onMount(() => window.addEventListener("keydown", onKey));
  onCleanup(() => {
    window.removeEventListener("keydown", onKey);
    clearTimeout(toastTimer);
  });

  const save = async () => {
    const result = await SaveResponseToFile(props.tab.id);
    handleProblem(result.error);
    if (result.error) return showToast(false, result.error.message);
    const d = result.data;
    if (!d) return; // dialog cancelled
    const bytes = `${d.bytes_written.toLocaleString("en-US")} bytes`;
    showToast(true, d.truncated_at_cap
      ? `Saved the first 20 MB (${bytes}) to ${d.path} — the response was larger than the 20 MB cap.`
      : `Saved ${bytes} to ${d.path}`);
  };

  const headerItems = (row?: number): MenuEntry[] => {
    const headers = shown()?.headers ?? [];
    const h = row === undefined ? undefined : headers[row];
    return [
      { label: "Copy value", disabled: !h, onSelect: () => h && void ClipboardSetText(h.value) },
      { label: 'Copy "Key: value"', disabled: !h, onSelect: () => h && void ClipboardSetText(headerLine(h)) },
      "separator",
      { label: "Copy All headers", onSelect: () => void ClipboardSetText(allHeadersText(headers)) },
    ];
  };

  return (
    <section class="response-view" aria-label="Response" ref={section}
      onPointerEnter={() => setPointerIn(true)} onPointerLeave={() => setPointerIn(false)}>
      <div class="response-toolbar">
        <div class="segmented small" role="tablist" aria-label="Response part" title={controls().sections.title}>
          <button type="button" role="tab" disabled={!controls().sections.enabled}
            aria-selected={props.tab.responseSection === "body"}
            classList={{ active: props.tab.responseSection === "body" }}
            onClick={() => props.onView((t) => (t.responseSection = "body"))}>Body</button>
          <button type="button" role="tab" disabled={!controls().sections.enabled}
            aria-selected={props.tab.responseSection === "headers"}
            classList={{ active: props.tab.responseSection === "headers" }}
            onClick={() => props.onView((t) => (t.responseSection = "headers"))}>
            Headers <span class="muted resp-count">{shown()?.headers.length ?? ""}</span>
          </button>
        </div>
        <span class="row-spacer" />
        <span class="toolbar-slot" title={controls().views.title}>
          <div class="segmented small" role="radiogroup" aria-label="Body view">
            <For each={BODY_VIEWS}>
              {(v) => (
                <button type="button" role="radio" aria-checked={view() === v.id}
                  classList={{ active: !!shown() && view() === v.id }}
                  title={controls().views.enabled ? views()[v.id].title : undefined}
                  disabled={!controls().views.enabled || !views()[v.id].enabled}
                  onClick={() => props.onView((t) => (t.responseView = v.id))}>{v.label}</button>
              )}
            </For>
          </div>
        </span>
        <label classList={{ "choice small toolbar-slot": true, disabled: !controls().wrap.enabled }} title={controls().wrap.title}>
          <input type="checkbox" checked={responseWrap()} disabled={!controls().wrap.enabled}
            onChange={(e) => setResponseWrap(e.currentTarget.checked)} />
          Wrap
        </label>
        <div class="toolbar-icons" role="group" aria-label="Response actions">
          <span class="toolbar-slot" title={controls().search.title}>
            <button type="button" class="toolbar-icon" aria-label="Search in response" disabled={!controls().search.enabled}
              onClick={() => body?.openSearch()}><Icon name="search" /></button>
          </span>
          <span class="toolbar-slot" title={controls().fold.enabled ? "Collapse all (to depth 1)" : controls().fold.title}>
            <button type="button" class="toolbar-icon" aria-label="Collapse all" disabled={!controls().fold.enabled}
              onClick={() => body?.collapseAll()}><Icon name="collapse" /></button>
          </span>
          <span class="toolbar-slot" title={controls().fold.enabled ? "Expand all" : controls().fold.title}>
            <button type="button" class="toolbar-icon" aria-label="Expand all" disabled={!controls().fold.enabled}
              onClick={() => body?.expandAll()}><Icon name="expand" /></button>
          </span>
          <span class="toolbar-slot" title={controls().save.title}>
            <button type="button" class="toolbar-icon" aria-label="Save response to file" disabled={!controls().save.enabled}
              onClick={() => void save()}><Icon name="download" /></button>
          </span>
        </div>
        {/* One fixed-size cluster: in a narrow pane it wraps to a second row as a unit
            (depends on the pane width only, never on the mode or the response). */}
        <div class="resp-indicators">
          <span class="toolbar-divider" aria-hidden="true" />
          <span class="resp-status">
            <Show when={shown()} fallback={<span class="muted">—</span>}>
              {(r) => <StatusBadge status={r().status} text={r().statusText} />}
            </Show>
          </span>
          <span class="resp-metric" title="Duration">{shown() ? `${shown()!.durationMs} ms` : ""}</span>
          <span class="resp-metric" title="Body size">{shown() ? formatBytes(shown()!.bodySize) : ""}</span>
        </div>
      </div>

      <div class="response-content">
        <Show when={!props.tab.sending && props.tab.unresolved.length > 0}>
          <p class="notice unresolved-banner" role="status">
            Unresolved variables: {props.tab.unresolved.join(", ")} <span class="muted">(sent literally)</span>
          </p>
        </Show>
        <Switch fallback={<p class="placeholder response-empty">Send the request to see the response.</p>}>
          <Match when={props.tab.sending}>
            <p class="placeholder response-empty">Sending…</p>
          </Match>
          <Match when={props.tab.responseError}>
            <div class="error response-error" role="alert">
              <strong>Request failed</strong>
              <span>{props.tab.responseError}</span>
            </div>
          </Match>
          <Match when={shown()}>
            {(resp) => (
              <>
                <Show when={resp().truncated}>
                  <p class="notice">Body truncated: showing the first 256 KB of {formatBytes(resp().bodySize)}.</p>
                </Show>
                <Switch>
                  <Match when={props.tab.responseSection === "headers"}>
                    <div class="response-headers" onContextMenu={(e) => {
                      if (responseMenuKind({ hasResponse: true, section: "headers", view: view() }) !== "headers") return;
                      e.preventDefault();
                      const tr = (e.target as HTMLElement).closest<HTMLTableRowElement>("tr[data-row]");
                      setHeaderMenu({ x: e.clientX, y: e.clientY, row: tr ? Number(tr.dataset.row) : undefined });
                    }}>
                      <table class="table">
                        <tbody>
                          <For each={resp().headers}>
                            {(h, i) => <tr data-row={i()}><td class="header-key">{h.key}</td><td class="header-value">{h.value}</td></tr>}
                          </For>
                        </tbody>
                      </table>
                    </div>
                  </Match>
                  <Match when={view() === "preview"}>
                    {/* Sandboxed: see previewFrameAttrs (empty sandbox = no scripts, opaque origin). */}
                    <iframe class="response-preview" {...previewFrameAttrs(resp().body)} />
                  </Match>
                  <Match when={true}>
                    <ResponseBody text={bodyText(resp(), view())}
                      structured={view() === "pretty" && hasStructure(resp())}
                      fallbackNotice={view() === "pretty" && prettyFallback(resp())}
                      wrap={responseWrap()}
                      folds={view() === "pretty" ? props.tab.responseFolds : undefined}
                      onFolds={(f) => view() === "pretty" && props.onView((t) => (t.responseFolds = f))}
                      ref={(api) => (body = api)} />
                  </Match>
                </Switch>
              </>
            )}
          </Match>
        </Switch>
      </div>
      <Show when={headerMenu()}>
        {(m) => <ContextMenu x={m().x} y={m().y} label="Response headers" items={headerItems(m().row)} onClose={() => setHeaderMenu(undefined)} />}
      </Show>
      <Show when={toast()}>
        {(t) => (
          <div classList={{ "response-toast": true, error: !t().ok }} role="status">
            <span>{t().text}</span>
            <button type="button" class="response-toast-close" aria-label="Dismiss" onClick={() => setToast(undefined)}>
              <Icon name="close" size={14} />
            </button>
          </div>
        )}
      </Show>
    </section>
  );
}
