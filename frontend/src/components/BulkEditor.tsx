import { createEffect, createSignal, onCleanup, onMount, Show } from "solid-js";
import type { CodeEditorHandle } from "../codemirror";
import { parseBulk, serializeRows, textMeansRows } from "../bulkEdit";
import { envDisplay } from "../envStore";
import type { Row } from "../rows";

interface Props {
  rows: Row[];
  onChange: (rows: Row[]) => void;
  ariaLabel: string;
}

// The bulk text view of a key/value table (format: bulkEdit.ts): one multi-line
// editor from the shared factory, so {{var}} highlighting, hover and completion
// work as everywhere. Every edit is parsed straight back into rows, which ride
// the tab's debounced autosave like table edits. Outside changes (the URL bar
// rewriting params) replace the text only when it no longer means the rows, so
// typing — blank lines, spacing — is never rewritten.
export default function BulkEditor(props: Props) {
  let host!: HTMLDivElement;
  let editor: CodeEditorHandle | undefined;
  const [ready, setReady] = createSignal(false);

  onMount(async () => {
    const { createCodeEditor } = await import("../codemirror");
    if (!host.isConnected) return;
    editor = createCodeEditor(host, serializeRows(props.rows), false, (text) => {
      if (!textMeansRows(text, props.rows)) props.onChange(parseBulk(text));
    }, envDisplay, { bulk: true }); // bulk: Ctrl+/ toggles "//" (disable / enable rows)
    host.querySelector(".cm-content")?.setAttribute("aria-label", props.ariaLabel);
    setReady(true);
  });
  createEffect(() => {
    const rows = props.rows;
    if (ready() && editor && !textMeansRows(editor.getDoc(), rows)) editor.setDoc(serializeRows(rows));
  });
  createEffect(() => {
    envDisplay();
    if (ready()) editor?.refreshVars();
  });
  onCleanup(() => editor?.destroy());

  return (
    <div class="bulk-editor">
      <Show when={!ready()}><p class="placeholder small code-loading">Loading editor…</p></Show>
      <div class="code-editor-host bulk-editor-host" ref={host} />
    </div>
  );
}
