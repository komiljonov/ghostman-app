import { For } from "solid-js";

const METHODS = ["GET", "POST", "PUT", "PATCH", "DELETE", "HEAD", "OPTIONS"];

interface Props {
  method: string;
  url: string;
  loading: boolean;
  onMethodChange: (method: string) => void;
  onUrlChange: (url: string) => void;
  onSend: () => void;
}

export default function RequestBar(props: Props) {
  return (
    <form
      class="request-bar"
      onSubmit={(e) => {
        e.preventDefault();
        props.onSend();
      }}
    >
      <select
        class="method"
        aria-label="HTTP method"
        value={props.method}
        onChange={(e) => props.onMethodChange(e.currentTarget.value)}
      >
        <For each={METHODS}>{(m) => <option value={m}>{m}</option>}</For>
      </select>
      <input
        class="url"
        type="text"
        aria-label="URL"
        placeholder="https://api.example.com/resource"
        spellcheck={false}
        autocomplete="off"
        value={props.url}
        onInput={(e) => props.onUrlChange(e.currentTarget.value)}
      />
      <button class="send" type="submit" disabled={props.loading}>
        {props.loading ? "Sending…" : "Send"}
      </button>
    </form>
  );
}
