import { Match, Show, Switch } from "solid-js";
import { engine } from "../../wailsjs/go/models";
import StatusBadge from "./StatusBadge";

interface Props {
  response: engine.Response | undefined;
  error: string | undefined;
  loading: boolean;
}

function formatBytes(n: number): string {
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KB`;
  return `${(n / (1024 * 1024)).toFixed(1)} MB`;
}

export default function ResponsePane(props: Props) {
  return (
    <section class="response" aria-live="polite">
      <Switch fallback={<p class="placeholder">Enter a URL and press Send.</p>}>
        <Match when={props.loading}>
          <p class="placeholder">Sending request…</p>
        </Match>
        <Match when={props.error}>
          <div class="error" role="alert">
            <strong>Request failed</strong>
            <span>{props.error}</span>
          </div>
        </Match>
        <Match when={props.response}>
          {(resp) => (
            <>
              <div class="response-meta">
                <StatusBadge status={resp().status} text={resp().statusText} />
                <span>{resp().durationMs} ms</span>
                <span>{formatBytes(resp().bodySize)}</span>
                <span class="muted">{resp().proto}</span>
              </div>
              <Show when={resp().truncated}>
                <p class="notice">
                  Body truncated: showing the first 256 KB of {formatBytes(resp().bodySize)}.
                </p>
              </Show>
              <pre class="body">{resp().body}</pre>
            </>
          )}
        </Match>
      </Switch>
    </section>
  );
}
