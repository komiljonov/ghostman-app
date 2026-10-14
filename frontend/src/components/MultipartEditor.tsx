import { createEffect, For, on, onCleanup, Show } from "solid-js";
import { editPart, fileLines, mergeTextRows, Part, textRows } from "../multipart";
import { chooseLocalFile, clearLocalFile, loadLocalFiles, localFile, renameLocalFile } from "../requestFiles";
import { bulkMode, setBulkMode } from "../uiPrefs";
import BulkEditor from "./BulkEditor";
import Icon from "./Icon";
import MultipartTable from "./MultipartTable";

interface Props {
  requestId: string;
  parts: Part[];
  onChange: (parts: Part[]) => void;
}

// Form-data (multipart) body: the row table with Text | File rows, or the bulk
// text view (the same global preference as the urlencoded form). In bulk mode
// file rows are READ-ONLY — listed as `key: [file] name` above the editor and
// never parsed from text; text rows edit as usual. Choosing a file stores its
// path on this machine (Go) and sets the row's display name, which the autosave
// PATCHes; clearing removes both.
export default function MultipartEditor(props: Props) {
  const bulk = () => bulkMode("form");
  createEffect(on(() => props.requestId, (id) => void loadLocalFiles(id)));
  // Coming back to the app is when files get moved or deleted meanwhile.
  const onFocus = () => void loadLocalFiles(props.requestId);
  window.addEventListener("focus", onFocus);
  onCleanup(() => window.removeEventListener("focus", onFocus));

  const choose = async (index: number): Promise<string | undefined> => {
    const key = props.parts[index]?.key ?? "";
    const r = await chooseLocalFile(props.requestId, key);
    if (r.error) return r.error;
    if (r.name !== undefined) {
      const at = props.parts.findIndex((p, i) => i === index && p.key === key);
      if (at >= 0) props.onChange(editPart(props.parts, at, { file_name: r.name }));
    }
    return undefined;
  };
  const clear = (index: number) => {
    const key = props.parts[index]?.key ?? "";
    props.onChange(editPart(props.parts, index, { file_name: "" }));
    if (key.trim() !== "") void clearLocalFile(props.requestId, key);
  };

  return (
    <div class="kv-editor">
      <div class="kv-editor-bar">
        <span class="kv-editor-hint muted small">
          <Show when={bulk()}>One <code>key:value</code> per line · <code>//key:value</code> = disabled · file fields are edited in the table</Show>
        </span>
        <button type="button" class="link-button kv-editor-toggle" aria-pressed={bulk()}
          title={bulk() ? "Back to the key / value table" : "Edit the text fields as text (key:value per line)"}
          onClick={() => setBulkMode("form", !bulk())}>
          {bulk() ? "Key-value edit" : "Bulk edit"}
        </button>
      </div>
      <Show when={bulk()} fallback={
        <MultipartTable parts={props.parts} onChange={(p) => props.onChange(p)}
          local={(key) => localFile(props.requestId, key)}
          onChoose={choose} onClear={clear}
          onFileKey={(from, to) => void renameLocalFile(props.requestId, from, to)}
          onRemoveFile={(key) => void clearLocalFile(props.requestId, key)} />
      }>
        <Show when={fileLines(props.parts).length > 0}>
          <div class="bulk-file-lines" aria-label="File fields (read-only here)" title="File fields are chosen in the table (Key-value edit)">
            <For each={fileLines(props.parts)}>
              {(line) => <div class="bulk-file-line"><Icon name="lock" size={12} /><code>{line}</code></div>}
            </For>
          </div>
        </Show>
        <BulkEditor rows={textRows(props.parts)} ariaLabel="Form-data text fields (bulk edit)"
          onChange={(rows) => props.onChange(mergeTextRows(props.parts, rows))} />
      </Show>
    </div>
  );
}
