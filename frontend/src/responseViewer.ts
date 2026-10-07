// The response body viewer (Pretty / Raw): a read-only CodeMirror 6 view.
//
// Why CodeMirror rather than a custom Solid tree: it renders only the lines in
// view (smooth at the 256 KB cap), keeps native text selection and keyboard
// scrolling (the view is focusable; read-only blocks edits), and folding is built
// in — the JSON parser gives the object/array ranges. Pretty JSON gets the fold
// gutter (▾/▸) and "{…} 12 keys" placeholders (jsonFold.ts); Raw and the
// truncated-JSON fallback are plain text without folding.
//
// Search highlighting decorates only the matches inside the visible ranges
// (responseSearch.matchesIn), so it costs the same for 10 or 10 000 matches.
// Imported lazily together with codemirror.ts.
import { codeFolding, foldedRanges, foldEffect, foldGutter, foldService, unfoldAll } from "@codemirror/language";
import { defaultKeymap } from "@codemirror/commands";
import { json } from "@codemirror/lang-json";
import { EditorState, Extension, Prec, RangeSetBuilder, StateEffect, StateField } from "@codemirror/state";
import { Decoration, DecorationSet, EditorView, keymap, ViewPlugin, ViewUpdate } from "@codemirror/view";
import { appShortcuts, theme } from "./codemirror";
import { childInfo, collapseRanges, foldRangeForLine, foldsOf, placeholderLabel, Range, revealEffects } from "./jsonFold";
import { Match, matchesIn } from "./responseSearch";

export interface ResponseViewerOptions {
  onFind: () => void; // Ctrl/Cmd+F inside the viewer
  onFoldsChanged: () => void; // the user folded/unfolded (visible matches change)
  onContextMenu: (e: MouseEvent) => void;
}

export interface ResponseViewerHandle {
  // New content (a new response or another view): resets folds, selection, scroll.
  setContent: (text: string, structured: boolean, folds?: Range[]) => void;
  setWrap: (on: boolean) => void;
  collapseAll: () => void;
  expandAll: () => void;
  folds: () => Range[];
  setSearch: (matches: Match[], current: number) => void;
  reveal: (m: Match) => void;
  selection: () => string;
  focus: () => void;
  destroy: () => void;
}

// ---- Search highlighting (viewport only) ----

const setSearchEffect = StateEffect.define<{ matches: Match[]; current: number }>();
const searchField = StateField.define<{ matches: Match[]; current: number }>({
  create: () => ({ matches: [], current: -1 }),
  update: (v, tr) => {
    for (const e of tr.effects) if (e.is(setSearchEffect)) return e.value;
    return v;
  },
});
const matchMark = Decoration.mark({ class: "cm-resp-match" });
const currentMark = Decoration.mark({ class: "cm-resp-match cm-resp-current" });

const searchHighlight = ViewPlugin.fromClass(class {
  decorations: DecorationSet;
  constructor(view: EditorView) {
    this.decorations = this.build(view);
  }
  update(u: ViewUpdate) {
    const searchChanged = u.transactions.some((tr) => tr.effects.some((e) => e.is(setSearchEffect)));
    if (searchChanged || u.viewportChanged || u.docChanged) this.decorations = this.build(u.view);
  }
  build(view: EditorView): DecorationSet {
    const { matches, current } = view.state.field(searchField);
    const b = new RangeSetBuilder<Decoration>();
    if (matches.length === 0) return b.finish();
    const cur = matches[current];
    for (const { from, to } of view.visibleRanges) {
      for (const m of matchesIn(matches, from, to)) {
        b.add(m.from, m.to, cur && cur.from === m.from ? currentMark : matchMark);
      }
    }
    return b.finish();
  }
}, { decorations: (p) => p.decorations });

// ---- JSON structure (folding) ----

function foldMarker(open: boolean): HTMLElement {
  const s = document.createElement("span");
  s.className = "cm-resp-fold-marker";
  s.textContent = open ? "▾" : "▸";
  s.title = open ? "Collapse" : "Expand";
  return s;
}

const structure: Extension = [
  json(),
  foldService.of((state, from, to) => foldRangeForLine(state, from, to)),
  codeFolding({
    preparePlaceholder: (state, range) => placeholderLabel(childInfo(state, range)),
    placeholderDOM: (_view, onclick, prepared: { text: string; badge: string }) => {
      const wrap = document.createElement("span");
      wrap.className = "cm-resp-folded";
      wrap.title = "Expand";
      wrap.onclick = onclick;
      const text = document.createElement("span");
      text.className = "cm-resp-folded-text";
      text.textContent = prepared.text;
      wrap.append(text);
      if (prepared.badge) {
        const badge = document.createElement("span");
        badge.className = "cm-resp-folded-badge";
        badge.textContent = prepared.badge;
        wrap.append(badge);
      }
      return wrap;
    },
  }),
  foldGutter({ markerDOM: foldMarker }),
];

export function createResponseViewer(parent: HTMLElement, opts: ResponseViewerOptions): ResponseViewerHandle {
  let wrapOn = true;

  const extensions = (structured: boolean): Extension => [
    appShortcuts,
    Prec.high(keymap.of([{ key: "Mod-f", run: () => (opts.onFind(), true) }])),
    keymap.of(defaultKeymap), // caret moves / PageUp/Down / select all; read-only blocks edits
    EditorState.readOnly.of(true),
    theme,
    structured ? structure : [],
    wrapOn ? EditorView.lineWrapping : [],
    searchField,
    searchHighlight,
    EditorView.domEventHandlers({
      contextmenu: (e) => {
        opts.onContextMenu(e);
        return true;
      },
    }),
    EditorView.updateListener.of((u) => {
      if (foldsChanged(u)) opts.onFoldsChanged();
    }),
    EditorView.contentAttributes.of({ "aria-label": "Response body", "aria-readonly": "true" }),
    EditorView.theme({
      "&": { height: "100%", fontSize: "13px" },
      ".cm-scroller": { fontFamily: "var(--mono)" },
      "&.cm-focused": { outline: "none" },
    }),
  ];

  let structured = false;
  const view = new EditorView({ parent, state: EditorState.create({ doc: "", extensions: extensions(false) }) });

  const rangesOf = foldsOf;

  return {
    setContent(text, isStructured, folds) {
      structured = isStructured;
      view.setState(EditorState.create({ doc: text, extensions: extensions(structured) }));
      const valid = (folds ?? []).filter((r) => r.to <= view.state.doc.length && r.from < r.to);
      if (structured && valid.length) view.dispatch({ effects: valid.map((r) => foldEffect.of(r)) });
    },
    setWrap(on) {
      if (on === wrapOn) return;
      wrapOn = on;
      const doc = view.state.doc.toString();
      const folds = rangesOf(view.state);
      const sel = view.state.selection;
      const search = view.state.field(searchField);
      const top = view.scrollDOM.scrollTop;
      view.setState(EditorState.create({ doc, selection: sel, extensions: extensions(structured) }));
      view.dispatch({ effects: [...folds.map((r) => foldEffect.of(r)), setSearchEffect.of(search)] });
      view.scrollDOM.scrollTop = top;
    },
    collapseAll() {
      if (!structured) return;
      unfoldAll(view);
      view.dispatch({ effects: collapseRanges(view.state, 1).map((r) => foldEffect.of(r)) });
    },
    expandAll() {
      unfoldAll(view);
    },
    folds: () => rangesOf(view.state),
    setSearch(matches, current) {
      view.dispatch({ effects: setSearchEffect.of({ matches, current }) });
    },
    // Unfold the collapsed nodes hiding m (only those), select and scroll — one transaction.
    reveal(m) {
      view.dispatch({
        selection: { anchor: m.from, head: m.to },
        effects: [...revealEffects(view.state, m), EditorView.scrollIntoView(m.from, { y: "center" })],
      });
    },
    selection() {
      const { from, to } = view.state.selection.main;
      return view.state.sliceDoc(from, to);
    },
    focus: () => view.focus(),
    destroy: () => view.destroy(),
  };
}

// Folding by mouse (gutter or placeholder) changes the folded set.
function foldsChanged(u: ViewUpdate): boolean {
  return foldedRanges(u.startState) !== foldedRanges(u.state);
}
