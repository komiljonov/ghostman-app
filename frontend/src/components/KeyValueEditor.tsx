import { JSX, Show } from "solid-js";
import type { BulkKind } from "../bulkEdit";
import { commitHeaderKey, recentHeaderKeys } from "../headerKeysStore";
import { headerKeySource, headerValueSource } from "../headerSources";
import type { Row } from "../rows";
import { bulkMode, setBulkMode } from "../uiPrefs";
import BulkEditor from "./BulkEditor";
import KeyValueTable from "./KeyValueTable";

interface Props {
  kind: BulkKind; // which global preference (params | headers | form) picks the view
  rows: Row[];
  onChange: (rows: Row[]) => void;
  keyPlaceholder?: string;
  // Plain text cells: no {{var}} highlighting / completion (example responses).
  plain?: boolean;
  rowAside?: (row: () => Row, index: number) => JSX.Element; // after a row's value (headers: the auth hint)
}

// Header editing helpers (headerComplete.ts) for the "headers" kind: header-name
// completion in KEY cells (recent keys of the project above the common list), mime
// types in the VALUE cell of a Content-Type row, and committed keys recorded.
const headerKeys = [headerKeySource(recentHeaderKeys)];
const headerValues = (key: () => string) => [headerValueSource(key)];

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
        <KeyValueTable rows={props.rows} keyPlaceholder={props.keyPlaceholder} plain={props.plain} onChange={(rows) => props.onChange(rows)}
          keyCompletions={props.kind === "headers" ? headerKeys : undefined}
          valueCompletions={props.kind === "headers" ? headerValues : undefined}
          onKeyCommit={props.kind === "headers" && !props.plain ? (k) => void commitHeaderKey(k) : undefined}
          rowAside={props.rowAside} />
      }>
        <BulkEditor rows={props.rows} plain={props.plain} onChange={(rows) => props.onChange(rows)}
          ariaLabel={`${props.kind === "form" ? "Form fields" : props.kind === "headers" ? "Headers" : "Query params"} (bulk edit)`} />
      </Show>
    </div>
  );
}
