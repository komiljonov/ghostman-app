import { createSignal } from "solid-js";
import { CreateInvitation } from "../../wailsjs/go/main/App";
import { createAction } from "../action";
import FormError from "./FormError";

interface Props {
  teamId: string;
  onInvited: () => void;
}

export default function InviteForm(props: Props) {
  const [email, setEmail] = createSignal("");
  const invite = createAction(CreateInvitation);

  const submit = async (e: SubmitEvent) => {
    e.preventDefault();
    const result = await invite.run(props.teamId, email());
    if (result && !result.error) {
      setEmail("");
      props.onInvited();
    }
  };

  return (
    <form class="inline-form" onSubmit={submit}>
      <input type="email" placeholder="colleague@example.com" aria-label="Email to invite" required
        value={email()} disabled={invite.pending()}
        onInput={(e) => {
          setEmail(e.currentTarget.value);
          invite.setError(undefined);
        }} />
      <button class="primary" type="submit" disabled={invite.pending()}>
        {invite.pending() ? "Inviting…" : "Invite"}
      </button>
      <FormError message={invite.error()} />
    </form>
  );
}
