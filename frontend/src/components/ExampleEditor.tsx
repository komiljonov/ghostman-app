import { createSignal, onCleanup, onMount, Show } from "solid-js";
import { FormatJSONBody, GetExampleEditBody, UpdateExample } from "../../wailsjs/go/main/App";
import { main } from "../../wailsjs/go/models";
import { SaveState } from "../autosave";
import { handleProblem } from "../authStore";
import { FORMAT_SHORTCUT } from "../bodyFormat";
import type { PlainEditorHandle } from "../codemirror";
import { createExampleEditSaver, ExampleForm, formStatus } from "../examplesModel";
import { isJSONType } from "../responseView";
import type { Row } from "../rows";
import KeyValueEditor from "./KeyValueEditor";
import PlainEditor from "./PlainEditor";

interface Props {
  detail: main.ExampleDetail; // the example as last fetched
  onSaved: () => void; // re-fetch the list (name / status / size changed)
  onState: (state: SaveState, error?: string) => void; // the panel's SaveIndicator
  onSaver: (saver: { flush: () => Promise<void>; retry: () => Promise<void> }) => void;
}

// An example in EDIT mode: name, status, headers (the shared row table — PLAIN
// cells: {{vars}} are not special in a response), Content-Type and the body in a
// plain CodeMirror editor (JSON colors + Format / Alt+Shift+F when the type is
// JSON). Autosaved like everything else (600 ms, one save in flight); Go PATCHes
// only what changed. A binary body is not editable here (save it to a file).
export default function ExampleEditor(props: Props) {
  const d = props.detail;
  const [form, setForm] = createSignal<ExampleForm>({
    name: d.name, status: String(d.status), headers: d.headers.map((h) => ({ key: h.key, value: h.value, enabled: h.enabled })),
    content_type: d.content_type, body: null,
  });
  const [bodyNote, setBodyNote] = createSignal(d.text ? "Loading the body…" : "");
  const [formatHint, setFormatHint] = createSignal("");
  let savedStatus = d.status;
  let editor: PlainEditorHandle | undefined;

  const saver = createExampleEditSaver(form, {
    update: async (next) => {
      const r = await UpdateExample(d.id, main.ExampleInput.createFrom({ ...next, body: next.body ?? undefined }));
      handleProblem(r.error);
      if (r.data) {
        savedStatus = r.data.status;
        props.onSaved();
      }
      return { error: r.error };
    },
    onState: (s, e) => props.onState(s, e),
    savedStatus: () => savedStatus,
  });
  props.onSaver(saver);
  onCleanup(() => void saver.flush());

  onMount(async () => {
    if (!d.text) return;
    const r = await GetExampleEditBody(d.id);
    handleProblem(r.error);
    if (r.data) {
      setForm({ ...form(), body: r.data.text });
      setBodyNote("");
    } else {
      setBodyNote(r.error?.message ?? "could not load the body");
    }
  });

  const edit = (patch: Partial<ExampleForm>) => {
    setForm({ ...form(), ...patch });
    saver.change();
  };
  const json = () => isJSONType(form().content_type);
  const canFormat = () => json() && (form().body ?? "").trim() !== "";
  let formatting = false;
  const format = async () => {
    if (!editor || formatting || !canFormat()) return;
    const before = editor.getDoc();
    formatting = true;
    try {
      const res = await FormatJSONBody(before);
      if (res.error) {
        if (editor.getDoc() === before) setFormatHint(res.error.message);
      } else if (res.data) {
        editor.applyFormatted(before, res.data.formatted);
      }
    } finally {
      formatting = false;
    }
  };
  const statusInvalid = () => formStatus(form().status) === undefined;

  return (
    <div class="example-editor">
      <div class="example-fields">
        <label class="example-field">
          <span>Name</span>
          <input type="text" value={form().name} maxLength={100} aria-label="Example name"
            onInput={(e) => edit({ name: e.currentTarget.value })} />
        </label>
        <label class="example-field example-status">
          <span>Status</span>
          <input type="text" inputMode="numeric" value={form().status} maxLength={3} aria-label="Status code"
            aria-invalid={statusInvalid()} classList={{ invalid: statusInvalid() }}
            title={statusInvalid() ? "100–599 — not saved until valid" : undefined}
            onInput={(e) => edit({ status: e.currentTarget.value })} />
        </label>
        <label class="example-field example-ctype">
          <span>Content-Type</span>
          <input type="text" spellcheck={false} value={form().content_type} maxLength={200} aria-label="Content-Type"
            placeholder="e.g. application/json" onInput={(e) => edit({ content_type: e.currentTarget.value })} />
        </label>
      </div>
      <section class="example-section">
        <h4>Headers</h4>
        <KeyValueEditor kind="headers" plain rows={form().headers} keyPlaceholder="Header"
          onChange={(rows: Row[]) => edit({ headers: rows })} />
      </section>
      <section class="example-section example-body">
        <div class="example-body-bar">
          <h4>Body</h4>
          <span class="row-spacer" />
          <span class="format-hint" title={formatHint()} aria-live="polite">{formatHint()}</span>
          <span class="toolbar-slot" title={form().body === null ? "The body can't be edited as text" : canFormat()
            ? `Format JSON (${FORMAT_SHORTCUT})` : "Format needs a JSON Content-Type and a body"}>
            <button type="button" class="format-btn" disabled={!canFormat()} aria-label="Format JSON"
              onClick={() => {
                void format();
                editor?.focus();
              }}>Format</button>
          </span>
        </div>
        <Show when={form().body !== null} fallback={
          <p class="placeholder small">{bodyNote() || "A binary body can't be edited as text — save it to a file from View."}</p>
        }>
          <PlainEditor value={form().body ?? ""} json={json()} ariaLabel="Example body" placeholder="Response body"
            canFormat={canFormat()} onFormat={() => void format()} onEditor={(e) => (editor = e)}
            onChange={(text) => {
              setFormatHint("");
              edit({ body: text });
            }} />
        </Show>
      </section>
    </div>
  );
}
