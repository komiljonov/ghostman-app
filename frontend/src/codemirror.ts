// The one shared CodeMirror 6 setup. Imported lazily (dynamic import) the first
// time an editor is shown, so CodeMirror stays out of the startup bundle.
import { basicSetup, EditorView } from "codemirror";
import { Compartment, EditorState, Extension, RangeSetBuilder, StateEffect } from "@codemirror/state";
import {
  Decoration, DecorationSet, hoverTooltip, keymap, placeholder as placeholderExt, ViewPlugin, ViewUpdate,
} from "@codemirror/view";
import { defaultKeymap, history, historyKeymap } from "@codemirror/commands";
import { json } from "@codemirror/lang-json";
import { oneDark } from "@codemirror/theme-one-dark";
import { classify, EnvDisplay, tooltipModel } from "./vars";

// ---- {{var}} highlighting + hover (shared by every editor) ----

// Dispatched when the environment changes so decorations are recomputed.
const refreshVars = StateEffect.define<null>();

const resolvedMark = Decoration.mark({ class: "cm-var cm-var-resolved" });
const unresolvedMark = Decoration.mark({ class: "cm-var cm-var-unresolved" });

function buildDecorations(view: EditorView, getEnv: () => EnvDisplay): DecorationSet {
  const builder = new RangeSetBuilder<Decoration>();
  const env = getEnv();
  for (const { from, to } of view.visibleRanges) {
    const text = view.state.doc.sliceString(from, to);
    for (const t of classify(text, env)) {
      builder.add(from + t.from, from + t.to, t.resolved ? resolvedMark : unresolvedMark);
    }
  }
  return builder.finish();
}

function tooltipDOM(key: string, env: EnvDisplay): HTMLElement {
  const m = tooltipModel(key, env);
  const root = document.createElement("div");
  root.className = `var-tooltip ${m.resolved ? "is-resolved" : "is-unresolved"}`;

  const head = document.createElement("div");
  head.className = "var-tooltip-key";
  head.textContent = key;
  if (m.secret) {
    const badge = document.createElement("span");
    badge.className = "var-tooltip-tag";
    badge.textContent = "secret";
    head.append(" ", badge);
  }
  root.append(head);

  const value = document.createElement("div");
  value.className = "var-tooltip-value";
  value.textContent = m.display;
  root.append(value);

  if (m.revealValue !== undefined) {
    const reveal = document.createElement("button");
    reveal.type = "button";
    reveal.className = "var-tooltip-reveal";
    reveal.textContent = "Reveal";
    let shown = false;
    reveal.addEventListener("mousedown", (e) => e.preventDefault()); // keep editor focus
    reveal.addEventListener("click", () => {
      shown = !shown;
      value.textContent = shown ? m.revealValue! : m.display;
      reveal.textContent = shown ? "Hide" : "Reveal";
    });
    root.append(reveal);
  }

  if (m.envName !== null) {
    const source = document.createElement("div");
    source.className = "var-tooltip-source";
    source.textContent = m.tag ? `${m.envName} · ${m.tag}` : m.envName;
    root.append(source);
  }
  return root;
}

// Highlights {{tokens}} (green = resolved by the active environment, orange =
// unresolved) and shows a hover card. getEnv reads the Solid env store; nothing
// here calls the bridge.
export function varHighlighting(getEnv: () => EnvDisplay): Extension {
  const plugin = ViewPlugin.fromClass(
    class {
      decorations: DecorationSet;
      constructor(view: EditorView) {
        this.decorations = buildDecorations(view, getEnv);
      }
      update(u: ViewUpdate) {
        const refreshed = u.transactions.some((tr) => tr.effects.some((e) => e.is(refreshVars)));
        if (u.docChanged || u.viewportChanged || refreshed) this.decorations = buildDecorations(u.view, getEnv);
      }
    },
    { decorations: (v) => v.decorations },
  );

  const hover = hoverTooltip((view, pos) => {
    const line = view.state.doc.lineAt(pos);
    const offset = pos - line.from;
    const token = classify(line.text, getEnv()).find((t) => offset >= t.from && offset <= t.to);
    if (!token) return null;
    return {
      pos: line.from + token.from,
      end: line.from + token.to,
      above: true,
      create: () => ({ dom: tooltipDOM(token.key, getEnv()) }),
    };
  });

  return [plugin, hover];
}

// ---- Raw body editor ----

export interface CodeEditorHandle {
  setJSON: (on: boolean) => void;
  refreshVars: () => void;
  destroy: () => void;
}

export function createCodeEditor(
  parent: HTMLElement,
  doc: string,
  isJSON: boolean,
  onChange: (text: string) => void,
  getEnv: () => EnvDisplay,
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
        varHighlighting(getEnv),
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
    refreshVars: () => view.dispatch({ effects: refreshVars.of(null) }),
    destroy: () => view.destroy(),
  };
}

// ---- Single-line URL editor ----

export interface LineEditorHandle {
  refreshVars: () => void;
  focus: () => void;
  destroy: () => void;
}

// A one-line CM6 editor that looks like the URL input: newlines are stripped
// (pasting a multi-line URL joins it), Enter runs onEnter (Send).
export function createLineEditor(
  parent: HTMLElement,
  doc: string,
  opts: { placeholder: string; onChange: (text: string) => void; onEnter: () => void; getEnv: () => EnvDisplay },
): LineEditorHandle {
  const view = new EditorView({
    parent,
    state: EditorState.create({
      doc: doc.replace(/[\r\n]+/g, ""),
      extensions: [
        history(),
        keymap.of([
          { key: "Enter", run: () => (opts.onEnter(), true) },
          { key: "Mod-Enter", run: () => (opts.onEnter(), true) },
          ...defaultKeymap,
          ...historyKeymap,
        ]),
        EditorState.transactionFilter.of((tr) => {
          if (!tr.docChanged || tr.newDoc.lines <= 1) return tr;
          // Rebuild the change without line breaks.
          const changes: { from: number; to: number; insert: string }[] = [];
          tr.changes.iterChanges((fromA, toA, _fromB, _toB, inserted) => {
            changes.push({ from: fromA, to: toA, insert: inserted.toString().replace(/[\r\n]+/g, "") });
          });
          return [{ changes, selection: tr.selection, scrollIntoView: tr.scrollIntoView }];
        }),
        placeholderExt(opts.placeholder),
        varHighlighting(opts.getEnv),
        EditorView.updateListener.of((u) => {
          if (u.docChanged) opts.onChange(u.state.doc.toString());
        }),
        EditorView.contentAttributes.of({ "aria-label": "URL", spellcheck: "false", autocapitalize: "off" }),
      ],
    }),
  });
  return {
    refreshVars: () => view.dispatch({ effects: refreshVars.of(null) }),
    focus: () => view.focus(),
    destroy: () => view.destroy(),
  };
}
