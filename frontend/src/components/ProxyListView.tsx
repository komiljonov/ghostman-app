import { For, Show } from "solid-js";
import { CreateProxy } from "../../wailsjs/go/main/App";
import { main } from "../../wailsjs/go/models";
import { proxies, proxiesError, proxyGlobal, reloadProxies } from "../proxyStore";
import FormError from "./FormError";
import InlineCreateForm from "./InlineCreateForm";
import ProxyItem from "./ProxyItem";

interface Props {
  projectId: string;
  onOpenProxy: (id: string, name: string) => void;
}

// The "Proxies" tab (project switcher → Manage proxies…): create, rename,
// reorder and delete the project's proxies; clicking one opens it in its own tab.
// A new proxy starts as http on localhost:3128, ready to edit.
export default function ProxyListView(props: Props) {
  return (
    <div class="env-manage">
      <div class="pane-kicker">Proxies</div>
      <div class="env-list wide">
        <FormError message={proxiesError()} />
        <Show when={proxies().length > 0} fallback={<p class="placeholder small">No proxies yet — create one</p>}>
          <ul>
            <For each={proxies()}>
              {(p, i) => (
                <ProxyItem projectId={props.projectId} proxy={p} isGlobal={proxyGlobal() === p.id}
                  first={i() === 0} last={i() === proxies().length - 1}
                  onOpen={() => props.onOpenProxy(p.id, p.name)} onChanged={() => void reloadProxies()} />
              )}
            </For>
          </ul>
        </Show>
        <InlineCreateForm label="+ New proxy" placeholder="Proxy name"
          create={(name) => CreateProxy(props.projectId, main.ProxyInput.createFrom({
            name, proxy_type: "http", host: "localhost", port: 3128, username: "", bypass: "",
          }))}
          onCreated={async (id) => {
            await reloadProxies();
            const p = proxies().find((x) => x.id === id);
            if (p) props.onOpenProxy(p.id, p.name);
          }} />
        <p class="muted small">
          Requests and folders pick a proxy in their Settings; the project's global default is in Settings → Proxy.
          Proxy details are shared with the team; passwords stay on each machine.
        </p>
      </div>
    </div>
  );
}
