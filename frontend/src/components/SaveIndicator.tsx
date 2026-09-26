import { Match, Switch } from "solid-js";
import { SaveState } from "../autosave";

interface Props {
  state: SaveState;
  error?: string;
  onRetry: () => void;
}

// Autosave status next to Send.
export default function SaveIndicator(props: Props) {
  return (
    <span class="save-indicator" aria-live="polite">
      <Switch>
        <Match when={props.state === "pending" || props.state === "saving"}>
          <span class="muted">Saving…</span>
        </Match>
        <Match when={props.state === "saved"}>
          <span class="saved">Saved</span>
        </Match>
        <Match when={props.state === "error"}>
          <button type="button" class="link not-saved" title={props.error} onClick={() => props.onRetry()}>
            Not saved — retry
          </button>
        </Match>
      </Switch>
    </span>
  );
}
