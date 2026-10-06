import { For, Match, Show, Switch } from "solid-js";
import { BODY_VIEWS, bodyText, effectiveView, previewFrameAttrs, toolbarControls, viewAvailability } from "../responseView";
import { TabState } from "../tabsController";
import { responseWrap, setResponseWrap } from "../uiPrefs";
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
  const controls = () => toolbarControls({ hasResponse: !!shown(), section: props.tab.responseSection, view: view() });
  const views = () => viewAvailability(shown());

  return (
    <section class="response-view" aria-label="Response">
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
        <span class="toolbar-divider" aria-hidden="true" />
        <span class="resp-status">
          <Show when={shown()} fallback={<span class="muted">—</span>}>
            {(r) => <StatusBadge status={r().status} text={r().statusText} />}
          </Show>
        </span>
        <span class="resp-metric" title="Duration">{shown() ? `${shown()!.durationMs} ms` : ""}</span>
        <span class="resp-metric" title="Body size">{shown() ? formatBytes(shown()!.bodySize) : ""}</span>
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
                    <div class="response-headers">
                      <table class="table">
                        <tbody>
                          <For each={resp().headers}>
                            {(h) => <tr><td class="header-key">{h.key}</td><td class="header-value">{h.value}</td></tr>}
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
                    <pre classList={{ "response-body": true, wrap: responseWrap() }}>{bodyText(resp(), view())}</pre>
                  </Match>
                </Switch>
              </>
            )}
          </Match>
        </Switch>
      </div>
    </section>
  );
}
