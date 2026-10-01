import { createSignal } from "solid-js";

interface Props {
  value: string;
  onInput: (value: string) => void;
}

// Password-style input with a reveal toggle, for secret variable values (which are
// stored on this machine only).
export default function SecretInput(props: Props) {
  const [revealed, setRevealed] = createSignal(false);
  return (
    <div class="secret-input">
      <input type={revealed() ? "text" : "password"} spellcheck={false} autocomplete="off"
        placeholder="not set on this machine" aria-label="Secret value" value={props.value}
        onInput={(e) => props.onInput(e.currentTarget.value)} />
      <button type="button" class="icon-button" title={revealed() ? "Hide" : "Reveal"}
        aria-label={revealed() ? "Hide value" : "Reveal value"} onClick={() => setRevealed((v) => !v)}>
        {revealed() ? "◉" : "◎"}
      </button>
    </div>
  );
}
