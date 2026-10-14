import { Index, Show } from "solid-js";
import { chooseBlocked, editPart, movesFile, newPart, Part, PartKind, removePart, setKind, togglePart } from "../multipart";
import FileCell from "./FileCell";
import Icon from "./Icon";
import VarCell from "./VarCell";
import type { LocalFile } from "../multipart";

interface Props {
  parts: Part[];
  onChange: (parts: Part[]) => void;
  local: (key: string) => LocalFile | undefined;
  onChoose: (index: number) => Promise<string | undefined>;
  onClear: (index: number) => void;
  // A file row's key changed (its local path moves along).
  onFileKey: (oldKey: string, newKey: string) => void;
  onRemoveFile: (key: string) => void; // a removed file row forgets its local path
}

const GHOST = newPart();

// The form-data rows: the shared row table (enabled · key · value · ×, trailing
// ghost row, <Index> so cells keep focus while typing) plus a per-row kind
// (Text | File). Text values are VarCells ({{var}} highlight, hover,
// completion); a file row's value cell is a FileCell.
export default function MultipartTable(props: Props) {
  const items = () => [...props.parts, GHOST];
  return (
    <table class="kv-table multipart-table">
      <thead>
        <tr><th class="kv-check" /><th>Key</th><th class="kv-kind">Type</th><th>Value</th><th class="kv-remove" /></tr>
      </thead>
      <tbody>
        <Index each={items()}>
          {(part, i) => {
            const ghost = () => i === props.parts.length;
            const editKey = (text: string) => {
              const old = part();
              const move = !ghost() && movesFile(props.parts, i, text);
              props.onChange(editPart(props.parts, i, { key: text }));
              if (move) props.onFileKey(old.key, text);
            };
            return (
              <tr classList={{ ghost: ghost(), disabled: !ghost() && !part().enabled }}>
                <td class="kv-check">
                  <input type="checkbox" aria-label="Enabled" checked={ghost() || part().enabled} disabled={ghost()}
                    onChange={() => props.onChange(togglePart(props.parts, i))} />
                </td>
                <td>
                  <VarCell value={part().key} placeholder="Field" ariaLabel="Field" onChange={editKey} />
                </td>
                <td class="kv-kind">
                  <select aria-label="Field type" value={part().kind}
                    onChange={(e) => props.onChange(setKind(props.parts, i, e.currentTarget.value as PartKind))}>
                    <option value="text">Text</option>
                    <option value="file">File</option>
                  </select>
                </td>
                <td>
                  <Show when={part().kind === "file"} fallback={
                    <VarCell value={part().value} placeholder="Value" ariaLabel="Value"
                      onChange={(text) => props.onChange(editPart(props.parts, i, { value: text }))} />
                  }>
                    <FileCell part={part()} local={props.local(part().key)} ghost={ghost()}
                      blocked={chooseBlocked(props.parts, i)}
                      onChoose={() => props.onChoose(i)} onClear={() => props.onClear(i)} />
                  </Show>
                </td>
                <td class="kv-remove">
                  <button type="button" class="icon-button" title="Remove row" aria-label="Remove row"
                    disabled={ghost()} onClick={() => {
                      const removed = part();
                      props.onChange(removePart(props.parts, i));
                      if (removed.kind === "file" && removed.key.trim() !== "") props.onRemoveFile(removed.key);
                    }}><Icon name="close" size={14} /></button>
                </td>
              </tr>
            );
          }}
        </Index>
      </tbody>
    </table>
  );
}
