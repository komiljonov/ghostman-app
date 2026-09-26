import { createSignal, Show } from "solid-js";
import { session } from "../../wailsjs/go/models";
import { createAction } from "../action";
import FormError from "./FormError";

interface Props {
  label: string;
  prompt: string;
  confirmLabel: string;
  action: () => Promise<{ error?: session.Problem }>;
  onDone: () => void;
}

// A destructive button that asks for confirmation inline before acting.
export default function ConfirmButton(props: Props) {
  const [confirming, setConfirming] = createSignal(false);
  const act = createAction(() => props.action());

  const confirm = async () => {
    const result = await act.run();
    if (result && !result.error) {
      setConfirming(false);
      props.onDone();
    }
  };

  return (
    <div class="confirm">
      <Show when={confirming()} fallback={
        <button type="button" class="danger-outline" onClick={() => setConfirming(true)}>{props.label}</button>
      }>
        <p class="warning">{props.prompt}</p>
        <div class="row">
          <button type="button" class="danger" onClick={confirm} disabled={act.pending()}>
            {act.pending() ? "Working…" : props.confirmLabel}
          </button>
          <button type="button" onClick={() => setConfirming(false)} disabled={act.pending()}>Cancel</button>
        </div>
      </Show>
      <FormError message={act.error()} />
    </div>
  );
}
