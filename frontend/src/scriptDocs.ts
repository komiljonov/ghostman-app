// The gm API reference for the script editors' ? popover. The one source is Go
// (internal/scripting/docs.go, kept in step with the VM by a test); it is fetched
// once and grouped here.
import { GetScriptAPIDocs } from "../wailsjs/go/main/App";
import type { scripting } from "../wailsjs/go/models";

export interface DocGroup {
  group: string;
  docs: scripting.Doc[];
}

export function groupDocs(docs: scripting.Doc[]): DocGroup[] {
  const out: DocGroup[] = [];
  for (const d of docs) {
    const last = out[out.length - 1];
    if (last && last.group === d.group) last.docs.push(d);
    else out.push({ group: d.group, docs: [d] });
  }
  return out;
}

// "pre-scripts only" / "post-scripts only" / "".
export const whereLabel = (where: string) =>
  where === "pre" ? "pre-request scripts only" : where === "post" ? "post-response scripts only" : "";

let cache: Promise<scripting.Doc[]> | undefined;
export function scriptDocs(): Promise<scripting.Doc[]> {
  cache ??= GetScriptAPIDocs().catch(() => {
    cache = undefined; // retry next time
    return [];
  });
  return cache;
}
