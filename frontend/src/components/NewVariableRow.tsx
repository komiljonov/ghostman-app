import { createSignal, Show } from "solid-js";
import { CreateVariableWithValue } from "../../wailsjs/go/main/App";
import { handleProblem } from "../authStore";
import { appendRowKey, commitOnLeave, DraftField, EMPTY_DRAFT, hasKey, VarDraft } from "../envRows";
import Icon from "./Icon";
import SecretInput from "./SecretInput";

interface Props {
  envId: string;
  onCreated: () => void;
}

// The trailing append row: complete from the start (grip · key · type · value ·
// the actions, all inert until it exists), like a saved row. It is a draft until committed as a whole
// (rules in envRows.ts): Enter, or Tab from the value, creates the variable with
// its value (one bound call; a secret's value stays local) and puts focus on the
// next — new, empty — row's key; focus leaving the row creates it too. Creates
// run one at a time, in order, so typing ahead into the next row is safe.
export default function NewVariableRow(props: Props) {
  const [draft, setDraft] = createSignal<VarDraft>(EMPTY_DRAFT);
  const [error, setError] = createSignal<string>();
  const [saving, setSaving] = createSignal(0);
  let row: HTMLTableRowElement | undefined;
  let keyInput: HTMLInputElement | undefined;
  let queue = Promise.resolve();

  const edit = (patch: Partial<VarDraft>) => {
    setDraft({ ...draft(), ...patch });
    setError(undefined);
  };

  const commit = (focusNext: boolean) => {
    const d = draft();
    if (!hasKey(d)) return;
    setDraft(EMPTY_DRAFT); // the row is free for the next variable at once
    if (focusNext) keyInput?.focus();
    setSaving((n) => n + 1);
    queue = queue.then(async () => {
      const r = await CreateVariableWithValue(props.envId, d.key, d.type, d.value);
      handleProblem(r.error);
      setSaving((n) => n - 1);
      if (r.error) {
        // Not created: give the draft back, unless the user already started the next one.
        if (!r.data && draft() === EMPTY_DRAFT) setDraft(d);
        setError(r.data ? `${d.key}: ${r.error.message}` : r.error.message);
      }
      if (r.data) props.onCreated();
    });
  };

  const onKey = (field: DraftField) => (e: KeyboardEvent) => {
    const action = appendRowKey(field, e, draft());
    if (action === "native") return;
    e.preventDefault();
    if (action === "clear") {
      setDraft(EMPTY_DRAFT);
      setError(undefined);
    } else commit(true);
  };

  return (
    <tr class="var-row ghost" ref={row}
      onFocusOut={(e) => {
        const to = e.relatedTarget as Node | null;
        if (commitOnLeave(draft(), !!to && !!row?.contains(to))) commit(false);
      }}>
      <td class="var-drag">
        <span class="drag-handle off" aria-hidden="true"><Icon name="grip" /></span>
      </td>
      <td>
        <input ref={keyInput} type="text" class="var-key" spellcheck={false} placeholder="New variable" aria-label="New variable key"
          value={draft().key} onInput={(e) => edit({ key: e.currentTarget.value })} onKeyDown={onKey("key")} />
      </td>
      <td>
        <select aria-label="New variable type" value={draft().type} onChange={(e) => edit({ type: e.currentTarget.value })}
          onKeyDown={onKey("type")}>
          <option value="regular">regular</option>
          <option value="secret">secret 🔒</option>
        </select>
      </td>
      <td>
        <Show when={draft().type === "secret"} fallback={
          <input type="text" spellcheck={false} aria-label="New variable value" placeholder="(empty)" value={draft().value}
            onInput={(e) => edit({ value: e.currentTarget.value })} onKeyDown={onKey("value")} />
        }>
          <SecretInput value={draft().value} ariaLabel="New variable value" onInput={(v) => edit({ value: v })} onKeyDown={onKey("value")} />
        </Show>
        <span class="var-save-state">
          <Show when={saving() > 0}><span class="muted">Saving…</span></Show>
        </span>
      </td>
      <td class="var-actions">
        <button type="button" class="icon-button" aria-label="Delete variable" tabIndex={-1} disabled><Icon name="trash" size={14} /></button>
        <Show when={error()}><div class="inline-error">{error()}</div></Show>
      </td>
    </tr>
  );
}
