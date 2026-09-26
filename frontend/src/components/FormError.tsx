import { Show } from "solid-js";

interface Props {
  message: string | undefined;
}

export default function FormError(props: Props) {
  return (
    <Show when={props.message}>
      <p class="form-error" role="alert">
        {props.message}
      </p>
    </Show>
  );
}
