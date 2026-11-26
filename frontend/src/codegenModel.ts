// The code panel's rules (CodegenPanel.tsx): its persisted choices, which
// controls apply to a target (disabled with a reason, never hidden), and the
// generation runner — every change re-renders through ONE bound call
// (GenerateCode: Go builds the snippet from the send pipeline), answers that
// arrive after a newer request are dropped, and Copy copies exactly the snippet
// shown. Pure: the bound calls are injected (unit-tested).

export interface CodegenPrefs {
  target: string; // curl | fetch | python | go
  resolved: boolean; // real values (secrets, a signed JWT) vs {{variables}}
  one_line: boolean; // curl only
  proxy: boolean; // curl only: -x for the resolved proxy
}

export const DEFAULT_CODEGEN_PREFS: CodegenPrefs = { target: "curl", resolved: true, one_line: false, proxy: false };

export interface Snippet {
  snippet: string;
  language: string;
  warnings: string[];
  secrets: boolean;
}

export interface Control {
  enabled: boolean;
  title: string;
}

export const SECRETS_NOTE = "includes secret values";
export const ONE_LINE_HINT =
  "One line targets bash-compatible shells (Linux, macOS, Git Bash on Windows); a cmd.exe variant is a future target. " +
  "Windows curl.exe reads its arguments in the ANSI code page: non-ASCII header values or form-data text may not survive " +
  "(bodies are piped through stdin, so they do).";
export const HISTORY_CURL_TITLE = "Copy this send as curl — from the request as sent (values were already resolved; the values toggle does not apply)";

// Controls that only make sense for curl stay visible, disabled with the reason.
export function controlsFor(target: string, proxyResolved: boolean): { lineMode: Control; proxy: Control } {
  const curl = target === "curl";
  return {
    lineMode: curl ? { enabled: true, title: ONE_LINE_HINT } : { enabled: false, title: "curl only — the other languages are code, multiline by nature" },
    proxy: !curl
      ? { enabled: false, title: "curl only — the other snippets note the proxy in a comment" }
      : proxyResolved
        ? { enabled: true, title: "Add -x for the proxy this request uses (never its password)" }
        : { enabled: false, title: "This request does not use a proxy" },
  };
}

export type GenerateFn = (prefs: CodegenPrefs) => Promise<{ data?: Snippet | null; error?: { message: string } | null }>;

export interface RunnerState {
  snippet?: Snippet;
  error?: string;
  loading: boolean;
}

// Regenerates on every request; only the newest answer is applied (a slow
// answer for an older choice never overwrites a newer one).
export function createSnippetRunner(generate: GenerateFn, onState: (s: RunnerState) => void) {
  let seq = 0;
  let last: RunnerState = { loading: false };
  const set = (s: RunnerState) => {
    last = s;
    onState(s);
  };
  return {
    async run(prefs: CodegenPrefs) {
      const mine = ++seq;
      set({ ...last, loading: true });
      const r = await generate(prefs);
      if (mine !== seq) return;
      set(r.data ? { snippet: r.data, loading: false } : { error: r.error?.message ?? "could not generate the snippet", loading: false });
    },
    // What Copy puts on the clipboard: exactly the snippet shown (nothing while loading or failed).
    copyText: (): string | undefined => (last.loading || last.error ? undefined : last.snippet?.snippet),
  };
}
