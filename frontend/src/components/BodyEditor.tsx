import { For, Match, Show, Switch } from "solid-js";
import { Body } from "../tabsController";
import { Row } from "../rows";
import CodeEditor from "./CodeEditor";
import KeyValueTable from "./KeyValueTable";

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
        <Show when={props.body.type === "raw"}>
          <select aria-label="Content type" value={preset()} onChange={(e) => {
            const v = e.currentTarget.value;
            props.onChange((b) => (b.content_type = v === "custom" ? "" : v));
          }}>
            <For each={PRESETS}>{(p) => <option value={p.value}>{p.label}</option>}</For>
            <option value="custom">Custom…</option>
          </select>
          <Show when={preset() === "custom"}>
            <input type="text" class="content-type-input" spellcheck={false} placeholder="content-type, e.g. text/csv"
              aria-label="Custom content type" value={props.body.content_type}
              onInput={(e) => {
                const v = e.currentTarget.value;
                props.onChange((b) => (b.content_type = v));
              }} />
          </Show>
        </Show>
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
          <KeyValueTable rows={props.body.fields} keyPlaceholder="Field"
            onChange={(rows: Row[]) => props.onChange((b) => (b.fields = rows))} />
        </Match>
      </Switch>
    </div>
  );
}
