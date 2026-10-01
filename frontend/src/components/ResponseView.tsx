import { For, Match, Show, Switch } from "solid-js";
import { TabState } from "../tabsController";
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
export default function ResponseView(props: Props) {
  return (
    <section class="response-view" aria-label="Response">
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
        <Match when={props.tab.response}>
          {(resp) => (
            <>
              <div class="response-toolbar">
                <StatusBadge status={resp().status} text={resp().statusText} />
                <span>{resp().durationMs} ms</span>
                <span>{formatBytes(resp().bodySize)}</span>
                <span class="row-spacer" />
                <div class="segmented small" role="tablist">
                  <button type="button" role="tab" classList={{ active: props.tab.responseSection === "body" }}
                    onClick={() => props.onView((t) => (t.responseSection = "body"))}>Body</button>
                  <button type="button" role="tab" classList={{ active: props.tab.responseSection === "headers" }}
                    onClick={() => props.onView((t) => (t.responseSection = "headers"))}>
                    Headers <span class="muted">{resp().headers.length}</span>
                  </button>
                </div>
                <Show when={props.tab.responseSection === "body"}>
                  <label class="choice small">
                    <input type="checkbox" checked={props.tab.wrap} onChange={() => props.onView((t) => (t.wrap = !t.wrap))} />
                    Wrap
                  </label>
                </Show>
              </div>
              <Show when={resp().truncated}>
                <p class="notice">Body truncated: showing the first 256 KB of {formatBytes(resp().bodySize)}.</p>
              </Show>
              <Show when={props.tab.responseSection === "body"} fallback={
                <div class="response-headers">
                  <table class="table">
                    <tbody>
                      <For each={resp().headers}>
                        {(h) => <tr><td class="header-key">{h.key}</td><td class="header-value">{h.value}</td></tr>}
                      </For>
                    </tbody>
                  </table>
                </div>
              }>
                <pre classList={{ "response-body": true, wrap: props.tab.wrap }}>{resp().body}</pre>
              </Show>
            </>
          )}
        </Match>
      </Switch>
    </section>
  );
}
