// The code panel's persisted choices (Go settings: GetCodegenPrefs /
// SetCodegenPrefs) and the target list. Loaded once; every change is saved.
// "Copy as curl" (tree / tab menus) uses the same values toggle, line mode and
// proxy choice, with the target forced to curl.
import { createSignal } from "solid-js";
import { CodegenTargets, GetCodegenPrefs, SetCodegenPrefs } from "../wailsjs/go/main/App";
import { main, session } from "../wailsjs/go/models";
import { ClipboardSetText } from "../wailsjs/runtime/runtime";
import { handleProblem } from "./authStore";
import { CodegenPrefs, DEFAULT_CODEGEN_PREFS } from "./codegenModel";
import { flashNotice } from "./noticeStore";

export interface CodegenTarget {
  id: string;
  label: string;
  language: string;
}

const [prefs, setPrefs] = createSignal<CodegenPrefs>(DEFAULT_CODEGEN_PREFS);
const [targets, setTargets] = createSignal<CodegenTarget[]>([]);
let loaded: Promise<void> | undefined;

export const codegenPrefs = prefs;
export const codegenTargets = targets;

export function loadCodegenPrefs(): Promise<void> {
  loaded ??= Promise.all([GetCodegenPrefs(), CodegenTargets()]).then(([p, t]) => {
    setPrefs({ ...DEFAULT_CODEGEN_PREFS, ...p });
    setTargets(t ?? []);
  });
  return loaded;
}

export function setCodegenPrefs(patch: Partial<CodegenPrefs>) {
  const next = { ...prefs(), ...patch };
  setPrefs(next);
  void SetCodegenPrefs(main.CodegenOptions.createFrom(next));
}

// The options for a bound call (curl forced for "Copy as curl").
export const codegenOptions = (over: Partial<CodegenPrefs> = {}) => main.CodegenOptions.createFrom({ ...prefs(), ...over });

type SnippetCall = (gen: main.CodegenOptions) => Promise<{ data?: { snippet: string; secrets: boolean } | null; error?: session.Problem | null }>;

// "Copy as curl" (tree / tab menus, history): the persisted values toggle, line
// mode and proxy choice with the target forced to curl, straight to the clipboard;
// the outcome is the app-wide notice.
export async function copyAsCurl(generate: SnippetCall) {
  await loadCodegenPrefs();
  const r = await generate(codegenOptions({ target: "curl" }));
  handleProblem(r.error ?? undefined);
  if (!r.data) {
    flashNotice(r.error?.message ?? "could not generate curl", true);
    return;
  }
  await ClipboardSetText(r.data.snippet);
  flashNotice(r.data.secrets ? "Copied as curl — includes secret values" : "Copied as curl");
}
