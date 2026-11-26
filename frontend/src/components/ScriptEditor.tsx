import { createEffect, createSignal, onCleanup, onMount, Show } from "solid-js";
import type { ScriptEditorHandle } from "../codemirror";
import { envDisplay } from "../envStore";
import { clampScriptHeight, SCRIPT_HEIGHT_DEFAULT, shownScriptHeight, storedScriptHeight } from "../scriptResize";
import { saveScriptHeight, scriptHeight, ScriptKind } from "../uiPrefs";

interface Props {
  kind: ScriptKind; // pre-request | post-response: completion / hover context and the saved height
  value: string;
  onChange: (text: string) => void;
  ariaLabel: string;
  placeholder: string;
}

// The pane the editor scrolls in (the Scripts sub-tab's section, the folder modal):
// its height bounds the editor's (60 %).
function paneOf(el: HTMLElement): HTMLElement {
  for (let a = el.parentElement; a; a = a.parentElement) {
    if (/(auto|scroll)/.test(getComputedStyle(a).overflowY)) return a;
  }
  return document.documentElement;
}

// A JavaScript editor for a pre-request / post-response script (createScriptEditor:
// no {{var}} highlighting; gm.* completion + hover docs for its phase, env keys in
// gm.environment.get("…). CodeMirror loads on first use; the document is owned by
// it after mount, outside changes (another tab, a reload) are applied when they
// differ. The handle under it drags the height (scriptResize.ts): live while
// dragging (style only), saved on release; double-click resets to the default.
export default function ScriptEditor(props: Props) {
  let host!: HTMLDivElement;
  let editor: ScriptEditorHandle | undefined;
  const [ready, setReady] = createSignal(false);
  const [dragging, setDragging] = createSignal(false);

  onMount(async () => {
    const { createScriptEditor } = await import("../codemirror");
    if (!host.isConnected) return;
    editor = createScriptEditor(host, props.value, (text) => props.onChange(text),
      { ariaLabel: props.ariaLabel, placeholder: props.placeholder, phase: props.kind, getEnv: envDisplay });
    setReady(true);
  });
  createEffect(() => {
    const v = props.value;
    if (ready() && editor && editor.getDoc() !== v) editor.setDoc(v);
  });
  onCleanup(() => editor?.destroy());

  // The saved height (clamped to the pane as it is now), applied whenever it changes.
  const apply = (px: number) => (host.style.height = `${px}px`);
  createEffect(() => {
    const stored = scriptHeight(props.kind);
    if (!dragging()) apply(shownScriptHeight(stored, paneOf(host).clientHeight));
  });

  const startDrag = (e: PointerEvent) => {
    if (e.button !== 0) return;
    e.preventDefault();
    const handle = e.currentTarget as HTMLElement;
    handle.setPointerCapture(e.pointerId);
    const startY = e.clientY;
    const startH = host.getBoundingClientRect().height;
    const pane = paneOf(host).clientHeight;
    let h = startH;
    setDragging(true);
    const move = (ev: PointerEvent) => {
      h = clampScriptHeight(startH + ev.clientY - startY, pane);
      apply(h);
    };
    const up = () => {
      handle.removeEventListener("pointermove", move);
      handle.removeEventListener("pointerup", up);
      handle.removeEventListener("pointercancel", up);
      setDragging(false);
      if (Math.round(h) !== Math.round(startH)) saveScriptHeight(props.kind, storedScriptHeight(Math.round(h)));
    };
    handle.addEventListener("pointermove", move);
    handle.addEventListener("pointerup", up);
    handle.addEventListener("pointercancel", up);
  };

  return (
    <div class="script-editor">
      <Show when={!ready()}><p class="placeholder small code-loading">Loading editor…</p></Show>
      <div class="script-editor-host" ref={host} />
      <div class="script-resize" role="separator" aria-orientation="horizontal" aria-label={`Resize the ${props.kind === "pre" ? "pre-request" : "post-response"} script editor`}
        title="Drag to resize · double-click to reset" classList={{ dragging: dragging() }}
        onPointerDown={startDrag}
        onDblClick={() => {
          apply(clampScriptHeight(SCRIPT_HEIGHT_DEFAULT, paneOf(host).clientHeight));
          saveScriptHeight(props.kind, 0);
        }} />
    </div>
  );
}
