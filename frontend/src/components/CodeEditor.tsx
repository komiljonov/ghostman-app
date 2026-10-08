import { createEffect, onCleanup, onMount, Show, createSignal } from "solid-js";
import type { CodeEditorHandle } from "../codemirror";
import { envDisplay } from "../envStore";

interface Props {
  value: string;
  json: boolean;
  onChange: (text: string) => void;
  // Format JSON: Ctrl/Cmd+Shift+F calls onFormat while canFormat (else the key is a no-op).
  canFormat?: boolean;
  onFormat?: () => void;
  // The editor handle, once CodeMirror has loaded (BodyEditor applies Format results).
  onEditor?: (editor: CodeEditorHandle) => void;
}

// Raw body editor. CodeMirror is loaded on first use (dynamic import) and the
// instance lives as long as this component; the document is owned by CodeMirror
// after mount (typing flows out through onChange).
export default function CodeEditor(props: Props) {
  let host!: HTMLDivElement;
  let editor: CodeEditorHandle | undefined;
  const [ready, setReady] = createSignal(false);

  onMount(async () => {
    const { createCodeEditor } = await import("../codemirror");
    if (!host.isConnected) return; // unmounted while loading
    editor = createCodeEditor(host, props.value, props.json, (text) => props.onChange(text), envDisplay);
    setReady(true);
    props.onEditor?.(editor);
  });
  createEffect(() => {
    const on = !!props.canFormat;
    if (ready()) editor?.setFormatter(on ? () => props.onFormat?.() : null);
  });
  createEffect(() => {
    const on = props.json;
    if (ready()) editor?.setJSON(on);
  });
  // Re-highlight {{vars}} when the active environment or its variables change.
  createEffect(() => {
    envDisplay();
    if (ready()) editor?.refreshVars();
  });
  onCleanup(() => editor?.destroy());

  // The host div must have no Solid-managed children: when the placeholder below
  // unmounts, Solid would clear the whole parent — CodeMirror's DOM included.
  return (
    <div class="code-editor">
      <Show when={!ready()}><p class="placeholder small code-loading">Loading editor…</p></Show>
      <div class="code-editor-host" ref={host} />
    </div>
  );
}
