import { describe, expect, it, vi } from "vitest";

const setPrefs = vi.fn();
const clipboard = vi.fn();
vi.mock("../wailsjs/go/main/App", () => ({
  GetCodegenPrefs: async () => ({ target: "python", resolved: false, one_line: true, proxy: false }),
  SetCodegenPrefs: (o: unknown) => setPrefs(o),
  CodegenTargets: async () => [{ id: "curl", label: "curl", language: "shell" }, { id: "python", label: "Python (requests)", language: "python" }],
}));
vi.mock("../wailsjs/runtime/runtime", () => ({ ClipboardSetText: (s: string) => clipboard(s) }));
vi.mock("./authStore", () => ({ handleProblem: () => undefined }));

import { session } from "../wailsjs/go/models";
import { controlsFor, createSnippetRunner, DEFAULT_CODEGEN_PREFS, RunnerState, Snippet } from "./codegenModel";
import { codegenPrefs, codegenTargets, copyAsCurl, loadCodegenPrefs, setCodegenPrefs } from "./codegenStore";
import { appNotice } from "./noticeStore";

const snip = (snippet: string, secrets = false): Snippet => ({ snippet, language: "shell", warnings: [], secrets });

describe("code panel: controls", () => {
  it("curl-only controls stay, disabled with the reason, for the other languages", () => {
    expect(controlsFor("curl", true)).toMatchObject({ lineMode: { enabled: true }, proxy: { enabled: true } });
    expect(controlsFor("curl", false).proxy).toMatchObject({ enabled: false, title: "This request does not use a proxy" });
    const py = controlsFor("python", true);
    expect(py.lineMode.enabled).toBe(false);
    expect(py.lineMode.title).toMatch(/curl only/);
    expect(py.proxy.enabled).toBe(false);
    expect(controlsFor("curl", true).lineMode.title).toMatch(/Git Bash/);
  });
});

describe("code panel: generation", () => {
  it("every change regenerates; a late answer for an older choice is dropped", async () => {
    const releases: (() => void)[] = [];
    const generate = vi.fn((p: typeof DEFAULT_CODEGEN_PREFS) =>
      new Promise<{ data: Snippet }>((res) => releases.push(() => res({ data: snip(`${p.target}:${p.one_line}`) }))));
    const states: RunnerState[] = [];
    const r = createSnippetRunner(generate, (s) => states.push(s));
    const first = r.run({ ...DEFAULT_CODEGEN_PREFS, one_line: false });
    const second = r.run({ ...DEFAULT_CODEGEN_PREFS, one_line: true });
    expect(r.copyText()).toBeUndefined(); // nothing to copy while loading
    releases[1](); // the newer answer first …
    await second;
    releases[0](); // … the older one late
    await first;
    expect(generate).toHaveBeenCalledTimes(2);
    expect(states.at(-1)).toEqual({ snippet: snip("curl:true"), loading: false });
    expect(r.copyText()).toBe("curl:true"); // Copy = exactly the preview
  });

  it("an error replaces the preview; nothing is copied", async () => {
    const r = createSnippetRunner(async () => ({ error: { message: "invalid URL" } }), () => undefined);
    await r.run(DEFAULT_CODEGEN_PREFS);
    expect(r.copyText()).toBeUndefined();
  });
});

describe("code panel: persisted choices and Copy as curl", () => {
  it("loads the saved choices once; every change is saved whole", async () => {
    await loadCodegenPrefs();
    expect(codegenPrefs()).toEqual({ target: "python", resolved: false, one_line: true, proxy: false });
    expect(codegenTargets().map((t) => t.id)).toEqual(["curl", "python"]);
    setCodegenPrefs({ target: "curl" });
    expect(setPrefs).toHaveBeenLastCalledWith(expect.objectContaining({ target: "curl", resolved: false, one_line: true, proxy: false }));
    expect(codegenPrefs().target).toBe("curl");
  });

  it("Copy as curl: target forced to curl, the other choices kept, exactly the snippet copied", async () => {
    setCodegenPrefs({ target: "python" });
    const generate = vi.fn(async () => ({ data: snip("curl 'https://x' -H 'A: b'", true) }));
    await copyAsCurl(generate);
    expect(generate).toHaveBeenCalledWith(expect.objectContaining({ target: "curl", resolved: false, one_line: true }));
    expect(clipboard).toHaveBeenLastCalledWith("curl 'https://x' -H 'A: b'");
    expect(appNotice()).toEqual({ text: "Copied as curl — includes secret values", error: false });
    expect(codegenPrefs().target).toBe("python"); // the panel's choice is untouched
    await copyAsCurl(async () => ({ error: session.Problem.createFrom({ kind: "request", message: "invalid URL" }) }));
    expect(appNotice()).toEqual({ text: "invalid URL", error: true });
  });
});
