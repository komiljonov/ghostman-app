// The one shared CodeMirror 6 setup. Imported lazily (dynamic import) the first
// time a raw body editor is shown, so CodeMirror stays out of the startup bundle.
import { basicSetup, EditorView } from "codemirror";
import { Compartment, EditorState } from "@codemirror/state";
import { json } from "@codemirror/lang-json";
import { oneDark } from "@codemirror/theme-one-dark";

export interface CodeEditorHandle {
  setJSON: (on: boolean) => void;
  destroy: () => void;
}

export function createCodeEditor(
  parent: HTMLElement,
  doc: string,
  isJSON: boolean,
  onChange: (text: string) => void,
): CodeEditorHandle {
  const language = new Compartment();
  const view = new EditorView({
    parent,
    state: EditorState.create({
      doc,
      extensions: [
        basicSetup,
        oneDark,
        language.of(isJSON ? json() : []),
        EditorView.lineWrapping,
        EditorView.updateListener.of((u) => {
          if (u.docChanged) onChange(u.state.doc.toString());
        }),
        EditorView.theme({
          "&": { height: "100%", fontSize: "13px" },
          ".cm-scroller": { fontFamily: "var(--mono)" },
          "&.cm-focused": { outline: "none" },
        }),
      ],
    }),
  });
  return {
    setJSON: (on) => view.dispatch({ effects: language.reconfigure(on ? json() : []) }),
    destroy: () => view.destroy(),
  };
}
