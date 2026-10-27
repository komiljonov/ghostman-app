import { createSignal, For, Match, Show, Switch } from "solid-js";
import { PreviewJWT } from "../../wailsjs/go/main/App";
import { api } from "../../wailsjs/go/models";
import type { AuthConfig } from "../auth";
import { handleProblem } from "../authStore";
import { PreviewView, previewView } from "../jwtAuth";
import { currentProjectId } from "../workspaceStore";
import Dropdown from "./Dropdown";

interface Props {
  auth: AuthConfig; // this node's own JWT config (template form)
}

// "Preview token": Go signs the config exactly like a send would (same variables,
// {{$now}} claims) and returns the decoded header + payload and the token's ends.
// The secret's resolved value never crosses the bridge; the popover names the
// secret as written, with literal text masked. Re-fetched every time it opens.
export default function JwtPreview(props: Props) {
  const [view, setView] = createSignal<PreviewView>();
  let seq = 0;
  const load = async () => {
    const mine = ++seq;
    setView(undefined);
    const snapshot = props.auth;
    const res = await PreviewJWT(currentProjectId(), api.Auth.createFrom(snapshot));
    if (mine !== seq) return;
    handleProblem(res.error);
    setView(previewView({ data: res.data, error: res.error }, snapshot));
  };

  return (
    <Dropdown triggerLabel="Preview token" triggerClass="small-button jwt-preview-trigger" align="right" menuRole="dialog"
      menuClass="jwt-preview" onOpen={() => void load()} trigger={<span>Preview token</span>}>
      {() => (
        <div class="jwt-preview-body">
          <p class="jwt-preview-title">Token preview <span class="muted">— as it would be signed now</span></p>
          <Show when={view()} fallback={<p class="muted small">Signing…</p>}>
            {(v) => (
              <Switch>
                <Match when={v().kind === "error" && v() as Extract<PreviewView, { kind: "error" }>}>
                  {(e) => <p class="jwt-preview-error" role="alert">{e().message}</p>}
                </Match>
                <Match when={v().kind === "ok" && v() as Extract<PreviewView, { kind: "ok" }>}>
                  {(ok) => (
                    <>
                      <For each={ok().notes}>{(n) => <p class="jwt-preview-note small">{n}</p>}</For>
                      <h4>Header</h4>
                      <pre class="jwt-preview-json">{ok().header}</pre>
                      <h4>Payload</h4>
                      <pre class="jwt-preview-json">{ok().payload}</pre>
                      <dl class="jwt-preview-meta">
                        <dt>Token</dt>
                        <dd><code>{ok().token}</code></dd>
                        <dt>Secret</dt>
                        <dd><code>{ok().secret}</code> <span class="muted small">— the value is never shown</span></dd>
                      </dl>
                    </>
                  )}
                </Match>
              </Switch>
            )}
          </Show>
        </div>
      )}
    </Dropdown>
  );
}
