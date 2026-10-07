// The current project id, mirrored from the Go workspace snapshot MainScreen holds,
// for views outside it (the Settings modal's "Clear current project's history").
import { createSignal } from "solid-js";

const [projectId, setProjectId] = createSignal("");

export const currentProjectId = projectId;
export const publishProjectId = (id: string) => setProjectId(id);
