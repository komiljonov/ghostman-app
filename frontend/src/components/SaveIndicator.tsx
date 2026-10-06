import { Match, Switch } from "solid-js";
import { SaveState } from "../autosave";

interface Props {
  state: SaveState;
  error?: string;
  onRetry: () => void;
}

// Autosave status at the right end of the Params | Headers | Body row: a dot and
// a short label. Muted "Saved" (also before the first edit: nothing is unsaved),
// amber "Saving…", red "Not saved — retry" (click to retry).
export default function SaveIndicator(props: Props) {
  return (
    <span class="save-indicator" aria-live="polite">
      <Switch fallback={<span class="save-state saved"><span class="save-dot" />Saved</span>}>
        <Match when={props.state === "pending" || props.state === "saving"}>
          <span class="save-state saving"><span class="save-dot" />Saving…</span>
        </Match>
        <Match when={props.state === "error"}>
          <button type="button" class="save-state error" title={props.error ? `${props.error} — click to retry` : "Click to retry"}
            onClick={() => props.onRetry()}>
            <span class="save-dot" />Not saved — retry
          </button>
        </Match>
      </Switch>
    </span>
  );
}
