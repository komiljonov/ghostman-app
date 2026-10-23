import { For, Show } from "solid-js";
import { choiceToSave, describeProxy, ProxyMode, proxyOptions, shownProxy } from "../proxySettings";
import { resolveProxyInTree } from "../settingsResolver";
import { proxies, proxyGlobal } from "../proxyStore";
import { currentTree } from "../treeStore";
import type { NodeProxy } from "../tree";

interface Props {
  nodeId: string; // the request or folder (labels resolve from it)
  value: NodeProxy; // its own setting (stored, or the modal's unsaved choice)
  onChange: (next: NodeProxy) => void;
  radioName: string;
  disabled?: boolean;
}

// The Proxy row of a request's Settings tab and a folder's Settings… modal:
// Inherit (live: what it resolves to, and from where) · Use global · No proxy ·
// Use proxy… (+ the project's proxies). A setting pointing at a deleted proxy
// shows as Inherit with a note — that is how it resolves.
export default function ProxySettingRow(props: Props) {
  const list = () => proxies();
  const shown = () => shownProxy(props.value, list());
  const options = () => proxyOptions(currentTree(), props.nodeId, proxyGlobal(), list());
  // The effective value with the row's (maybe unsaved) choice applied.
  const preview = () => {
    const known = (id: string) => list().some((p) => p.id === id);
    const r = resolveProxyInTree(currentTree(), props.nodeId, proxyGlobal(), known, props.value) ?? { proxyId: null, source: { kind: "global" as const } };
    return describeProxy(r, list());
  };

  const choose = (mode: ProxyMode, picked: string | null = shown().proxyId) => {
    const next = choiceToSave(mode, picked, list());
    if (next) props.onChange(next);
  };

  return (
    <fieldset class="request-setting proxy-setting" disabled={props.disabled}>
      <legend>Proxy</legend>
      <For each={options()}>
        {(o) => (
          <label class="choice">
            <input type="radio" name={props.radioName} value={o.mode} checked={shown().mode === o.mode}
              disabled={o.mode === "proxy" && list().length === 0}
              title={o.mode === "proxy" && list().length === 0 ? "This project has no proxies — Manage proxies… in the project menu" : undefined}
              onChange={() => choose(o.mode)} />
            {o.label}
            <Show when={o.mode === "proxy"}>
              <select aria-label="Proxy" class="proxy-pick" disabled={list().length === 0}
                value={shown().mode === "proxy" ? shown().proxyId ?? "" : ""}
                onChange={(e) => choose("proxy", e.currentTarget.value)}>
                <Show when={shown().mode !== "proxy"}><option value="">Choose a proxy</option></Show>
                <For each={list()}>{(p) => <option value={p.id}>{p.name}</option>}</For>
              </select>
            </Show>
          </label>
        )}
      </For>
      <Show when={shown().deleted}>
        <p class="request-setting-hint warn-text">The proxy this was set to has been deleted, so it inherits now.</p>
      </Show>
      <p class="request-setting-hint">
        Effective: <strong>{preview()}</strong>. The global default is per project, in Settings → Proxy (this machine).
      </p>
    </fieldset>
  );
}
