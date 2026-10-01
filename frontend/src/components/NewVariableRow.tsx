import { createSignal } from "solid-js";
import { CreateVariable } from "../../wailsjs/go/main/App";
import { createAction } from "../action";

interface Props {
  envId: string;
  onCreated: () => void;
}

// The trailing empty row: typing a key and pressing Enter (or leaving the field)
// creates the variable; its value is set afterwards in the new row.
export default function NewVariableRow(props: Props) {
  const [key, setKey] = createSignal("");
  const [type, setType] = createSignal("regular");
  const create = createAction(CreateVariable);

  const commit = async () => {
    const k = key().trim();
    if (!k || create.pending()) return;
    const result = await create.run(props.envId, k, type());
    if (result?.data) {
      setKey("");
      setType("regular");
      props.onCreated();
    }
  };

  return (
    <tr class="var-row ghost">
      <td>
        <input type="text" class="var-key" spellcheck={false} placeholder="New variable" aria-label="New variable key"
          value={key()} onInput={(e) => setKey(e.currentTarget.value)}
          onBlur={() => void commit()}
          onKeyDown={(e) => e.key === "Enter" && void commit()} />
      </td>
      <td>
        <select aria-label="New variable type" value={type()} onChange={(e) => setType(e.currentTarget.value)}>
          <option value="regular">regular</option>
          <option value="secret">secret 🔒</option>
        </select>
      </td>
      <td colSpan={2}>
        <span class="inline-error">{create.error()}</span>
      </td>
    </tr>
  );
}
