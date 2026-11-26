import { Show } from "solid-js";
import { appNotice, dismissNotice } from "../noticeStore";
import Icon from "./Icon";

// The app-wide notice (noticeStore.ts): fixed at the window's bottom right, above
// the panes, below modals.
export default function AppNotice() {
  return (
    <Show when={appNotice()}>
      {(n) => (
        <div classList={{ "response-toast": true, "app-notice": true, error: n().error }} role="status">
          <span>{n().text}</span>
          <button type="button" class="response-toast-close" aria-label="Dismiss" onClick={dismissNotice}>
            <Icon name="close" size={14} />
          </button>
        </div>
      )}
    </Show>
  );
}
