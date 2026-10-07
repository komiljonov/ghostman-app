import { createEffect, createSignal, onCleanup, onMount, Show } from "solid-js";
import type { LineEditorHandle } from "../codemirror";
import { envDisplay } from "../envStore";

interface Props {
  value: string;
  onChange: (text: string) => void;
  placeholder: string;
  ariaLabel: string;
  masked?: boolean; // password-style: literal text as bullets, {{vars}} stay visible
}

// A standalone single-line field with {{var}} highlighting and hover (the shared
// line-editor factory, like the URL bar). Until CodeMirror has loaded (lazy
// chunk) a plain input stands in; anything typed there carries over.
export default function VarField(props: Props) {
  let host!: HTMLDivElement;
  let editor: LineEditorHandle | undefined;
  const [ready, setReady] = createSignal(false);

  onMount(async () => {
    const { createLineEditor } = await import("../codemirror");
    if (!host.isConnected) return;
    editor = createLineEditor(host, props.value, {
      placeholder: props.placeholder,
      ariaLabel: props.ariaLabel,
      onChange: (text) => props.onChange(text),
      getEnv: envDisplay,
      masked: !!props.masked,
    });
    setReady(true);
  });
  createEffect(() => {
    envDisplay();
    if (ready()) editor?.refreshVars();
  });
  createEffect(() => {
    const m = !!props.masked;
    if (ready()) editor?.setMasked(m);
  });
  // Outside changes (a tab reload) apply, but never while the field is being typed in.
  createEffect(() => {
    const v = props.value;
    if (ready() && editor && !editor.hasFocus() && editor.getDoc() !== v) editor.setDoc(v);
  });
  onCleanup(() => editor?.destroy());

  return (
    <div class="var-field">
      <Show when={!ready()}>
        <input class="var-field-fallback" type={props.masked ? "password" : "text"} spellcheck={false}
          aria-label={props.ariaLabel} placeholder={props.placeholder} value={props.value}
          onInput={(e) => props.onChange(e.currentTarget.value)} />
      </Show>
      <div class="var-field-host" ref={host} />
    </div>
  );
}
