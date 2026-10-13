import { createEffect, createSignal, onCleanup, onMount, Show } from "solid-js";
import type { PlainEditorHandle } from "../codemirror";

interface Props {
  value: string;
  json: boolean;
  onChange: (text: string) => void;
  ariaLabel: string;
  placeholder: string;
}

// A plain text editor (createPlainEditor: no {{var}} highlighting or completion).
// CodeMirror loads on first use; outside changes are applied when they differ.
export default function PlainEditor(props: Props) {
  let host!: HTMLDivElement;
  let editor: PlainEditorHandle | undefined;
  const [ready, setReady] = createSignal(false);

  onMount(async () => {
    const { createPlainEditor } = await import("../codemirror");
    if (!host.isConnected) return;
    editor = createPlainEditor(host, props.value, (text) => props.onChange(text),
      { ariaLabel: props.ariaLabel, placeholder: props.placeholder, json: props.json });
    setReady(true);
  });
  createEffect(() => {
    const v = props.value;
    if (ready() && editor && editor.getDoc() !== v) editor.setDoc(v);
  });
  createEffect(() => {
    const on = props.json;
    if (ready()) editor?.setJSON(on);
  });
  onCleanup(() => editor?.destroy());

  return (
    <div class="script-editor plain-editor">
      <Show when={!ready()}><p class="placeholder small code-loading">Loading editor…</p></Show>
      <div class="script-editor-host" ref={host} />
    </div>
  );
}
