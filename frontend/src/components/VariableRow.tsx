import { createSignal, onCleanup, Show } from "solid-js";
import { DeleteVariable, MoveVariable, SetVariableKey, SetVariableType, SetVariableValue } from "../../wailsjs/go/main/App";
import { envs } from "../../wailsjs/go/models";
import { createAction } from "../action";
import { createAutosaver, SaveState } from "../autosave";
import { handleProblem } from "../authStore";
import ConfirmDialog from "./ConfirmDialog";
import SecretInput from "./SecretInput";
import Icon from "./Icon";

interface Props {
  envId: string;
  variable: envs.VariableView;
  first: boolean;
  last: boolean;
  onStructureChanged: () => void; // key/type/order/delete: re-fetch the table
  onValueSaved: () => void; // value saved: refresh highlighting
}

// One variable. Values autosave (600 ms debounce) — on the server for regular
// variables, on this machine only for secrets (Go decides by the server's type).
export default function VariableRow(props: Props) {
  const isSecret = () => props.variable.type === "secret";
  const [key, setKey] = createSignal(props.variable.key);
  const [value, setValue] = createSignal(props.variable.value);
  const [saveState, setSaveState] = createSignal<SaveState>("idle");
  const [saveError, setSaveError] = createSignal<string>();
  const [confirmRegular, setConfirmRegular] = createSignal(false);

  const saver = createAutosaver({
    delayMs: 600,
    onState: setSaveState,
    save: async () => {
      const result = await SetVariableValue(props.envId, props.variable.id, value());
      handleProblem(result.error);
      setSaveError(result.error?.message);
      if (!result.error) props.onValueSaved();
      return !result.error;
    },
  });
  onCleanup(() => void saver.flush());

  const rename = createAction(SetVariableKey);
  const retype = createAction(SetVariableType);
  const move = createAction(MoveVariable);
  const del = createAction(DeleteVariable);
  const error = () => rename.error() || retype.error() || move.error() || del.error() || saveError();

  const commitKey = async () => {
    const next = key().trim();
    if (!next || next === props.variable.key) {
      setKey(props.variable.key);
      return;
    }
    await saver.flush(); // the value belongs to the old key until the rename lands
    const result = await rename.run(props.envId, props.variable.id, next);
    if (result && !result.error) props.onStructureChanged();
  };

  const changeType = async (type: string) => {
    if (type === props.variable.type) return;
    if (type === "regular") {
      setConfirmRegular(true); // uploading a secret needs an explicit OK
      return;
    }
    await saver.flush();
    const result = await retype.run(props.envId, props.variable.id, type);
    if (result && !result.error) props.onStructureChanged();
  };

  const doMove = async (offset: number) => {
    const result = await move.run(props.envId, props.variable.id, offset);
    if (result && !result.error) props.onStructureChanged();
  };

  const doDelete = async () => {
    saver.dispose();
    const result = await del.run(props.variable.id);
    if (result && !result.error) props.onStructureChanged();
  };

  return (
    <tr classList={{ "var-row": true, secret: isSecret() }}>
      <td>
        <input type="text" class="var-key" spellcheck={false} aria-label="Variable key" value={key()}
          onInput={(e) => setKey(e.currentTarget.value)}
          onBlur={() => void commitKey()}
          onKeyDown={(e) => {
            if (e.key === "Enter") e.currentTarget.blur();
            if (e.key === "Escape") setKey(props.variable.key);
          }} />
      </td>
      <td>
        <select aria-label="Variable type" value={props.variable.type} disabled={retype.pending()}
          onChange={(e) => {
            const v = e.currentTarget.value;
            e.currentTarget.value = props.variable.type; // reflect the server, not the click
            void changeType(v);
          }}>
          <option value="regular">regular</option>
          <option value="secret">secret 🔒</option>
        </select>
      </td>
      <td>
        <Show when={isSecret()} fallback={
          <input type="text" spellcheck={false} aria-label="Value" placeholder="(empty)" value={value()}
            onInput={(e) => {
              setValue(e.currentTarget.value);
              saver.change();
            }} />
        }>
          <SecretInput value={value()} onInput={(v) => {
            setValue(v);
            saver.change();
          }} />
        </Show>
        <span class="var-save-state">
          <Show when={saveState() === "pending" || saveState() === "saving"}><span class="muted">Saving…</span></Show>
          <Show when={saveState() === "saved"}><span class="muted">{isSecret() ? "Saved locally" : "Saved"}</span></Show>
          <Show when={saveState() === "error"}>
            <button type="button" class="link not-saved" onClick={() => void saver.retry()}>Not saved — retry</button>
          </Show>
        </span>
      </td>
      <td class="var-actions">
        <button type="button" class="small-button" title="Move up" aria-label="Move up" disabled={props.first || move.pending()}
          onClick={() => void doMove(-1)}>↑</button>
        <button type="button" class="small-button" title="Move down" aria-label="Move down" disabled={props.last || move.pending()}
          onClick={() => void doMove(1)}>↓</button>
        <button type="button" class="icon-button" title="Delete variable" aria-label="Delete variable" disabled={del.pending()}
          onClick={() => void doDelete()}><Icon name="trash" size={14} /></button>
        <Show when={error()}><div class="inline-error">{error()}</div></Show>
      </td>
      <Show when={confirmRegular()}>
        <ConfirmDialog
          title="Make this variable regular?"
          message={`The secret value of "${props.variable.key}" will be uploaded to the server and visible to everyone with access to this project. Its copy on this machine is removed.`}
          confirmLabel="Upload and make regular"
          action={async () => {
            await saver.flush();
            return SetVariableType(props.envId, props.variable.id, "regular");
          }}
          onDone={props.onStructureChanged}
          onClose={() => setConfirmRegular(false)}
        />
      </Show>
    </tr>
  );
}
