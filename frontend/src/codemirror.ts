// The one shared CodeMirror 6 setup: theme (driven by the design tokens), app
// shortcuts, {{var}} highlighting + interactive hover, and the editor factories
// (raw body; single-line for the URL bar and the params/headers/form tables).
// Imported lazily (dynamic import), so CodeMirror stays out of the startup bundle.
import { basicSetup, EditorView } from "codemirror";
import { Annotation, Compartment, EditorState, Extension, Prec, RangeSetBuilder, StateEffect, StateField, Transaction } from "@codemirror/state";
import {
  closeHoverTooltips, Decoration, DecorationSet, hoverTooltip, keymap, placeholder as placeholderExt, showTooltip, Tooltip,
  ViewPlugin, ViewUpdate,
} from "@codemirror/view";
import { defaultKeymap, history, historyKeymap } from "@codemirror/commands";
import { HighlightStyle, syntaxHighlighting } from "@codemirror/language";
import { tags } from "@lezer/highlight";
import { json } from "@codemirror/lang-json";
import { classify, createFromTooltip, EnvDisplay, saveFromTooltip, tooltipActions, tooltipModel } from "./vars";
import { runShortcut } from "./shortcuts";
import { varEditApi } from "./varEdit";

// ---- Theme: every color is a token from tokens.css, so light/dark switch live ----

const tokenTheme = EditorView.theme({
  "&": { color: "var(--cm-text)", backgroundColor: "var(--cm-bg)" },
  ".cm-content": { caretColor: "var(--cm-cursor)" },
  ".cm-cursor, .cm-dropCursor": { borderLeftColor: "var(--cm-cursor)" },
  "&.cm-focused > .cm-scroller > .cm-selectionLayer .cm-selectionBackground, .cm-selectionBackground, .cm-content ::selection": {
    backgroundColor: "var(--cm-selection)",
  },
  ".cm-gutters": { backgroundColor: "var(--cm-gutter)", color: "var(--cm-gutter-text)", border: "none" },
  ".cm-activeLine": { backgroundColor: "var(--cm-active-line)" },
  ".cm-activeLineGutter": { backgroundColor: "var(--cm-active-line)" },
  ".cm-selectionMatch, .cm-matchingBracket": { backgroundColor: "var(--cm-match)" },
  ".cm-placeholder": { color: "var(--muted)" },
  ".cm-tooltip": { border: "none", backgroundColor: "transparent" },
});

const tokenHighlight = HighlightStyle.define([
  { tag: tags.propertyName, color: "var(--syn-property)" },
  { tag: [tags.string, tags.special(tags.string)], color: "var(--syn-string)" },
  { tag: [tags.number, tags.bool, tags.null], color: "var(--syn-number)" },
  { tag: [tags.keyword, tags.atom], color: "var(--syn-keyword)" },
  { tag: [tags.punctuation, tags.bracket, tags.separator], color: "var(--syn-punct)" },
  { tag: tags.invalid, color: "var(--syn-invalid)" },
]);

const theme: Extension = [tokenTheme, syntaxHighlighting(tokenHighlight)];

// ---- App shortcuts: highest precedence, so no editor binding swallows them ----
// (basicSetup maps Mod-Enter to "insert blank line"; CM marks the event handled,
// so the window-level handler does not run the action a second time.)
const appShortcuts = Prec.highest(keymap.of([
  { key: "Mod-Enter", run: () => runShortcut("send"), preventDefault: true },
  { key: "Ctrl-Tab", run: () => runShortcut("next"), preventDefault: true },
  { key: "Ctrl-Shift-Tab", run: () => runShortcut("prev"), preventDefault: true },
  { key: "Mod-w", run: () => runShortcut("close"), preventDefault: true },
]));

// ---- {{var}} highlighting ----

const refreshVars = StateEffect.define<null>();
const resolvedMark = Decoration.mark({ class: "cm-var cm-var-resolved" });
const unresolvedMark = Decoration.mark({ class: "cm-var cm-var-unresolved" });

function buildDecorations(view: EditorView, getEnv: () => EnvDisplay): DecorationSet {
  const builder = new RangeSetBuilder<Decoration>();
  const env = getEnv();
  for (const { from, to } of view.visibleRanges) {
    for (const t of classify(view.state.doc.sliceString(from, to), env)) {
      builder.add(from + t.from, from + t.to, t.resolved ? resolvedMark : unresolvedMark);
    }
  }
  return builder.finish();
}

// ---- Hover card with editing ----
// The hover tooltip shows the variable and offers Edit / Reveal→Edit / "Create in
// <env>". Editing "pins" a separate tooltip (a StateField-provided showTooltip), so
// it stays open while the pointer moves away and while typing; Enter or blur saves
// through the normal variable path, Escape cancels.

interface Pin {
  key: string;
  pos: number;
  end: number;
}
const setPin = StateEffect.define<Pin | null>();

function el<K extends keyof HTMLElementTagNameMap>(tag: K, cls: string, text?: string): HTMLElementTagNameMap[K] {
  const e = document.createElement(tag);
  e.className = cls;
  if (text !== undefined) e.textContent = text;
  return e;
}

function cardHead(key: string, secret: boolean, resolved: boolean): HTMLElement {
  const root = el("div", `var-tooltip ${resolved ? "is-resolved" : "is-unresolved"}`);
  const head = el("div", "var-tooltip-key", key);
  if (secret) head.append(" ", el("span", "var-tooltip-tag", "secret"));
  root.append(head);
  return root;
}

function hoverCard(view: EditorView, key: string, pos: number, end: number, getEnv: () => EnvDisplay): HTMLElement {
  const env = getEnv();
  const m = tooltipModel(key, env);
  const actions = tooltipActions(key, env);
  const root = cardHead(key, m.secret, m.resolved);
  const value = el("div", "var-tooltip-value", m.display);
  root.append(value);
  const error = el("div", "var-tooltip-error");

  const buttons = el("div", "var-tooltip-actions");
  const button = (label: string, onClick: () => void) => {
    const b = el("button", "var-tooltip-btn", label);
    b.type = "button";
    b.addEventListener("mousedown", (e) => e.preventDefault()); // keep the editor's selection
    b.addEventListener("click", onClick);
    buttons.append(b);
    return b;
  };
  const pin = () => view.dispatch({ effects: [closeHoverTooltips, setPin.of({ key, pos, end })] });

  if (m.revealValue !== undefined) {
    let shown = false;
    const reveal = button("Reveal", () => {
      shown = !shown;
      value.textContent = shown ? m.revealValue! : m.display;
      reveal.textContent = shown ? "Hide" : "Reveal";
      if (shown && actions.editAfterReveal && !buttons.querySelector(".is-edit")) button("✎ Edit", pin).classList.add("is-edit");
    });
  }
  if (actions.edit) button("✎ Edit", pin).classList.add("is-edit");
  if (actions.createIn) {
    button(`+ Create in ${actions.createIn}`, async () => {
      const res = await createFromTooltip(key, getEnv(), varEditApi);
      if (res.error) {
        error.textContent = res.error;
        return;
      }
      pin();
    });
  }
  if (buttons.childElementCount > 0) root.append(buttons);
  root.append(error);
  if (m.envName !== null) root.append(el("div", "var-tooltip-source", m.tag ? `${m.envName} · ${m.tag}` : m.envName));
  return root;
}

function editCard(view: EditorView, pin: Pin, getEnv: () => EnvDisplay): HTMLElement {
  const env = getEnv();
  const v = env.vars.get(pin.key);
  const root = cardHead(pin.key, !!v?.secret, true);
  root.classList.add("is-editing");
  const input = el("input", "var-tooltip-input");
  input.type = v?.secret ? "password" : "text";
  input.value = v?.value ?? "";
  input.spellcheck = false;
  input.setAttribute("aria-label", `Value of ${pin.key}`);
  const hint = el("div", "var-tooltip-source",
    `${env.envName ?? ""}${v?.secret ? " · saved on this machine only" : ""} · Enter to save, Esc to cancel`);
  const error = el("div", "var-tooltip-error");
  root.append(input, error, hint);

  let done = false;
  const close = () => {
    done = true;
    view.dispatch({ effects: setPin.of(null) });
    view.focus();
  };
  const save = async () => {
    if (done) return;
    done = true;
    input.disabled = true;
    const err = await saveFromTooltip(pin.key, input.value, getEnv(), varEditApi);
    if (err) {
      done = false;
      input.disabled = false;
      error.textContent = err;
      input.focus();
      return;
    }
    view.dispatch({ effects: [setPin.of(null), refreshVars.of(null)] });
  };
  input.addEventListener("keydown", (e) => {
    e.stopPropagation(); // typing here must not reach the editor (or the app shortcuts)
    if (e.key === "Enter") {
      e.preventDefault();
      void save();
    } else if (e.key === "Escape") {
      e.preventDefault();
      close();
    }
  });
  input.addEventListener("blur", () => void save());
  queueMicrotask(() => {
    input.focus();
    input.select();
  });
  return root;
}

// Notified when a pinned edit tooltip opens/closes (table cells keep their editor mounted meanwhile).
export type PinListener = (open: boolean) => void;

export function varHighlighting(getEnv: () => EnvDisplay, onPin?: PinListener): Extension {
  const decorations = ViewPlugin.fromClass(
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

  const pinField = StateField.define<Pin | null>({
    create: () => null,
    update(value, tr) {
      for (const e of tr.effects) {
        if (e.is(setPin)) {
          onPin?.(e.value !== null);
          return e.value;
        }
      }
      if (value && tr.docChanged) {
        onPin?.(false);
        return null; // the token moved: drop the edit
      }
      return value;
    },
    provide: (f) => showTooltip.compute([f], (state): Tooltip | null => {
      const pin = state.field(f);
      if (!pin) return null;
      return { pos: pin.pos, end: pin.end, above: true, create: (view) => ({ dom: editCard(view, pin, getEnv) }) };
    }),
  });

  const hover = hoverTooltip((view, pos) => {
    const line = view.state.doc.lineAt(pos);
    const offset = pos - line.from;
    const token = classify(line.text, getEnv()).find((t) => offset >= t.from && offset <= t.to);
    if (!token) return null;
    const from = line.from + token.from;
    const to = line.from + token.to;
    return { pos: from, end: to, above: true, create: (v) => ({ dom: hoverCard(v, token.key, from, to, getEnv) }) };
  });

  return [decorations, pinField, hover];
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
        appShortcuts,
        basicSetup,
        theme,
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

// ---- Single-line editor (URL bar, table cells) ----

// Marks a programmatic setDoc, so the update listener does not echo it back.
const externalChange = Annotation.define<boolean>();

export interface LineEditorHandle {
  refreshVars: () => void;
  // Replaces the text programmatically: not reported to onChange, not in undo history.
  setDoc: (text: string) => void;
  getDoc: () => string;
  focus: () => void;
  hasFocus: () => boolean;
  destroy: () => void;
}

export interface LineEditorOptions {
  placeholder: string;
  ariaLabel: string;
  onChange: (text: string) => void;
  onEnter?: () => void; // URL bar: Send. Table cells: none.
  onFocusChange?: (focused: boolean) => void;
  onPin?: PinListener;
  getEnv: () => EnvDisplay;
}

// One factory for every single-line field: newlines are stripped (a pasted multi-line
// value is joined), Tab/Shift+Tab move focus as in a normal input, and the shared
// theme, shortcuts and {{var}} highlighting/hover apply.
export function createLineEditor(parent: HTMLElement, doc: string, opts: LineEditorOptions): LineEditorHandle {
  const view = new EditorView({
    parent,
    state: EditorState.create({
      doc: doc.replace(/[\r\n]+/g, ""),
      extensions: [
        appShortcuts,
        history(),
        keymap.of([
          { key: "Enter", run: () => (opts.onEnter?.(), true) },
          ...defaultKeymap.filter((b) => b.key !== "Enter"),
          ...historyKeymap,
        ]),
        EditorState.transactionFilter.of((tr) => {
          if (!tr.docChanged || tr.newDoc.lines <= 1) return tr;
          const changes: { from: number; to: number; insert: string }[] = [];
          tr.changes.iterChanges((fromA, toA, _fromB, _toB, inserted) => {
            changes.push({ from: fromA, to: toA, insert: inserted.toString().replace(/[\r\n]+/g, "") });
          });
          return [{ changes, selection: tr.selection, scrollIntoView: tr.scrollIntoView }];
        }),
        placeholderExt(opts.placeholder),
        theme,
        varHighlighting(opts.getEnv, opts.onPin),
        EditorView.updateListener.of((u) => {
          const external = u.transactions.some((tr) => tr.annotation(externalChange));
          if (u.docChanged && !external) opts.onChange(u.state.doc.toString());
          if (u.focusChanged) opts.onFocusChange?.(u.view.hasFocus);
        }),
        EditorView.contentAttributes.of({ "aria-label": opts.ariaLabel, spellcheck: "false", autocapitalize: "off" }),
      ],
    }),
  });
  return {
    refreshVars: () => view.dispatch({ effects: refreshVars.of(null) }),
    setDoc: (text) => {
      if (view.state.doc.toString() === text) return;
      view.dispatch({
        changes: { from: 0, to: view.state.doc.length, insert: text },
        annotations: [externalChange.of(true), Transaction.addToHistory.of(false)],
      });
    },
    getDoc: () => view.state.doc.toString(),
    focus: () => view.focus(),
    hasFocus: () => view.hasFocus,
    destroy: () => view.destroy(),
  };
}
