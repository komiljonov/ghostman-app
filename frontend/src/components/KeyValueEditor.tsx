import { Show } from "solid-js";
import type { BulkKind } from "../bulkEdit";
import type { Row } from "../rows";
import { bulkMode, setBulkMode } from "../uiPrefs";
import BulkEditor from "./BulkEditor";
import KeyValueTable from "./KeyValueTable";

interface Props {
  kind: BulkKind; // which global preference (params | headers | form) picks the view
  rows: Row[];
  onChange: (rows: Row[]) => void;
  keyPlaceholder?: string;
}

// A key/value table (params, headers, form fields) with its alternate bulk text
// view. The rows are the only data; the view is a global preference per kind.
// The toggle sits in a fixed bar above both views, right-aligned with a fixed
// width, so it does not move when toggled.
export default function KeyValueEditor(props: Props) {
  const bulk = () => bulkMode(props.kind);
  return (
    <div class="kv-editor">
      <div class="kv-editor-bar">
        <span class="kv-editor-hint muted small">
          <Show when={bulk()}>One <code>key:value</code> per line · <code>//key:value</code> = disabled (Ctrl+/ toggles)</Show>
        </span>
        <button type="button" class="link-button kv-editor-toggle" aria-pressed={bulk()}
          title={bulk() ? "Back to the key / value table" : "Edit all rows as text (key:value per line)"}
          onClick={() => setBulkMode(props.kind, !bulk())}>
          {bulk() ? "Key-value edit" : "Bulk edit"}
        </button>
      </div>
      <Show when={bulk()} fallback={
        <KeyValueTable rows={props.rows} keyPlaceholder={props.keyPlaceholder} onChange={(rows) => props.onChange(rows)} />
      }>
        <BulkEditor rows={props.rows} onChange={(rows) => props.onChange(rows)}
          ariaLabel={`${props.kind === "form" ? "Form fields" : props.kind === "headers" ? "Headers" : "Query params"} (bulk edit)`} />
      </Show>
    </div>
  );
}
