import { For, Match, Switch } from "solid-js";
import { Body } from "../tabsController";
import { Row } from "../rows";
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

  return (
    <div class="body-editor">
      <div class="body-toolbar">
        <div class="segmented" role="radiogroup" aria-label="Body type">
          <For each={TYPES}>
            {(t) => (
              <button type="button" role="radio" aria-checked={props.body.type === t.id}
                classList={{ active: props.body.type === t.id }}
                onClick={() => props.onChange((b) => (b.type = t.id))}>{t.label}</button>
            )}
          </For>
        </div>
        {/* Always present (disabled when not applicable) so the toolbar never changes shape. */}
        <span class="toolbar-slot" title={isRaw() ? "Content-Type of the raw body" : "Applies to raw body"}>
          <select aria-label="Content type" value={preset()} disabled={!isRaw()} onChange={(e) => {
            const v = e.currentTarget.value;
            props.onChange((b) => (b.content_type = v === "custom" ? "" : v));
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
              props.onChange((b) => (b.content_type = v));
            }} />
        </span>
      </div>
      <Switch>
        <Match when={props.body.type === "none"}>
          <p class="placeholder small">This request has no body.</p>
        </Match>
        <Match when={props.body.type === "raw"}>
          <CodeEditor value={props.body.content} json={isJSON()}
            onChange={(text) => props.onChange((b) => (b.content = text))} />
        </Match>
        <Match when={props.body.type === "form"}>
          <KeyValueEditor kind="form" rows={props.body.fields} keyPlaceholder="Field"
            onChange={(rows: Row[]) => props.onChange((b) => (b.fields = rows))} />
        </Match>
      </Switch>
    </div>
  );
}
