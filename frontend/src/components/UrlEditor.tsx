import { createEffect, createSignal, onCleanup, onMount, Show } from "solid-js";
import type { LineEditorHandle } from "../codemirror";
import { envDisplay } from "../envStore";

interface Props {
  value: string;
  onChange: (text: string) => void;
  onEnter: () => void;
}

// The URL field: a single-line CodeMirror editor so {{vars}} are highlighted and
// hoverable. Until CodeMirror has loaded (lazy chunk) a plain input stands in and
// anything typed there carries over.
export default function UrlEditor(props: Props) {
  let host!: HTMLDivElement;
  let editor: LineEditorHandle | undefined;
  const [ready, setReady] = createSignal(false);

  onMount(async () => {
    const { createLineEditor } = await import("../codemirror");
    if (!host.isConnected) return;
    editor = createLineEditor(host, props.value, {
      placeholder: "https://api.example.com/resource — use {{VARIABLE}} for environment values",
      onChange: (text) => props.onChange(text),
      onEnter: () => props.onEnter(),
      getEnv: envDisplay,
    });
    setReady(true);
  });
  createEffect(() => {
    envDisplay();
    if (ready()) editor?.refreshVars();
  });
  onCleanup(() => editor?.destroy());

  // As with CodeEditor, the CodeMirror host has no Solid-managed children.
  return (
    <div class="url-editor">
      <Show when={!ready()}>
        <input class="url" type="text" spellcheck={false} aria-label="URL" value={props.value}
          onInput={(e) => props.onChange(e.currentTarget.value)}
          onKeyDown={(e) => e.key === "Enter" && (e.preventDefault(), props.onEnter())} />
      </Show>
      <div class="url-editor-host" ref={host} />
    </div>
  );
}
