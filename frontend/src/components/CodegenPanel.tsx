import { createEffect, createSignal, For, onCleanup, onMount, Show } from "solid-js";
import { ClipboardSetText } from "../../wailsjs/runtime/runtime";
import { handleProblem } from "../authStore";
import { controlsFor, createSnippetRunner, RunnerState, SECRETS_NOTE } from "../codegenModel";
import { codegenOptions, codegenPrefs, codegenTargets, loadCodegenPrefs, setCodegenPrefs } from "../codegenStore";
import type { SnippetViewHandle } from "../snippetView";
import type { TabsController } from "../tabsController";
import Icon from "./Icon";
import Modal from "./Modal";

interface Props {
  requestId: string;
  controller: TabsController;
  onClose: () => void;
}

// The "</>" panel: the request as a snippet (Go builds it from the send pipeline:
// codegen.go). Language picker, the values toggle (resolved — secrets and a signed
// JWT inlined — or {{variables}}), curl's line mode and proxy option (disabled
// for the other languages, never hidden), the read-only preview with the
// language's highlighting, Go's warnings under it, and Copy — exactly the preview.
// Every choice persists (codegenStore) and re-renders at once (codegenModel).
export default function CodegenPanel(props: Props) {
  const [state, setState] = createSignal<RunnerState>({ loading: true });
  const [copied, setCopied] = createSignal(false);
  let host!: HTMLDivElement;
  let view: SnippetViewHandle | undefined;
  const runner = createSnippetRunner(async (p) => {
    const r = await props.controller.generateCode(props.requestId, codegenOptions(p));
    handleProblem(r.error ?? undefined);
    return r;
  }, setState);

  const proxyResolved = () => !!props.controller.proxyOf(props.requestId);
  const controls = () => controlsFor(codegenPrefs().target, proxyResolved());

  // The preview's module and the persisted choices load first; then every choice
  // re-renders (effects created here, synchronously, so they belong to the panel).
  const [ready, setReady] = createSignal(false);
  onMount(async () => {
    const m = await import("../snippetView");
    await loadCodegenPrefs();
    view = m.createSnippetView(host, "Code snippet");
    setReady(true);
  });
  createEffect(() => {
    if (ready()) void runner.run(codegenPrefs());
  });
  createEffect(() => {
    const s = state().snippet;
    if (ready() && s) view?.set(s.snippet, s.language);
  });
  onCleanup(() => view?.destroy());

  const copy = async () => {
    const text = runner.copyText();
    if (text === undefined) return;
    await ClipboardSetText(text);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  return (
    <Modal title="Code" class="codegen-modal" onClose={props.onClose}>
      <div class="codegen-controls">
        <div class="segmented small" role="radiogroup" aria-label="Language">
          <For each={codegenTargets()}>
            {(t) => (
              <button type="button" role="radio" aria-checked={codegenPrefs().target === t.id}
                classList={{ active: codegenPrefs().target === t.id }}
                onClick={() => setCodegenPrefs({ target: t.id })}>{t.label}</button>
            )}
          </For>
        </div>
        <div class="segmented small" role="radiogroup" aria-label="Values">
          <button type="button" role="radio" aria-checked={codegenPrefs().resolved} classList={{ active: codegenPrefs().resolved }}
            title="Real values: variables resolved from the active environment (secrets included), a JWT signed now"
            onClick={() => setCodegenPrefs({ resolved: true })}>Resolved values</button>
          <button type="button" role="radio" aria-checked={!codegenPrefs().resolved} classList={{ active: !codegenPrefs().resolved }}
            title="Template form: {{variables}} as written, a JWT as a placeholder"
            onClick={() => setCodegenPrefs({ resolved: false })}>{"Keep {{variables}}"}</button>
        </div>
        <span class="toolbar-slot" title={controls().lineMode.title}>
          <div class="segmented small" role="radiogroup" aria-label="curl lines">
            <button type="button" role="radio" disabled={!controls().lineMode.enabled} aria-checked={!codegenPrefs().one_line}
              classList={{ active: controls().lineMode.enabled && !codegenPrefs().one_line }}
              onClick={() => setCodegenPrefs({ one_line: false })}>Multiline</button>
            <button type="button" role="radio" disabled={!controls().lineMode.enabled} aria-checked={codegenPrefs().one_line}
              classList={{ active: controls().lineMode.enabled && codegenPrefs().one_line }}
              onClick={() => setCodegenPrefs({ one_line: true })}>One line</button>
          </div>
        </span>
        <label classList={{ "choice small": true, disabled: !controls().proxy.enabled }} title={controls().proxy.title}>
          <input type="checkbox" checked={controls().proxy.enabled && codegenPrefs().proxy} disabled={!controls().proxy.enabled}
            onChange={(e) => setCodegenPrefs({ proxy: e.currentTarget.checked })} />
          Proxy (-x)
        </label>
      </div>
      <p class="codegen-secrets small" aria-live="polite">
        <Show when={state().snippet?.secrets}>
          <Icon name="lock" size={12} /> {SECRETS_NOTE}
        </Show>
      </p>
      <div classList={{ "codegen-preview": true, loading: state().loading }} ref={host} />
      <Show when={state().error}>
        <p class="form-error">{state().error}</p>
      </Show>
      <ul class="codegen-warnings muted small" aria-label="Notes">
        <For each={state().snippet?.warnings ?? []}>{(w) => <li>{w}</li>}</For>
      </ul>
      <div class="modal-actions">
        <Show when={copied()}><span class="history-saved small" role="status"><Icon name="check-circle" size={14} /> Copied</span></Show>
        <button type="button" onClick={() => props.onClose()}>Close</button>
        <button type="button" class="primary" disabled={state().loading || !state().snippet} onClick={() => void copy()}>Copy</button>
      </div>
    </Modal>
  );
}
