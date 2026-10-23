import { createEffect, createSignal, For } from "solid-js";
import { SetRequestFollowRedirects, SetRequestProxy } from "../../wailsjs/go/main/App";
import { ownProxy } from "../proxySettings";
import type { NodeProxy } from "../tree";
import ProxySettingRow from "./ProxySettingRow";
import { handleProblem } from "../authStore";
import { redirectDefault } from "../redirectDefault";
import { followOptions, FollowValue, ownFollow, resolveFollow, saveFollow } from "../requestSettings";
import { sourceLabel } from "../settingsResolver";
import { currentTree, requestTreeReload } from "../treeStore";
import FormError from "./FormError";

interface Props {
  requestId: string;
}

// The request's Settings sub-tab. Values cascade (request → folders → global,
// settingsResolver.ts); labels follow the tree store live, so a folder change, a
// move or the global toggle update them without reopening the tab. Saved on the
// server (shared with the team) right away.
export default function RequestSettingsPanel(props: Props) {
  const [pending, setPending] = createSignal<FollowValue>(); // shown while saving
  const [error, setError] = createSignal<string>();
  const own = () => pending() ?? ownFollow(currentTree(), props.requestId);
  const options = () => followOptions(currentTree(), props.requestId, redirectDefault());
  const effective = () => resolveFollow(currentTree(), props.requestId, redirectDefault());

  const choose = async (value: FollowValue) => {
    setPending(value);
    setError(undefined);
    const problem = await saveFollow(props.requestId, value, { set: SetRequestFollowRedirects, reload: () => void requestTreeReload() });
    handleProblem(problem);
    setError(problem?.message);
    if (problem) setPending(undefined); // back to what the server has
  };
  // The choice shows until the re-fetched tree carries it.
  createEffect(() => {
    if (pending() && ownFollow(currentTree(), props.requestId) === pending()) setPending(undefined);
  });

  // Proxy: saved at once (its own PATCH), then the tree is re-fetched.
  const [proxyPending, setProxyPending] = createSignal<NodeProxy>();
  const [proxyError, setProxyError] = createSignal<string>();
  const sameProxy = (a: NodeProxy, b: NodeProxy) => a.mode === b.mode && (a.proxyId ?? null) === (b.proxyId ?? null);
  const proxyValue = () => proxyPending() ?? ownProxy(currentTree(), props.requestId);
  const chooseProxy = async (next: NodeProxy) => {
    if (sameProxy(next, ownProxy(currentTree(), props.requestId))) return;
    setProxyPending(next);
    setProxyError(undefined);
    const r = await SetRequestProxy(props.requestId, next.mode, next.proxyId ?? "");
    handleProblem(r.error);
    setProxyError(r.error?.message);
    if (r.error) setProxyPending(undefined);
    else void requestTreeReload();
  };
  createEffect(() => {
    const p = proxyPending();
    if (p && sameProxy(ownProxy(currentTree(), props.requestId), p)) setProxyPending(undefined);
  });

  return (
    <div class="request-settings">
      <fieldset class="request-setting">
        <legend>Follow redirects</legend>
        <For each={options()}>
          {(o) => (
            <label class="choice">
              <input type="radio" name="follow-redirects" value={o.value} checked={own() === o.value}
                onChange={() => void choose(o.value)} />
              {o.label}
            </label>
          )}
        </For>
        <p class="request-setting-hint">
          Effective: <strong>{effective().value ? "redirects are followed" : "redirects are not followed"}</strong>
          {" "}({sourceLabel(effective().source)}).
          {" "}{effective().value
            ? "Up to 10; the timing panel shows every hop."
            : "A 3xx response is shown as it is, with its Location header."}
          {" "}Saved on the server for everyone on the project; the global setting is in Settings.
        </p>
        <FormError message={error()} />
      </fieldset>
      <ProxySettingRow nodeId={props.requestId} value={proxyValue()} onChange={(p) => void chooseProxy(p)} radioName="request-proxy" />
      <FormError message={proxyError()} />
    </div>
  );
}
