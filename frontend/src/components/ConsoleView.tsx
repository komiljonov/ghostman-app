import { For, Show } from "solid-js";
import type { scripting } from "../../wailsjs/go/models";
import { consoleGroups } from "../consoleView";

interface Props {
  console: scripting.Console | undefined | null;
}

// A send's script output: one block per script (run order), its log lines and
// errors. Shared by the response pane's Console tab and the history detail.
export default function ConsoleView(props: Props) {
  return (
    <div class="console-view" role="log" aria-label="Script console">
      <Show when={consoleGroups(props.console).length > 0} fallback={<p class="placeholder small">No script output.</p>}>
        <For each={consoleGroups(props.console)}>
          {(g) => (
            <section class="console-group">
              <h4 class="console-owner">{g.label}</h4>
              <For each={g.entries}>
                {(e) => (
                  <pre classList={{ "console-line": true, [`console-${e.level}`]: true }}>{e.text}</pre>
                )}
              </For>
            </section>
          )}
        </For>
        <Show when={props.console?.truncated}>
          <p class="muted small">Output cut: a send keeps at most 500 console lines.</p>
        </Show>
      </Show>
    </div>
  );
}
