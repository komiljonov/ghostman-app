import { createSignal, For, Index, Match, Show, Switch } from "solid-js";
import { ApiKeyIn, AUTH_HINT, AuthConfig, AuthType, resolvedLabel, withType } from "../auth";
import type { ResolvedAuth } from "../settingsResolver";
import Icon from "./Icon";
import VarField from "./VarField";

interface Props {
  auth: AuthConfig;
  onChange: (next: AuthConfig) => void;
  options: { value: AuthType; label: string }[]; // modeOptions(): "Inherit" names what it resolves to
  effective: ResolvedAuth; // what a send would use, with this config
  idPrefix: string; // unique ids per instance (request tab / folder modal)
  noun: "request" | "folder";
}

// The Auth editor shared by the request's Auth sub-tab and the folder Settings
// modal. A mode switch changes only the type: every field keeps what was typed
// (the server keeps it too), so switching back restores it. Value fields are
// single-line {{var}} editors; secrets belong in a secret variable.
export default function AuthEditor(props: Props) {
  const [reveal, setReveal] = createSignal(false);
  const set = (field: keyof AuthConfig, value: string) => props.onChange({ ...props.auth, [field]: value });

  return (
    <div class="auth-editor">
      <label class="field auth-mode">
        <span>Type</span>
        <select id={`${props.idPrefix}-auth-type`} aria-label="Auth type" value={props.auth.type}
          onChange={(e) => props.onChange(withType(props.auth, e.currentTarget.value as AuthType))}>
          {/* Index, not For: the labels are recomputed on every change, and recreated
              <option>s would drop the selection back to the first one. */}
          <Index each={props.options}>
            {(o) => <option value={o().value} selected={o().value === props.auth.type}>{o().label}</option>}
          </Index>
        </select>
      </label>

      <Switch>
        <Match when={props.auth.type === "inherit"}>
          <p class="auth-note">
            Uses the parent folders' auth: <strong>{resolvedLabel(props.effective)}</strong>.
            {props.effective.config ? "" : " With no folder setting it, the request is sent without auth."}
          </p>
        </Match>
        <Match when={props.auth.type === "none"}>
          <p class="auth-note">
            No credentials are added, even when a parent folder sets auth{props.noun === "folder" ? " (for everything in this folder that inherits)" : ""}.
          </p>
        </Match>
        <Match when={props.auth.type === "bearer"}>
          <div class="auth-fields">
            <label class="auth-field">
              <span>Token</span>
              <VarField value={props.auth.bearer_token} onChange={(v) => set("bearer_token", v)}
                placeholder="{{API_TOKEN}}" ariaLabel="Bearer token" />
            </label>
            <p class="auth-preview muted small">Sent as <code>Authorization: Bearer &lt;token&gt;</code></p>
          </div>
        </Match>
        <Match when={props.auth.type === "basic"}>
          <div class="auth-fields">
            <label class="auth-field">
              <span>Username</span>
              <VarField value={props.auth.basic_username} onChange={(v) => set("basic_username", v)}
                placeholder="Username" ariaLabel="Basic auth username" />
            </label>
            <label class="auth-field">
              <span>Password</span>
              <span class="auth-secret">
                <VarField value={props.auth.basic_password} onChange={(v) => set("basic_password", v)}
                  placeholder="{{PASSWORD}}" ariaLabel="Basic auth password" masked={!reveal()} />
                <button type="button" class="icon-button auth-reveal" aria-pressed={reveal()}
                  title={reveal() ? "Hide password" : "Show password"} aria-label={reveal() ? "Hide password" : "Show password"}
                  onClick={() => setReveal(!reveal())}>
                  <Icon name={reveal() ? "eye-off" : "eye"} size={14} />
                </button>
              </span>
            </label>
            <p class="auth-preview muted small">Sent as <code>Authorization: Basic base64(username:password)</code></p>
          </div>
        </Match>
        <Match when={props.auth.type === "api_key"}>
          <div class="auth-fields">
            <label class="auth-field">
              <span>Key</span>
              <VarField value={props.auth.api_key_name} onChange={(v) => set("api_key_name", v)}
                placeholder="X-Api-Key" ariaLabel="API key name" />
            </label>
            <label class="auth-field">
              <span>Value</span>
              <VarField value={props.auth.api_key_value} onChange={(v) => set("api_key_value", v)}
                placeholder="{{API_KEY}}" ariaLabel="API key value" />
            </label>
            <div class="auth-field">
              <span>Add to</span>
              <div class="segmented small" role="radiogroup" aria-label="Add API key to">
                <For each={[{ v: "header" as ApiKeyIn, l: "Header" }, { v: "query" as ApiKeyIn, l: "Query params" }]}>
                  {(o) => (
                    <button type="button" role="radio" aria-checked={props.auth.api_key_in === o.v}
                      classList={{ active: props.auth.api_key_in === o.v }}
                      onClick={() => set("api_key_in", o.v)}>{o.l}</button>
                  )}
                </For>
              </div>
            </div>
          </div>
        </Match>
      </Switch>

      <Show when={props.auth.type === "bearer" || props.auth.type === "basic" || props.auth.type === "api_key"}>
        <p class="auth-hint">{AUTH_HINT}</p>
        <p class="auth-hint">
          A header or query parameter you add yourself with the same name wins over the one built here.
        </p>
      </Show>
    </div>
  );
}
