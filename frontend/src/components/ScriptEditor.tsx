import { createEffect, createSignal, onCleanup, onMount, Show } from "solid-js";
import type { ScriptEditorHandle } from "../codemirror";

interface Props {
  value: string;
  onChange: (text: string) => void;
  ariaLabel: string;
  placeholder: string;
}

// A JavaScript editor for a pre-request / post-response script (createScriptEditor:
// no {{var}} highlighting). CodeMirror loads on first use; the document is owned by
// it after mount, outside changes (another tab, a reload) are applied when they differ.
export default function ScriptEditor(props: Props) {
  let host!: HTMLDivElement;
  let editor: ScriptEditorHandle | undefined;
  const [ready, setReady] = createSignal(false);

  onMount(async () => {
    const { createScriptEditor } = await import("../codemirror");
    if (!host.isConnected) return;
    editor = createScriptEditor(host, props.value, (text) => props.onChange(text),
      { ariaLabel: props.ariaLabel, placeholder: props.placeholder });
    setReady(true);
  });
  createEffect(() => {
    const v = props.value;
    if (ready() && editor && editor.getDoc() !== v) editor.setDoc(v);
  });
  onCleanup(() => editor?.destroy());

  return (
    <div class="script-editor">
      <Show when={!ready()}><p class="placeholder small code-loading">Loading editor…</p></Show>
      <div class="script-editor-host" ref={host} />
    </div>
  );
}
