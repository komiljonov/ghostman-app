import { createEffect, createSignal, For } from "solid-js";
import { SetRequestFollowRedirects } from "../../wailsjs/go/main/App";
import { handleProblem } from "../authStore";
import { redirectDefault } from "../redirectDefault";
import { followOptions, FollowValue, ownFollow, resolveFollow, saveFollow } from "../requestSettings";
import { sourceLabel } from "../settingsResolver";
import { currentTree, requestTreeReload } from "../treeStore";
import FormError from "./FormError";

interface Props {
  requestId: string;
}

// The request's Settings sub-tab. Values cascade (request → folders → global,
// settingsResolver.ts); labels follow the tree store live, so a folder change, a
// move or the global toggle update them without reopening the tab. Saved on the
// server (shared with the team) right away.
export default function RequestSettingsPanel(props: Props) {
  const [pending, setPending] = createSignal<FollowValue>(); // shown while saving
  const [error, setError] = createSignal<string>();
  const own = () => pending() ?? ownFollow(currentTree(), props.requestId);
  const options = () => followOptions(currentTree(), props.requestId, redirectDefault());
  const effective = () => resolveFollow(currentTree(), props.requestId, redirectDefault());

  const choose = async (value: FollowValue) => {
    setPending(value);
    setError(undefined);
    const problem = await saveFollow(props.requestId, value, { set: SetRequestFollowRedirects, reload: () => void requestTreeReload() });
    handleProblem(problem);
    setError(problem?.message);
    if (problem) setPending(undefined); // back to what the server has
  };
  // The choice shows until the re-fetched tree carries it.
  createEffect(() => {
    if (pending() && ownFollow(currentTree(), props.requestId) === pending()) setPending(undefined);
  });

  return (
    <div class="request-settings">
      <fieldset class="request-setting">
        <legend>Follow redirects</legend>
        <For each={options()}>
          {(o) => (
            <label class="choice">
              <input type="radio" name="follow-redirects" value={o.value} checked={own() === o.value}
                onChange={() => void choose(o.value)} />
              {o.label}
            </label>
          )}
        </For>
        <p class="request-setting-hint">
          Effective: <strong>{effective().value ? "redirects are followed" : "redirects are not followed"}</strong>
          {" "}({sourceLabel(effective().source)}).
          {" "}{effective().value
            ? "Up to 10; the timing panel shows every hop."
            : "A 3xx response is shown as it is, with its Location header."}
          {" "}Saved on the server for everyone on the project; the global setting is in Settings.
        </p>
        <FormError message={error()} />
      </fieldset>
    </div>
  );
}
