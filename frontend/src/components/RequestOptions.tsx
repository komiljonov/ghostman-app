import Dropdown from "./Dropdown";
import FormError from "./FormError";
import Icon from "./Icon";

interface Props {
  followRedirects: boolean;
  error?: string;
  onFollowRedirects: (follow: boolean) => void;
}

// The ⚙ left of Send: per-request client options, stored only on this machine.
// Today: follow redirects (default on). When an option is off its default, the
// gear carries a dot so it is not forgotten.
export default function RequestOptions(props: Props) {
  return (
    <Dropdown triggerLabel="Request options" align="right" menuClass="request-options" menuRole="dialog"
      triggerClass={`request-options-trigger${props.followRedirects ? "" : " modified"}`}
      trigger={<span title={props.followRedirects ? "Request options" : "Request options — redirects are not followed"}>
        <Icon name="settings" /></span>}>
      {() => (
        <div class="request-options-body">
          <label class="choice">
            <input type="checkbox" checked={props.followRedirects}
              onChange={(e) => props.onFollowRedirects(e.currentTarget.checked)} />
            Follow redirects
          </label>
          <p class="request-options-hint">
            Up to 10 redirects. Off: the 3xx response itself is shown. Saved on this machine only.
          </p>
          <FormError message={props.error} />
        </div>
      )}
    </Dropdown>
  );
}
