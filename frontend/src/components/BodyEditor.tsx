import { createSignal, For, Match, Switch } from "solid-js";
import { Body } from "../tabsController";
import { Row } from "../rows";
import { formatGate } from "../bodyFormat";
import type { CodeEditorHandle } from "../codemirror";
import { FormatJSONBody } from "../../wailsjs/go/main/App";
import CodeEditor from "./CodeEditor";
import KeyValueEditor from "./KeyValueEditor";

interface Props {
  body: Body;
  onChange: (fn: (b: Body) => void) => void;
}

const TYPES = [
  { id: "none", label: "None" },
  { id: "raw", label: "Raw" },
  { id: "form", label: "Form (urlencoded)" },
];

const PRESETS = [
  { label: "JSON", value: "application/json" },
  { label: "Text", value: "text/plain" },
  { label: "XML", value: "application/xml" },
];

export default function BodyEditor(props: Props) {
  const preset = () => PRESETS.find((p) => p.value === props.body.content_type)?.value ?? "custom";
  const isRaw = () => props.body.type === "raw";
  const isJSON = () => props.body.content_type.toLowerCase().includes("json");

  // Format JSON (Ctrl/Cmd+Shift+F or the button): Go formats (internal/jsonfmt),
  // the editor applies it as one undoable change. A body that does not parse is
  // left alone and a muted hint names the position until the next edit.
  let editor: CodeEditorHandle | undefined;
  let formatting = false;
  const [hint, setHint] = createSignal("");
  const gate = () => formatGate(props.body);
  const change = (fn: (b: Body) => void) => {
    setHint("");
    props.onChange(fn);
  };
  const format = async () => {
    if (!editor || formatting || !gate().enabled) return;
    const before = editor.getDoc();
    formatting = true;
    try {
      const res = await FormatJSONBody(before);
      if (res.error) {
        if (editor.getDoc() === before) setHint(res.error.message);
      } else if (res.data) {
        editor.applyFormatted(before, res.data.formatted);
      }
    } finally {
      formatting = false;
    }
  };

  return (
    <div class="body-editor">
      <div class="body-toolbar">
        <div class="segmented" role="radiogroup" aria-label="Body type">
          <For each={TYPES}>
            {(t) => (
              <button type="button" role="radio" aria-checked={props.body.type === t.id}
                classList={{ active: props.body.type === t.id }}
                onClick={() => change((b) => (b.type = t.id))}>{t.label}</button>
            )}
          </For>
        </div>
        {/* Always present (disabled when not applicable) so the toolbar never changes shape. */}
        <span class="toolbar-slot" title={isRaw() ? "Content-Type of the raw body" : "Applies to raw body"}>
          <select aria-label="Content type" value={preset()} disabled={!isRaw()} onChange={(e) => {
            const v = e.currentTarget.value;
            change((b) => (b.content_type = v === "custom" ? "" : v));
          }}>
            <For each={PRESETS}>{(p) => <option value={p.value}>{p.label}</option>}</For>
            <option value="custom">Custom…</option>
          </select>
        </span>
        <span class="toolbar-slot" title={!isRaw() ? "Applies to raw body" : preset() === "custom" ? "" : "Pick Custom… to type a content type"}>
          <input type="text" class="content-type-input" spellcheck={false} placeholder="content-type, e.g. text/csv"
            aria-label="Custom content type" disabled={!isRaw() || preset() !== "custom"}
            value={preset() === "custom" ? props.body.content_type : ""}
            onInput={(e) => {
              const v = e.currentTarget.value;
              change((b) => (b.content_type = v));
            }} />
        </span>
        {/* Always present, like every control here; the hint slot keeps its place too. */}
        <span class="format-hint" title={hint()} aria-live="polite">{hint()}</span>
        <span class="toolbar-slot" title={gate().reason}>
          <button type="button" class="format-btn" disabled={!gate().enabled} aria-label="Format JSON"
            onClick={() => {
              void format();
              editor?.focus();
            }}>Format</button>
        </span>
      </div>
      <Switch>
        <Match when={props.body.type === "none"}>
          <p class="placeholder small">This request has no body.</p>
        </Match>
        <Match when={props.body.type === "raw"}>
          <CodeEditor value={props.body.content} json={isJSON()}
            canFormat={gate().enabled} onFormat={() => void format()} onEditor={(e) => (editor = e)}
            onChange={(text) => change((b) => (b.content = text))} />
        </Match>
        <Match when={props.body.type === "form"}>
          <KeyValueEditor kind="form" rows={props.body.fields} keyPlaceholder="Field"
            onChange={(rows: Row[]) => change((b) => (b.fields = rows))} />
        </Match>
      </Switch>
    </div>
  );
}
