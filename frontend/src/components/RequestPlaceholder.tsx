import { createResource, Show } from "solid-js";
import { GetRequest } from "../../wailsjs/go/main/App";
import { handleProblem } from "../authStore";
import MethodBadge from "./MethodBadge";

interface Props {
  requestId: string;
  refreshTick: number;
}

// Read-only request view in the main pane; the editor replaces it in the next step.
export default function RequestPlaceholder(props: Props) {
  const [request] = createResource(() => ({ id: props.requestId, tick: props.refreshTick }), async (src) => {
    const result = await GetRequest(src.id);
    handleProblem(result.error);
    return result;
  });

  return (
    <div class="team-view">
      <div class="pane-kicker">Request</div>
      <Show when={request()} fallback={<p class="placeholder">Loading request…</p>}>
        {(res) => (
          <Show when={res().data} fallback={<p class="form-error">{res().error?.message}</p>}>
            {(r) => (
              <>
                <h2>{r().name}</h2>
                <div class="request-line">
                  <MethodBadge method={r().method} />
                  <code class="request-url">{r().url || "(no URL yet)"}</code>
                </div>
                <p class="placeholder">Read-only for now — the request editor comes next.</p>
              </>
            )}
          </Show>
        )}
      </Show>
    </div>
  );
}
