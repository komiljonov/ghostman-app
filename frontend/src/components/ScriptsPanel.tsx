import ScriptEditor from "./ScriptEditor";
import ScriptHelp from "./ScriptHelp";

interface Props {
  pre: string;
  post: string;
  onPre: (text: string) => void;
  onPost: (text: string) => void;
  noun: "request" | "folder";
}

// The two script editors (request Scripts sub-tab, folder Settings… section).
// Folder scripts run around every request inside, outer folders first; the
// request's own run innermost. Saves ride the caller's save (autosave / modal).
export default function ScriptsPanel(props: Props) {
  const scope = () => (props.noun === "folder" ? "every send of a request in this folder" : "every send of this request");
  return (
    <div class="scripts-panel">
      <div class="scripts-head">
        <p class="muted small">
          Run around {scope()}: pre-request before {"{{variables}}"} are resolved (so gm.environment.set applies to this
          send), post-response after the response arrives. Outer folders run first.
        </p>
        <ScriptHelp />
      </div>
      <div class="script-label">Pre-request</div>
      <ScriptEditor value={props.pre} onChange={props.onPre} ariaLabel={`Pre-request script of this ${props.noun}`}
        placeholder={'gm.request.headers.set("X-Request-Id", gm.crypto.uuid())'} />
      <div class="script-label">Post-response</div>
      <ScriptEditor value={props.post} onChange={props.onPost} ariaLabel={`Post-response script of this ${props.noun}`}
        placeholder={'gm.environment.set("token", gm.response.json().token)'} />
      <p class="muted small scripts-note">
        Scripts read variables with gm.environment.get("KEY"), not {"{{KEY}}"}. They are saved on the server and run for
        everyone on the project.
      </p>
    </div>
  );
}
