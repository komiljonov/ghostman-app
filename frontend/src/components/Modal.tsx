import { JSX } from "solid-js";

interface Props {
  title: string;
  onClose: () => void;
  children: JSX.Element;
}

// A plain dialog shell: backdrop click or Escape closes it.
export default function Modal(props: Props) {
  return (
    <div class="modal-backdrop" onClick={(e) => e.target === e.currentTarget && props.onClose()}
      onKeyDown={(e) => e.key === "Escape" && props.onClose()}>
      <div class="modal" role="dialog" aria-modal="true" aria-label={props.title}>
        <h2>{props.title}</h2>
        {props.children}
      </div>
    </div>
  );
}
