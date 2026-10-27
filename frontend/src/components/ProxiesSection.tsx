import { createSignal, For, Show } from "solid-js";
import { CreateProxy, DeleteProxy, UpdateProxy } from "../../wailsjs/go/main/App";
import { api, main } from "../../wailsjs/go/models";
import { handleProblem } from "../authStore";
import { createAction } from "../action";
import { isGlobalDefault, setDefaultEntry } from "../proxySettings";
import { chooseGlobalProxy, proxies, proxiesError, proxiesLoaded, proxyGlobal, reloadProxies } from "../proxyStore";
import ConfirmDialog from "./ConfirmDialog";
import ContextMenu, { MenuEntry } from "./ContextMenu";
import FormError from "./FormError";
import Icon from "./Icon";

interface Props {
  projectId: string;
  onOpen: (id: string, name: string) => void;
  isOpen: (id: string) => boolean; // a tab is open for this proxy
  expanded: boolean; // state lives in SidebarPanels (persisted per project)
  onToggle: () => void;
  onExpand: () => void;
}

const inputOf = (p: api.Proxy) => main.ProxyInput.createFrom({
  name: p.name, proxy_type: p.proxy_type, host: p.host, port: p.port, username: p.username, bypass: p.bypass,
});

// The "Proxies" section of the sidebar's bottom area: the project's proxies
// (name · type chip · host:port; a dot on the global default) and "+" to create one
// (http on localhost:3128, then its tab opens to edit). Click opens the proxy's
// tab; the row menu has Open, Rename (inline), Set as global default (the
// per-project local setting) and Delete (confirm).
export default function ProxiesSection(props: Props) {
  const [creating, setCreating] = createSignal(false);
  const [newName, setNewName] = createSignal("");
  const [renamingId, setRenamingId] = createSignal<string>();
  const [renameDraft, setRenameDraft] = createSignal("");
  const [rowError, setRowError] = createSignal<string>();
  const [deleting, setDeleting] = createSignal<api.Proxy>();
  const [menu, setMenu] = createSignal<{ proxy: api.Proxy; x: number; y: number }>();

  const create = createAction((name: string) => CreateProxy(props.projectId, main.ProxyInput.createFrom({
    name, proxy_type: "http", host: "localhost", port: 3128, username: "", bypass: "",
  })));
  const startCreate = () => {
    props.onExpand();
    setCreating(true);
    create.setError(undefined);
  };
  const submitCreate = async (e: SubmitEvent) => {
    e.preventDefault();
    const result = await create.run(newName().trim());
    if (result?.data) {
      setNewName("");
      setCreating(false);
      await reloadProxies(); // never patched locally
      props.onOpen(result.data.id, result.data.name);
    }
  };

  let renamingBusy = false;
  const submitRename = async () => {
    const id = renamingId();
    const p = proxies().find((x) => x.id === id);
    if (!id || !p || renamingBusy) return;
    const name = renameDraft().trim();
    if (name === "" || name === p.name) return setRenamingId(undefined);
    renamingBusy = true;
    const result = await UpdateProxy(id, inputOf(p), main.ProxyInput.createFrom({ ...inputOf(p), name }));
    renamingBusy = false;
    handleProblem(result.error);
    setRowError(result.error?.message);
    if (!result.error) setRenamingId(undefined);
    await reloadProxies(); // the proxy's tab relabels through MainScreen's sync
  };

  const menuItems = (p: api.Proxy): MenuEntry[] => {
    const d = setDefaultEntry(p.id, proxyGlobal());
    return [
      { label: "Open", onSelect: () => props.onOpen(p.id, p.name) },
      { label: "Rename", icon: "pencil", onSelect: () => {
        setRowError(undefined);
        setRenameDraft(p.name);
        setRenamingId(p.id);
      } },
      { label: d.disabled ? "Global default" : "Set as global default", disabled: d.disabled,
        onSelect: () => void chooseGlobalProxy(p.id).then(setRowError) },
      "separator",
      { label: "Delete", icon: "trash", danger: true, onSelect: () => setDeleting(p) },
    ];
  };

  const count = () => proxies().length;

  return (
    <section classList={{ "panel-section": true, expanded: props.expanded }} aria-label="Proxies">
      <div class="hooks-bar">
        <button type="button" class="hooks-toggle" aria-expanded={props.expanded} onClick={() => props.onToggle()}
          title={props.expanded ? "Collapse proxies" : "Show proxies"}>
          <Icon name="chevron" class={props.expanded ? "hooks-chevron open" : "hooks-chevron"} size={14} />
          <span class="menu-heading">Proxies</span>
          <span class="hooks-count" aria-label={`${count()} proxies`}>{count()}</span>
        </button>
        <button type="button" class="row-menu-trigger add" aria-label="New proxy" title="New proxy" onClick={startCreate}>
          <Icon name="plus" />
        </button>
      </div>
      <Show when={props.expanded}>
        <div class="hooks-body">
          <Show when={creating()}>
            <form class="hooks-create" onSubmit={submitCreate}>
              <input type="text" placeholder="Proxy name, e.g. Corp proxy" aria-label="Proxy name" value={newName()}
                disabled={create.pending()} maxLength={100} ref={(el) => queueMicrotask(() => el.focus())}
                onInput={(e) => setNewName(e.currentTarget.value)}
                onKeyDown={(e) => {
                  if (e.key === "Escape") {
                    setCreating(false);
                    create.setError(undefined);
                  }
                }} />
              <div class="row">
                <button class="primary small-button" type="submit" disabled={create.pending() || newName().trim() === ""}>
                  {create.pending() ? "Creating…" : "Create"}
                </button>
                <button type="button" class="small-button" onClick={() => {
                  setCreating(false);
                  create.setError(undefined);
                }}>Cancel</button>
              </div>
              <FormError message={create.error()} />
            </form>
          </Show>
          <FormError message={rowError() || proxiesError()} />
          <Show when={proxiesLoaded()} fallback={<Show when={!proxiesError()}><p class="placeholder small tree-note">Loading…</p></Show>}>
            <Show when={count() > 0} fallback={
              <Show when={!creating()}>
                <p class="placeholder small tree-note">
                  No proxies yet — <button type="button" class="link-button" onClick={startCreate}>create one</button>
                </p>
              </Show>
            }>
              <ul class="hooks-list" aria-label="Proxies">
                <For each={proxies()}>
                  {(p) => (
                    <li classList={{ "hooks-row": true, "proxy-item-row": true, open: props.isOpen(p.id) }}
                      onClick={() => renamingId() !== p.id && props.onOpen(p.id, p.name)}
                      onContextMenu={(e) => {
                        e.preventDefault();
                        setMenu({ proxy: p, x: e.clientX, y: e.clientY });
                      }}>
                      <span class="proxy-type-chip">{p.proxy_type}</span>
                      <Show when={renamingId() === p.id} fallback={<span class="hooks-row-name" title={p.name}>{p.name}</span>}>
                        <input class="tree-rename" aria-label="New name" value={renameDraft()} maxLength={100}
                          ref={(el) => queueMicrotask(() => {
                            el.focus();
                            el.select();
                          })}
                          onClick={(e) => e.stopPropagation()}
                          onInput={(e) => setRenameDraft(e.currentTarget.value)}
                          onKeyDown={(e) => {
                            if (e.key === "Enter") void submitRename();
                            if (e.key === "Escape") setRenamingId(undefined);
                          }}
                          onBlur={() => void submitRename()} />
                      </Show>
                      <span class="proxy-row-addr muted small" title={`${p.host}:${p.port}`}>{p.host}:{p.port}</span>
                      <span classList={{ "default-marker": true, on: isGlobalDefault(p.id, proxyGlobal()) }}
                        title={isGlobalDefault(p.id, proxyGlobal()) ? "The project's global default (Settings → Proxy)" : undefined}
                        aria-label={isGlobalDefault(p.id, proxyGlobal()) ? "Global default" : undefined} />
                      <button type="button" class="row-menu-trigger" aria-label={`Actions for ${p.name}`} tabIndex={-1}
                        aria-haspopup="menu"
                        onClick={(e) => {
                          e.stopPropagation();
                          const r = e.currentTarget.getBoundingClientRect();
                          setMenu({ proxy: p, x: e.detail === 0 ? r.left : e.clientX, y: e.detail === 0 ? r.bottom : e.clientY });
                        }}>
                        <Icon name="dots" />
                      </button>
                    </li>
                  )}
                </For>
              </ul>
            </Show>
          </Show>
        </div>
      </Show>
      <Show when={menu()}>
        {(m) => <ContextMenu x={m().x} y={m().y} label="Proxy actions" items={menuItems(m().proxy)} onClose={() => setMenu(undefined)} />}
      </Show>
      <Show when={deleting()}>
        {(p) => (
          <ConfirmDialog title="Delete proxy"
            message={`Delete “${p().name}” for everyone on the project? Requests and folders using it will fall back to inherit. Its password stored on this machine is removed too.`}
            confirmLabel="Delete proxy"
            action={() => DeleteProxy(p().id)}
            onDone={() => void reloadProxies()}
            onClose={() => setDeleting(undefined)} />
        )}
      </Show>
    </section>
  );
}
