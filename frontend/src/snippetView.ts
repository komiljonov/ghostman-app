// The code panel's preview (CodegenPanel.tsx): a read-only CodeMirror view with
// the shared theme and the snippet language's highlighting. Language support is
// loaded on demand (one chunk per language), and the module itself is imported
// lazily by the panel, so none of it is in the main bundle.
import { Compartment, EditorState, Extension } from "@codemirror/state";
import type { StreamParser } from "@codemirror/language";
import { EditorView } from "@codemirror/view";
import { appShortcuts, theme } from "./codemirror";

// Go codegen Target.Language → the CodeMirror language support.
const languages: Record<string, () => Promise<Extension>> = {
  shell: async () => {
    const [{ StreamLanguage }, { shell }] = await Promise.all([import("@codemirror/language"), import("@codemirror/legacy-modes/mode/shell")]);
    // legacy-modes types its parsers with @codemirror/streamparser's StringStream; the
    // object is the same shape StreamLanguage takes (only the typings are split).
    return StreamLanguage.define(shell as unknown as StreamParser<unknown>);
  },
  javascript: async () => (await import("@codemirror/lang-javascript")).javascript(),
  python: async () => (await import("@codemirror/lang-python")).python(),
  go: async () => (await import("@codemirror/lang-go")).go(),
};

export interface SnippetViewHandle {
  set: (text: string, language: string) => void;
  destroy: () => void;
}

export function createSnippetView(parent: HTMLElement, ariaLabel: string): SnippetViewHandle {
  const lang = new Compartment();
  let current = "";
  let seq = 0;
  const view = new EditorView({
    parent,
    state: EditorState.create({
      doc: "",
      extensions: [
        appShortcuts,
        theme,
        lang.of([]),
        EditorState.readOnly.of(true),
        EditorView.editable.of(false),
        EditorView.lineWrapping,
        EditorView.contentAttributes.of({ "aria-label": ariaLabel, tabindex: "0" }),
      ],
    }),
  });
  return {
    set: (text, language) => {
      if (view.state.doc.toString() !== text) {
        view.dispatch({ changes: { from: 0, to: view.state.doc.length, insert: text } });
      }
      if (language === current) return;
      current = language;
      const mine = ++seq;
      void (languages[language]?.() ?? Promise.resolve([])).then((ext) => {
        if (mine === seq) view.dispatch({ effects: lang.reconfigure(ext) });
      });
    },
    destroy: () => view.destroy(),
  };
}
