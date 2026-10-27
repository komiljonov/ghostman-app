import { For } from "solid-js";
import { JWT_CLAIM_HELP, JWT_CLAIM_RULES } from "../jwtAuth";
import Dropdown from "./Dropdown";

// The ? popover by the JWT payload: the dynamic time claims and how {{vars}}
// resolve in it (rules: engine.DynamicClaim, copy in jwtAuth.ts).
export default function JwtHelp() {
  return (
    <Dropdown triggerLabel="JWT payload help" triggerClass="script-help-trigger" align="right" menuRole="dialog"
      menuClass="script-help" trigger={<span aria-hidden="true">?</span>}>
      {() => (
        <div class="script-help-body">
          <p class="script-help-title">Time claims <span class="muted">— in the payload, as string values</span></p>
          <For each={JWT_CLAIM_HELP}>
            {(h) => (
              <div class="script-help-item">
                <div class="script-help-usage"><code>{h.token}</code></div>
                <p class="muted small">{h.meaning}</p>
              </div>
            )}
          </For>
          <section class="script-help-group">
            <h4>Rules</h4>
            <For each={JWT_CLAIM_RULES}>{(r) => <p class="muted small jwt-help-rule">{r}</p>}</For>
          </section>
          <code class="script-help-example">{'{"sub": "{{user_id}}", "iat": "{{$now}}", "exp": "{{$now+3600}}"}'}</code>
        </div>
      )}
    </Dropdown>
  );
}
