import { createMemo, createSignal, For, Index, Match, Show, Switch } from "solid-js";
import { FormatJSONBody, SwitchAuthType } from "../../wailsjs/go/main/App";
import { api } from "../../wailsjs/go/models";
import { ApiKeyIn, AUTH_HINT, AuthConfig, AuthType, JWT_ALGORITHMS, JWTAlgorithm, normalizeAuth, resolvedLabel, TYPE_LABEL, withType } from "../auth";
import { handleProblem } from "../authStore";
import { FORMAT_SHORTCUT } from "../bodyFormat";
import type { CodeEditorHandle } from "../codemirror";
import { envDisplay } from "../envStore";
import { JWT_DEFAULT_PREFIX, JWT_SECRET_HINT, jwtNamePlaceholder, jwtPrefixDisabled, jwtSentAs, withTimeClaims } from "../jwtAuth";
import { isExplicitAuth, type ResolvedAuth } from "../settingsResolver";
import { currentProjectId } from "../workspaceStore";
import CodeEditor from "./CodeEditor";
import Icon from "./Icon";
import JwtHelp from "./JwtHelp";
import JwtPreview from "./JwtPreview";
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
  // Set by a mode switch that filled the fields from this project's auth memory;
  // the note under the mode select shows until the next edit.
  const [prefilled, setPrefilled] = createSignal<AuthType>();
  const set = (field: keyof AuthConfig, value: string | boolean) => {
    setPrefilled(undefined);
    props.onChange({ ...props.auth, [field]: value });
  };

  // A mode switch goes through Go (SwitchAuthType, internal/authmemory): only the
  // type changes, unless that type's fields are all empty here — then the last
  // values saved for it in this project are filled in (local only, no server
  // call; the autosave / Save persists them like any edit).
  let switchSeq = 0;
  const switchType = async (type: AuthType) => {
    const mine = ++switchSeq;
    const before = props.auth;
    setPrefilled(undefined);
    const res = await SwitchAuthType(currentProjectId(), api.Auth.createFrom(before), type);
    if (mine !== switchSeq) return;
    handleProblem(res.error);
    if (!res.data || props.auth !== before) return props.onChange(withType(props.auth, type));
    props.onChange(normalizeAuth(res.data.auth));
    if (res.data.prefilled) setPrefilled(type);
  };

  // JWT payload Format (the button or Alt+Shift+F): the raw body's formatter —
  // Go masks {{vars}} outside strings (internal/jsonfmt), one undoable change.
  let payloadEditor: CodeEditorHandle | undefined;
  let formatting = false;
  const [formatHint, setFormatHint] = createSignal("");
  const canFormat = () => props.auth.jwt_payload.trim() !== "";
  const payloadEnv = createMemo(() => withTimeClaims(envDisplay()));
  const formatPayload = async () => {
    if (!payloadEditor || formatting || !canFormat()) return;
    const before = payloadEditor.getDoc();
    formatting = true;
    try {
      const res = await FormatJSONBody(before);
      if (res.error) {
        if (payloadEditor.getDoc() === before) setFormatHint(res.error.message);
      } else if (res.data) {
        payloadEditor.applyFormatted(before, res.data.formatted);
      }
    } finally {
      formatting = false;
    }
  };

  return (
    <div class="auth-editor">
      <label class="field auth-mode">
        <span>Type</span>
        <select id={`${props.idPrefix}-auth-type`} aria-label="Auth type" value={props.auth.type}
          onChange={(e) => void switchType(e.currentTarget.value as AuthType)}>
          {/* Index, not For: the labels are recomputed on every change, and recreated
              <option>s would drop the selection back to the first one. */}
          <Index each={props.options}>
            {(o) => <option value={o().value} selected={o().value === props.auth.type}>{o().label}</option>}
          </Index>
        </select>
      </label>
      <Show when={prefilled() !== undefined && prefilled() === props.auth.type}>
        <p class="auth-prefilled small" role="status">
          Filled in from the last {TYPE_LABEL[props.auth.type]} settings saved in this project (remembered on this computer only) — edit freely.
        </p>
      </Show>

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
        {/* Fields are <div>s, not <label>s: a label cannot focus the CodeMirror field, so a
            click on it activated the label's first focusable control instead (the password's
            reveal button — focus stolen, reveal toggled). Each field has its own aria-label. */}
        <Match when={props.auth.type === "bearer"}>
          <div class="auth-fields">
            <div class="auth-field">
              <span>Token</span>
              <VarField value={props.auth.bearer_token} onChange={(v) => set("bearer_token", v)}
                placeholder="{{API_TOKEN}}" ariaLabel="Bearer token" />
            </div>
            <p class="auth-preview muted small">Sent as <code>Authorization: Bearer &lt;token&gt;</code></p>
          </div>
        </Match>
        <Match when={props.auth.type === "basic"}>
          <div class="auth-fields">
            <div class="auth-field">
              <span>Username</span>
              <VarField value={props.auth.basic_username} onChange={(v) => set("basic_username", v)}
                placeholder="Username" ariaLabel="Basic auth username" />
            </div>
            <div class="auth-field">
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
            </div>
            <p class="auth-preview muted small">Sent as <code>Authorization: Basic base64(username:password)</code></p>
          </div>
        </Match>
        <Match when={props.auth.type === "api_key"}>
          <div class="auth-fields">
            <div class="auth-field">
              <span>Key</span>
              <VarField value={props.auth.api_key_name} onChange={(v) => set("api_key_name", v)}
                placeholder="X-Api-Key" ariaLabel="API key name" />
            </div>
            <div class="auth-field">
              <span>Value</span>
              <VarField value={props.auth.api_key_value} onChange={(v) => set("api_key_value", v)}
                placeholder="{{API_KEY}}" ariaLabel="API key value" />
            </div>
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
        <Match when={props.auth.type === "jwt"}>
          <div class="auth-fields">
            <label class="auth-field">
              <span>Algorithm</span>
              <select aria-label="JWT algorithm" class="jwt-algorithm" value={props.auth.jwt_algorithm}
                onChange={(e) => set("jwt_algorithm", e.currentTarget.value as JWTAlgorithm)}>
                <For each={JWT_ALGORITHMS}>{(a) => <option value={a} selected={a === props.auth.jwt_algorithm}>{a}</option>}</For>
              </select>
            </label>
            <div class="auth-field">
              <span>Secret</span>
              <VarField value={props.auth.jwt_secret} onChange={(v) => set("jwt_secret", v)}
                placeholder="{{JWT_SECRET}}" ariaLabel="JWT secret" />
            </div>
            <p class="auth-field-note muted small">{JWT_SECRET_HINT}</p>
            <div class="auth-field">
              <span />
              <label class="check-inline">
                <input type="checkbox" checked={props.auth.jwt_secret_base64}
                  onChange={(e) => set("jwt_secret_base64", e.currentTarget.checked)} />
                Secret is Base64-encoded
              </label>
            </div>
            <div class="auth-field top">
              <span>Payload</span>
              <div class="jwt-payload">
                <div class="jwt-payload-bar">
                  <span class="muted small">JSON object · <code>"{"{{$now+3600}}"}"</code> = a time claim</span>
                  <JwtHelp />
                  <span class="format-hint" title={formatHint()} aria-live="polite">{formatHint()}</span>
                  <span class="toolbar-slot" title={canFormat() ? `Format JSON (${FORMAT_SHORTCUT})` : "Nothing to format"}>
                    <button type="button" class="format-btn" disabled={!canFormat()} aria-label="Format payload JSON"
                      onClick={() => {
                        void formatPayload();
                        payloadEditor?.focus();
                      }}>Format</button>
                  </span>
                </div>
                <CodeEditor value={props.auth.jwt_payload} json getEnv={payloadEnv} canFormat={canFormat()} onFormat={() => void formatPayload()}
                  onEditor={(e) => (payloadEditor = e)}
                  onChange={(text) => {
                    setFormatHint("");
                    set("jwt_payload", text);
                  }} />
              </div>
            </div>
            <div class="auth-field">
              <span>Add to</span>
              <div class="segmented small" role="radiogroup" aria-label="Add JWT to">
                <For each={[{ v: "header" as ApiKeyIn, l: "Header" }, { v: "query" as ApiKeyIn, l: "Query params" }]}>
                  {(o) => (
                    <button type="button" role="radio" aria-checked={props.auth.jwt_add_to === o.v}
                      classList={{ active: props.auth.jwt_add_to === o.v }}
                      onClick={() => set("jwt_add_to", o.v)}>{o.l}</button>
                  )}
                </For>
              </div>
            </div>
            <div class="auth-field">
              <span>Name</span>
              <VarField value={props.auth.jwt_name} onChange={(v) => set("jwt_name", v)}
                placeholder={jwtNamePlaceholder(props.auth.jwt_add_to)} ariaLabel="JWT header or parameter name" />
            </div>
            <div class="auth-field" title={jwtPrefixDisabled(props.auth.jwt_add_to) ? "The prefix applies to a header only" : undefined}>
              <span>Prefix</span>
              <VarField value={props.auth.jwt_prefix} onChange={(v) => set("jwt_prefix", v)}
                placeholder={JWT_DEFAULT_PREFIX} ariaLabel="JWT header prefix" disabled={jwtPrefixDisabled(props.auth.jwt_add_to)} />
            </div>
            <div class="auth-preview jwt-sent-as">
              <span class="muted small">Sent as <code>{jwtSentAs(props.auth)}</code></span>
              <JwtPreview auth={props.auth} />
            </div>
          </div>
        </Match>
      </Switch>

      <Show when={isExplicitAuth(props.auth.type)}>
        <Show when={props.auth.type !== "jwt"}><p class="auth-hint">{AUTH_HINT}</p></Show>
        <p class="auth-hint">
          A header or query parameter you add yourself with the same name wins over the one built here.
        </p>
      </Show>
    </div>
  );
}
