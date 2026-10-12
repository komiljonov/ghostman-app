import { createSignal, onCleanup, Show } from "solid-js";
import { ChooseImportFile, ImportPostmanCollection, ImportPostmanEnvironment } from "../../wailsjs/go/main/App";
import type { main, postman } from "../../wailsjs/go/models";
import { EventsOn } from "../../wailsjs/runtime/runtime";
import { fileSummary, progressLabel } from "../importReport";
import Icon from "./Icon";
import Modal from "./Modal";

interface Props {
  projectId: string;
  projectName: string;
  onClose: () => void;
  onImported: (report: postman.Report) => void; // the import ran (even part-way): show the report
}

// Profile menu → Import…: pick a Postman export (native dialog; Go sniffs the
// kind), then import it into the CURRENT project. The file card, the progress row
// and the buttons keep their place in every state (nothing jumps); while an import
// runs the dialog cannot be dismissed — Go is creating things and the report is
// coming.
export default function ImportModal(props: Props) {
  const [file, setFile] = createSignal<main.ImportFile>();
  const [error, setError] = createSignal("");
  const [choosing, setChoosing] = createSignal(false);
  const [running, setRunning] = createSignal(false);
  const [progress, setProgress] = createSignal<{ done: number; total: number }>();

  const off = EventsOn("import:progress", (p: { done: number; total: number }) => setProgress(p));
  onCleanup(off);

  const choose = async () => {
    setChoosing(true);
    try {
      const res = await ChooseImportFile();
      if (res.error) {
        setFile(undefined);
        setError(res.error.message);
      } else if (res.data) {
        setFile(res.data);
        setError("");
      }
    } finally {
      setChoosing(false);
    }
  };

  const run = async () => {
    const f = file();
    if (!f || running()) return;
    setRunning(true);
    setProgress(undefined);
    try {
      const res = f.kind === "environment"
        ? await ImportPostmanEnvironment(props.projectId, f.path)
        : await ImportPostmanCollection(props.projectId, f.path);
      if (res.error || !res.data) {
        setError(res.error?.message ?? "The import did not return a report.");
        return;
      }
      props.onImported(res.data);
    } finally {
      setRunning(false);
    }
  };

  const close = () => !running() && props.onClose();
  const where = () => (file()?.kind === "environment"
    ? "as a new environment"
    : "as one new folder at the top of the tree");

  return (
    <Modal title="Import from Postman" onClose={close} class="import-modal">
      <p class="muted small import-intro">
        A collection (Collection v2.0 or v2.1 export) or an environment exported from Postman. Everything is imported
        into <strong>{props.projectName}</strong>{file() ? ` ${where()}` : ""}; you get a full report afterwards.
      </p>
      <div class="import-pick">
        <button type="button" class="import-choose" disabled={running() || choosing()} onClick={() => void choose()}>
          <Icon name="import" size={14} />
          <span>{file() ? "Choose another file…" : "Choose file…"}</span>
        </button>
        <div classList={{ "import-file": true, empty: !file() && !error(), error: !!error() }} aria-live="polite">
          <Show when={!error()} fallback={<span class="import-error">{error()}</span>}>
            <Show when={file()} fallback={<span class="muted">No file chosen</span>}>
              {(f) => (
                <>
                  <strong class="import-file-name" title={f().path}>{f().name || f().file_name}</strong>
                  <span class="muted small">{fileSummary(f())} · {f().file_name}</span>
                </>
              )}
            </Show>
          </Show>
        </div>
      </div>
      {/* Always laid out; only visible while importing. */}
      <div classList={{ "import-progress": true, active: running() }} aria-hidden={!running()}>
        <div class="import-bar">
          <div class="import-bar-fill"
            style={{ width: `${progress() && progress()!.total > 0 ? Math.round((progress()!.done / progress()!.total) * 100) : 0}%` }} />
        </div>
        <span class="muted small" role="status">{progressLabel(progress())}</span>
      </div>
      <div class="modal-actions">
        <button type="button" disabled={running()} onClick={close}>Cancel</button>
        <button type="button" class="primary" disabled={!file() || running()}
          title={file() ? "" : "Choose a file first"} onClick={() => void run()}>
          {running() ? "Importing…" : "Import"}
        </button>
      </div>
    </Modal>
  );
}
