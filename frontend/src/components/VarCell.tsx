import { batch, createEffect, createSignal, For, onCleanup, Show } from "solid-js";
import type { LineEditorHandle } from "../codemirror";
import { cellNeedsEditor } from "../cellMode";
import { envDisplay } from "../envStore";
import { segments } from "../vars";

interface Props {
  value: string;
  placeholder: string;
  ariaLabel: string;
  onChange: (text: string) => void;
}

// Preloaded as soon as any table renders, so the first focus mounts instantly.
let module: typeof import("../codemirror") | undefined;
const loading = import("../codemirror").then((m) => (module = m));

// A key/value table cell. Strategy (keeps 30+ row tables fast): it renders as a
// plain focusable div with {{var}} spans, and mounts a single-line CodeMirror
// editor only while focused, hovered, or editing a variable in its tooltip
// (cellMode.ts). Tab/Shift+Tab reach the div, which hands focus to the editor.
export default function VarCell(props: Props) {
  let host!: HTMLDivElement;
  let editor: LineEditorHandle | undefined;
  const [focused, setFocused] = createSignal(false);
  const [hovered, setHovered] = createSignal(false);
  const [tooltipOpen, setTooltipOpen] = createSignal(false);
  const [wantFocus, setWantFocus] = createSignal(false);
  const [mounted, setMounted] = createSignal(false);

  const mount = async () => {
    if (editor) return;
    if (!module) await loading;
    if (editor || !host.isConnected || !module) return;
    editor = module.createLineEditor(host, props.value, {
      placeholder: props.placeholder,
      ariaLabel: props.ariaLabel,
      onChange: (text) => props.onChange(text),
      onFocusChange: setFocused,
      onPin: setTooltipOpen,
      getEnv: envDisplay,
    });
    const focusNow = wantFocus();
    // One batch: removing the display div and dropping wantFocus must not leave a
    // moment where nothing "needs" the editor (CodeMirror reports focus async).
    batch(() => {
      setMounted(true);
      if (focusNow) {
        setFocused(true);
        setWantFocus(false);
      }
    });
    if (focusNow) {
      editor.focus();
      // If focus did not take (window in background), let the cell go back to plain.
      setTimeout(() => editor && !editor.hasFocus() && setFocused(false), 100);
    }
  };
  const unmount = () => {
    editor?.destroy();
    editor = undefined;
    setMounted(false);
  };

  createEffect(() => {
    const need = cellNeedsEditor({ focused: focused() || wantFocus(), hovered: hovered(), tooltipOpen: tooltipOpen() });
    if (need) void mount();
    else unmount();
  });
  // Rows can shift (a row above was removed): keep a mounted editor in sync, but
  // never overwrite what is being typed.
  createEffect(() => {
    const v = props.value;
    if (editor && !editor.hasFocus()) editor.setDoc(v);
  });
  createEffect(() => {
    envDisplay();
    editor?.refreshVars();
  });
  onCleanup(unmount);

  return (
    <div class="var-cell" onMouseEnter={() => setHovered(true)} onMouseLeave={() => setHovered(false)}>
      <Show when={!mounted()}>
        <div class="var-cell-display" tabIndex={0} role="textbox" aria-label={props.ariaLabel}
          onFocus={() => setWantFocus(true)}>
          <Show when={props.value} fallback={<span class="var-cell-placeholder">{props.placeholder}</span>}>
            <For each={segments(props.value, envDisplay())}>
              {(s) => (
                <span classList={{ "cm-var": s.kind !== "plain", "cm-var-resolved": s.kind === "resolved", "cm-var-unresolved": s.kind === "unresolved" }}>
                  {s.text}
                </span>
              )}
            </For>
          </Show>
        </div>
      </Show>
      {/* The CodeMirror host has no Solid-managed children (see CodeEditor). */}
      <div class="var-cell-host" ref={host} />
    </div>
  );
}
