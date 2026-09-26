import { createSignal } from "solid-js";
import { session } from "../wailsjs/go/models";
import { handleProblem } from "./authStore";

type Outcome = { error?: session.Problem };

// createAction wraps one bound-method call for one control: `pending` disables the
// control while in flight, `error` holds the server's message to show next to it.
// `run` resolves to the result so callers can react to success (e.g. refetch).
export function createAction<A extends unknown[], R extends Outcome>(fn: (...args: A) => Promise<R>) {
  const [pending, setPending] = createSignal(false);
  const [error, setError] = createSignal<string>();

  const run = async (...args: A): Promise<R | undefined> => {
    if (pending()) return undefined;
    setPending(true);
    setError(undefined);
    try {
      const result = await fn(...args);
      if (result.error) {
        setError(result.error.message);
        handleProblem(result.error);
      }
      return result;
    } finally {
      setPending(false);
    }
  };

  return { pending, error, setError, run };
}
