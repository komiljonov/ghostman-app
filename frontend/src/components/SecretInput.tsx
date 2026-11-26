import { createSignal } from "solid-js";

interface Props {
  value: string;
  onInput: (value: string) => void;
  onKeyDown?: (e: KeyboardEvent & { currentTarget: HTMLInputElement }) => void;
  ariaLabel?: string;
}

// Password-style input with a reveal toggle, for secret variable values (which are
// stored on this machine only). The toggle is mouse-only (tabIndex -1): Tab moves
// from the value to the next row's key, as in every row of the variables table.
export default function SecretInput(props: Props) {
  const [revealed, setRevealed] = createSignal(false);
  return (
    <div class="secret-input">
      <input type={revealed() ? "text" : "password"} spellcheck={false} autocomplete="off"
        placeholder="not set on this machine" aria-label={props.ariaLabel ?? "Secret value"} value={props.value}
        onInput={(e) => props.onInput(e.currentTarget.value)} onKeyDown={(e) => props.onKeyDown?.(e)} />
      <button type="button" class="icon-button" tabIndex={-1} title={revealed() ? "Hide" : "Reveal"}
        aria-label={revealed() ? "Hide value" : "Reveal value"} onClick={() => setRevealed((v) => !v)}>
        {revealed() ? "◉" : "◎"}
      </button>
    </div>
  );
}
