import { createEffect, createSignal, onCleanup, onMount, Show } from "solid-js";
import type { PlainEditorHandle } from "../codemirror";

interface Props {
  value: string;
  json: boolean;
  onChange: (text: string) => void;
  ariaLabel: string;
  placeholder: string;
  // Format JSON: Alt+Shift+F calls onFormat while canFormat; onEditor gets the
  // handle (to apply Go's result as one undoable change).
  canFormat?: boolean;
  onFormat?: () => void;
  onEditor?: (editor: PlainEditorHandle) => void;
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
    props.onEditor?.(editor);
  });
  createEffect(() => {
    const on = !!props.canFormat;
    if (ready()) editor?.setFormatter(on ? () => props.onFormat?.() : null);
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
