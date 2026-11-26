import { createSignal, Show } from "solid-js";
import { bearerTokenOf } from "../authHint";
import ContextMenu from "./ContextMenu";
import Icon from "./Icon";

interface Props {
  value: string; // the header row's value
  onConvert: (kind: "bearer" | "api_key") => void;
  onDismiss: () => void;
}

export const AUTH_HINT_TITLE = "Consider the Auth tab — it can manage this header";

// The subtle affordance on a hand-typed Authorization header (rules: authHint.ts):
// a key icon at the end of the row; its menu converts the header into the
// request's auth (the row is disabled, not deleted) or dismisses the hint for this
// request. Nothing ever happens without a click.
export default function AuthHint(props: Props) {
  const [menu, setMenu] = createSignal<{ x: number; y: number }>();
  const bearer = () => bearerTokenOf(props.value) !== undefined;
  return (
    <>
      <button type="button" class="auth-hint" title={AUTH_HINT_TITLE} aria-label={AUTH_HINT_TITLE} aria-haspopup="menu"
        aria-expanded={!!menu()} tabIndex={-1}
        onClick={(e) => {
          const r = e.currentTarget.getBoundingClientRect();
          setMenu({ x: r.left, y: r.bottom + 2 });
        }}>
        <Icon name="key" size={14} />
      </button>
      <Show when={menu()}>
        {(m) => (
          <ContextMenu x={m().x} y={m().y} label="Use the Auth tab" onClose={() => setMenu(undefined)} items={[
            { label: "Convert to Bearer", icon: "key", disabled: !bearer(),
              title: bearer() ? "Auth tab: Bearer with this token; this row is disabled" : "The value must be \"Bearer <token>\"",
              onSelect: () => props.onConvert("bearer") },
            { label: "Convert to API key header", title: "Auth tab: API key sent as this header; this row is disabled",
              onSelect: () => props.onConvert("api_key") },
            "separator",
            { label: "Dismiss for this request", onSelect: () => props.onDismiss() },
          ]} />
        )}
      </Show>
    </>
  );
}
