// Which local file each form-data file field sends, per request (Go: request_files,
// this machine only — never synced). Fetched when a multipart table mounts and
// after every choose / clear / key rename; the table reads it to render each file
// cell's state (multipart.fileState).
import { createStore } from "solid-js/store";
import { ChooseRequestFile, ClearRequestFile, ListRequestFiles, RenameRequestFileKey } from "../wailsjs/go/main/App";
import { handleProblem } from "./authStore";
import type { LocalFile } from "./multipart";

const [files, setFiles] = createStore<Record<string, Record<string, LocalFile>>>({});

export const localFile = (requestId: string, key: string): LocalFile | undefined => files[requestId]?.[key.trim()];

export async function loadLocalFiles(requestId: string): Promise<void> {
  const r = await ListRequestFiles(requestId);
  handleProblem(r.error);
  setFiles(requestId, Object.fromEntries((r.data ?? []).map((f) => [f.key, f])));
}

// Opens the native dialog; resolves to the chosen file's name (undefined when
// cancelled), or an error message.
export async function chooseLocalFile(requestId: string, key: string): Promise<{ name?: string; error?: string }> {
  const r = await ChooseRequestFile(requestId, key);
  handleProblem(r.error);
  if (r.error) return { error: r.error.message };
  if (!r.data) return {};
  await loadLocalFiles(requestId);
  return { name: r.data.file_name };
}

export async function clearLocalFile(requestId: string, key: string): Promise<void> {
  handleProblem((await ClearRequestFile(requestId, key)).error);
  await loadLocalFiles(requestId);
}

// Key edits move the path along, one after another (typing renames per keystroke).
let renames: Promise<void> = Promise.resolve();
export function renameLocalFile(requestId: string, oldKey: string, newKey: string): Promise<void> {
  renames = renames.then(async () => {
    handleProblem((await RenameRequestFileKey(requestId, oldKey, newKey)).error);
    await loadLocalFiles(requestId);
  });
  return renames;
}
