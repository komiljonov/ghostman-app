import { createSignal, Show } from "solid-js";
import { formatBytes } from "../historyModel";
import { fileLabel, fileState, LocalFile, Part } from "../multipart";
import Icon from "./Icon";

interface Props {
  part: Part;
  local: LocalFile | undefined;
  blocked?: string; // why a file cannot be chosen (no key, duplicate file key)
  ghost: boolean;
  onChoose: () => Promise<string | undefined>; // resolves to an error message
  onClear: () => void;
}

// The value cell of a file row: "Choose file…" (native dialog, Go), then the
// chosen file's name and size with Change… and × (clear). Only the name is shown —
// the full path is the tooltip. A row naming a file this machine does not have
// (a teammate's pick, or a file since moved) is amber, with Choose to fix it.
export default function FileCell(props: Props) {
  const [error, setError] = createSignal<string>();
  const state = () => fileState(props.part, props.local);
  const label = () => fileLabel(props.part, props.local);
  const choose = async () => setError(await props.onChoose());

  return (
    <div classList={{ "file-cell": true, [`file-${state()}`]: true }}>
      <div class="file-cell-line">
        <Show when={state() !== "empty"}>
          <span class="file-cell-name" title={label().title}>
            <Show when={state() === "chosen"} fallback={<Icon name="alert" size={14} />}><Icon name="file" size={14} /></Show>
            <span class="file-cell-text">{label().text}</span>
            <Show when={state() === "chosen"}><span class="muted small">{formatBytes(props.local!.size)}</span></Show>
          </span>
        </Show>
        <span class="row-spacer" />
        <span title={props.blocked}>
          <button type="button" class="small" disabled={!!props.blocked} onClick={() => void choose()}>
            {state() === "empty" ? "Choose file…" : state() === "chosen" ? "Change…" : "Choose…"}
          </button>
        </span>
        <button type="button" class="icon-button" aria-label="Clear the file" title="Clear the file"
          disabled={props.ghost || state() === "empty"} onClick={() => props.onClear()}>
          <Icon name="close" size={12} />
        </button>
      </div>
      <Show when={error() || (props.blocked && !props.ghost && props.part.key.trim() !== "" ? props.blocked : undefined)}>
        {(msg) => <span class="file-cell-hint small" role="alert">{msg()}</span>}
      </Show>
    </div>
  );
}
