// Tells an open History tab that the history changed elsewhere (a send finished,
// Settings cleared or pruned it), so it re-fetches its first page. The data stays
// in Go/SQLite; this is only a change counter.
import { createSignal } from "solid-js";

const [tick, setTick] = createSignal(0);

export const historyTick = tick;
export const historyChanged = () => setTick((n) => n + 1);
