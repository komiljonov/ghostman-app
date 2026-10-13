import { createResource, For, Show } from "solid-js";
import { groupDocs, scriptDocs, whereLabel } from "../scriptDocs";
import Dropdown from "./Dropdown";

// The ? popover next to the script editors: the gm API with one-line examples.
// The content comes from Go (scripting.APIDocs) — one source of truth.
export default function ScriptHelp() {
  const [docs] = createResource(scriptDocs);
  return (
    <Dropdown triggerLabel="Script API reference" triggerClass="script-help-trigger" align="right" menuRole="dialog"
      menuClass="script-help" trigger={<span aria-hidden="true">?</span>}>
      {() => (
        <div class="script-help-body">
          <p class="script-help-title">Script API <span class="muted">— synchronous JavaScript; no network, files or timers</span></p>
          <Show when={(docs() ?? []).length > 0} fallback={<p class="muted small">Loading…</p>}>
            <For each={groupDocs(docs() ?? [])}>
              {(g) => (
                <section class="script-help-group">
                  <h4>{g.group}</h4>
                  <For each={g.docs}>
                    {(d) => (
                      <div class="script-help-item">
                        <div class="script-help-usage">
                          <code>{d.usage}</code>
                          <Show when={whereLabel(d.where)}><span class="script-help-where">{whereLabel(d.where)}</span></Show>
                        </div>
                        <p class="muted small">{d.summary}</p>
                        <code class="script-help-example">{d.example}</code>
                      </div>
                    )}
                  </For>
                </section>
              )}
            </For>
          </Show>
        </div>
      )}
    </Dropdown>
  );
}
