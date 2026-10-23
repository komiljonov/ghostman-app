import { createSignal, Show } from "solid-js";
import { DeleteProxy, MoveProxy, UpdateProxy } from "../../wailsjs/go/main/App";
import { api, main } from "../../wailsjs/go/models";
import { createAction } from "../action";
import ConfirmDialog from "./ConfirmDialog";
import Icon from "./Icon";

interface Props {
  projectId: string;
  proxy: api.Proxy;
  isGlobal: boolean;
  first: boolean;
  last: boolean;
  onOpen: () => void;
  onChanged: () => void;
}

const inputOf = (p: api.Proxy) => main.ProxyInput.createFrom({
  name: p.name, proxy_type: p.proxy_type, host: p.host, port: p.port, username: p.username, bypass: p.bypass,
});

// One proxy in the "Proxies" tab: open, rename inline, reorder, delete.
export default function ProxyItem(props: Props) {
  const [editing, setEditing] = createSignal(false);
  const [name, setName] = createSignal("");
  const [confirmDelete, setConfirmDelete] = createSignal(false);
  const rename = createAction((next: string) => UpdateProxy(props.proxy.id, inputOf(props.proxy), main.ProxyInput.createFrom({ ...inputOf(props.proxy), name: next })));
  const move = createAction(MoveProxy);

  const submit = async () => {
    const next = name().trim();
    if (!next || next === props.proxy.name) {
      setEditing(false);
      return;
    }
    const result = await rename.run(next);
    if (result && !result.error) {
      setEditing(false);
      props.onChanged();
    }
  };
  const doMove = async (offset: number) => {
    const result = await move.run(props.projectId, props.proxy.id, offset);
    if (result && !result.error) props.onChanged();
  };

  return (
    <li class="env-item">
      <Show when={editing()} fallback={
        <button type="button" class="env-name" onClick={() => props.onOpen()}>
          {props.proxy.name}
          <span class="muted small proxy-item-addr">{props.proxy.proxy_type}://{props.proxy.host}:{props.proxy.port}</span>
          <Show when={props.isGlobal}><span class="badge">global default</span></Show>
        </button>
      }>
        <input type="text" class="env-rename" aria-label="Proxy name" value={name()} autofocus maxLength={100}
          disabled={rename.pending()} onInput={(e) => setName(e.currentTarget.value)}
          onBlur={() => void submit()}
          onKeyDown={(e) => {
            if (e.key === "Enter") void submit();
            if (e.key === "Escape") setEditing(false);
          }} />
      </Show>
      <div class="env-actions">
        <button type="button" class="small-button" title="Rename" aria-label={`Rename ${props.proxy.name}`} onClick={() => {
          setName(props.proxy.name);
          rename.setError(undefined);
          setEditing(true);
        }}><Icon name="pencil" size={14} /></button>
        <button type="button" class="small-button" title="Move up" aria-label="Move up" disabled={props.first || move.pending()}
          onClick={() => void doMove(-1)}>↑</button>
        <button type="button" class="small-button" title="Move down" aria-label="Move down" disabled={props.last || move.pending()}
          onClick={() => void doMove(1)}>↓</button>
        <button type="button" class="icon-button" title="Delete" aria-label={`Delete ${props.proxy.name}`}
          onClick={() => setConfirmDelete(true)}><Icon name="trash" size={14} /></button>
      </div>
      <Show when={rename.error() || move.error()}><p class="inline-error">{rename.error() || move.error()}</p></Show>
      <Show when={confirmDelete()}>
        <ConfirmDialog
          title="Delete proxy"
          message={`Delete "${props.proxy.name}" for everyone on the project? Requests and folders using it will fall back to inherit. Its password stored on this machine is removed too.`}
          confirmLabel="Delete proxy"
          action={() => DeleteProxy(props.proxy.id)}
          onDone={props.onChanged}
          onClose={() => setConfirmDelete(false)}
        />
      </Show>
    </li>
  );
}
