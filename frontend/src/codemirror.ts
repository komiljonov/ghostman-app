// The one shared CodeMirror 6 setup: theme (driven by the design tokens), app
// shortcuts, {{var}} highlighting + interactive hover, and the editor factories
// (raw body; single-line for the URL bar and the params/headers/form tables).
// Imported lazily (dynamic import), so CodeMirror stays out of the startup bundle.
import { basicSetup, EditorView } from "codemirror";
import { Annotation, Compartment, EditorState, Extension, Prec, RangeSetBuilder, StateEffect, StateField, Transaction } from "@codemirror/state";
import {
  closeHoverTooltips, Decoration, DecorationSet, hoverTooltip, keymap, placeholder as placeholderExt, showTooltip, Tooltip,
  ViewPlugin, ViewUpdate, WidgetType,
} from "@codemirror/view";
import { defaultKeymap, history, historyKeymap } from "@codemirror/commands";
import {
  acceptCompletion, autocompletion, Completion, CompletionContext, CompletionResult, completionStatus, pickedCompletion,
} from "@codemirror/autocomplete";
import {
  applyCompletion, completionSpot, EMPTY_LINE, enterAction, groupLabel, OptionGroup, tabAction, varOptions,
} from "./varComplete";
import { LOCK_PATH } from "./iconPaths";
import { HighlightStyle, syntaxHighlighting } from "@codemirror/language";
import { tags } from "@lezer/highlight";
import { json } from "@codemirror/lang-json";
import { classify, createFromTooltip, EnvDisplay, maskRanges, saveFromTooltip, tooltipActions, tooltipModel } from "./vars";
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
  // {{var}} completion popup (varCompletion): ~8 rows, then it scrolls.
  ".cm-tooltip.cm-tooltip-autocomplete": {
    backgroundColor: "var(--panel)", border: "1px solid var(--border)", borderRadius: "6px",
    boxShadow: "0 6px 18px var(--shadow)", padding: "3px 0", overflow: "hidden",
  },
  ".cm-tooltip.cm-tooltip-autocomplete > ul": {
    fontFamily: "var(--mono)", fontSize: "12px", maxHeight: "15em", minWidth: "260px", maxWidth: "460px",
  },
  ".cm-tooltip.cm-tooltip-autocomplete > ul > li": {
    display: "flex", alignItems: "center", gap: "6px", padding: "3px 10px", lineHeight: "18px", color: "var(--text)",
  },
  ".cm-tooltip.cm-tooltip-autocomplete > ul > li:hover": { backgroundColor: "var(--hover-strong)" },
  ".cm-tooltip.cm-tooltip-autocomplete > ul > li[aria-selected]": { backgroundColor: "var(--selection)", color: "var(--text)" },
  ".cm-tooltip.cm-tooltip-autocomplete > ul > completion-section": {
    display: "block", padding: "5px 10px 2px", fontFamily: "system-ui, sans-serif", fontSize: "10.5px", fontWeight: "600",
    letterSpacing: "0.04em", textTransform: "uppercase", color: "var(--muted)", borderBottom: "none", opacity: "1",
  },
  ".cm-completionLabel": { flex: "0 1 auto", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" },
  ".cm-completionDetail": {
    marginLeft: "auto", paddingLeft: "16px", fontStyle: "normal", color: "var(--muted)",
    overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap",
  },
  ".cm-completionMatchedText": { textDecoration: "none", fontWeight: "700" },
  ".cm-var-lock": { flexShrink: "0", color: "var(--muted)" },
  // As specific as the row rule above, so the dimmed / empty rows win.
  ".cm-tooltip.cm-tooltip-autocomplete > ul > li.cm-var-opt-unavailable, .cm-tooltip.cm-tooltip-autocomplete > ul > li.cm-var-opt-unavailable .cm-completionDetail, .cm-tooltip.cm-tooltip-autocomplete > ul > li.cm-var-opt-unavailable .cm-var-lock": {
    color: "var(--var-unavailable)",
  },
  ".cm-tooltip.cm-tooltip-autocomplete > ul > li.cm-var-opt-unavailable[aria-selected], .cm-tooltip.cm-tooltip-autocomplete > ul > li.cm-var-opt-unavailable[aria-selected] .cm-completionDetail": {
    color: "var(--muted)",
  },
  ".cm-tooltip.cm-tooltip-autocomplete > ul > li.cm-var-opt-empty": { color: "var(--muted)", fontStyle: "italic", cursor: "default" },
});

const tokenHighlight = HighlightStyle.define([
  { tag: tags.propertyName, color: "var(--syn-property)" },
  { tag: [tags.string, tags.special(tags.string)], color: "var(--syn-string)" },
  { tag: [tags.number, tags.bool, tags.null], color: "var(--syn-number)" },
  { tag: [tags.keyword, tags.atom], color: "var(--syn-keyword)" },
  { tag: [tags.punctuation, tags.bracket, tags.separator], color: "var(--syn-punct)" },
  { tag: tags.invalid, color: "var(--syn-invalid)" },
]);

export const theme: Extension = [tokenTheme, syntaxHighlighting(tokenHighlight)];

// ---- App shortcuts: highest precedence, so no editor binding swallows them ----
// (basicSetup maps Mod-Enter to "insert blank line"; CM marks the event handled,
// so the window-level handler does not run the action a second time.)
export const appShortcuts = Prec.highest(keymap.of([
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
  // Replaces the text programmatically: not reported to onChange, not in undo history.
  setDoc: (text: string) => void;
  getDoc: () => string;
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
        varCompletion(getEnv),
        EditorView.lineWrapping,
        EditorView.updateListener.of((u) => {
          const external = u.transactions.some((tr) => tr.annotation(externalChange));
          if (u.docChanged && !external) onChange(u.state.doc.toString());
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
    setDoc: (text) => {
      if (view.state.doc.toString() === text) return;
      view.dispatch({
        changes: { from: 0, to: view.state.doc.length, insert: text },
        annotations: [externalChange.of(true), Transaction.addToHistory.of(false)],
      });
    },
    getDoc: () => view.state.doc.toString(),
    destroy: () => view.destroy(),
  };
}

// ---- Single-line editor (URL bar, table cells) ----

// ---- {{var}} autocompletion (rules: varComplete.ts) ----
// One extension for every var-highlighting editor (line editors and the raw body).
// The source answers ONLY inside an unclosed "{{partial" (anything else: null, so
// normal typing never opens the popup) and reads the env store snapshot — no
// bridge calls. filter: false keeps our order (groups absolute); no validFor, so
// it re-runs on every keystroke ("}}" typed → no context → the popup closes).

type VarCompletion = Completion & { group?: OptionGroup; secret?: boolean; empty?: boolean };

export function varSource(getEnv: () => EnvDisplay) {
  return (ctx: CompletionContext): CompletionResult | null => {
    const line = ctx.state.doc.lineAt(ctx.pos);
    const at = ctx.pos - line.from;
    const spot = completionSpot(line.text.slice(0, at), line.text.slice(at), ctx.pos);
    if (!spot) return null;
    const env = getEnv();
    const { options, empty } = varOptions({ env, keys: env.keys ?? [] }, spot.prefix);
    if (empty) {
      const none: VarCompletion = { label: EMPTY_LINE, empty: true, apply: () => undefined };
      return { from: spot.from, to: spot.to, filter: false, options: [none] };
    }
    if (options.length === 0) return null;
    return {
      from: spot.from,
      to: spot.to,
      filter: false,
      options: options.map((o): VarCompletion => ({
        label: o.key,
        detail: o.detail,
        group: o.group,
        secret: o.secret,
        section: { name: groupLabel(o.group, env.envName), rank: o.group === "available" ? 0 : 1 },
        apply: (view, completion, from, to) => {
          const { insert } = applyCompletion(spot, o.key);
          view.dispatch({
            changes: { from, to, insert },
            selection: { anchor: from + o.key.length + 2 }, // past the closing braces
            annotations: pickedCompletion.of(completion),
            userEvent: "input.complete",
          });
        },
      })),
    };
  };
}

function lockIcon(c: Completion): Node | null {
  if (!(c as VarCompletion).secret) return null;
  const ns = "http://www.w3.org/2000/svg";
  const svg = document.createElementNS(ns, "svg");
  svg.setAttribute("viewBox", "0 0 16 16");
  svg.setAttribute("width", "12");
  svg.setAttribute("height", "12");
  svg.setAttribute("fill", "none");
  svg.setAttribute("stroke", "currentColor");
  svg.setAttribute("stroke-width", "1.4");
  svg.setAttribute("aria-label", "secret");
  svg.classList.add("cm-var-lock");
  const path = document.createElementNS(ns, "path");
  path.setAttribute("d", LOCK_PATH);
  svg.appendChild(path);
  return svg;
}

// Tab accepts while a completion is active (or swallows it while pending); with
// none, Tab keeps its normal focus movement. Above every other keymap.
const completionTab = Prec.highest(keymap.of([{
  key: "Tab",
  run: (view) => {
    const action = tabAction(completionStatus(view.state));
    if (action === "accept") return acceptCompletion(view) || true;
    return action === "swallow";
  },
}]));

export function varCompletion(getEnv: () => EnvDisplay): Extension {
  return [
    autocompletion({
      override: [varSource(getEnv)],
      activateOnTyping: true,
      activateOnTypingDelay: 0, // "{{" opens the popup at once
      interactionDelay: 0, // Enter right after it opens accepts (never falls through to Send)
      icons: false,
      maxRenderedOptions: 200,
      tooltipClass: () => "cm-var-complete",
      optionClass: (c) => ((c as VarCompletion).empty ? "cm-var-opt-empty" : (c as VarCompletion).group === "unavailable" ? "cm-var-opt-unavailable" : ""),
      addToOptions: [{ render: lockIcon, position: 45 }],
    }),
    completionTab,
  ];
}

// The line editors' Enter: accept / swallow while completing, else the editor's
// own action (Send in the URL bar).
function lineEnter(onEnter?: () => void) {
  return (view: EditorView) => {
    const action = enterAction(completionStatus(view.state));
    if (action === "accept") return acceptCompletion(view) || true;
    if (action === "default") onEnter?.();
    return true;
  };
}

// ---- Masked (password) single-line fields: literal text shows as bullets ----

class Bullets extends WidgetType {
  constructor(readonly n: number) {
    super();
  }
  eq(other: Bullets) {
    return other.n === this.n;
  }
  toDOM() {
    const s = document.createElement("span");
    s.className = "cm-masked";
    s.textContent = "•".repeat(this.n);
    return s;
  }
}

function maskDecorations(view: EditorView): DecorationSet {
  const b = new RangeSetBuilder<Decoration>();
  for (const [from, to] of maskRanges(view.state.doc.toString())) {
    b.add(from, to, Decoration.replace({ widget: new Bullets(to - from) }));
  }
  return b.finish();
}

const maskPlugin = ViewPlugin.fromClass(class {
  decorations: DecorationSet;
  constructor(view: EditorView) {
    this.decorations = maskDecorations(view);
  }
  update(u: ViewUpdate) {
    if (u.docChanged) this.decorations = maskDecorations(u.view);
  }
}, {
  decorations: (v) => v.decorations,
  // The cursor skips over a masked run as a whole (no caret inside the bullets).
  provide: (p) => EditorView.atomicRanges.of((view) => view.plugin(p)?.decorations ?? Decoration.none),
});

// Marks a programmatic setDoc, so the update listener does not echo it back.
const externalChange = Annotation.define<boolean>();

export interface LineEditorHandle {
  refreshVars: () => void;
  // Replaces the text programmatically: not reported to onChange, not in undo history.
  setDoc: (text: string) => void;
  getDoc: () => string;
  setMasked: (masked: boolean) => void; // password fields: hide / reveal literal text
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
  masked?: boolean; // password-style: literal text as bullets ({{vars}} stay visible)
}

// One factory for every single-line field: newlines are stripped (a pasted multi-line
// value is joined), Tab/Shift+Tab move focus as in a normal input, and the shared
// theme, shortcuts and {{var}} highlighting/hover apply.
export function createLineEditor(parent: HTMLElement, doc: string, opts: LineEditorOptions): LineEditorHandle {
  const mask = new Compartment();
  const view = new EditorView({
    parent,
    state: EditorState.create({
      doc: doc.replace(/[\r\n]+/g, ""),
      extensions: [
        appShortcuts,
        history(),
        keymap.of([
          { key: "Enter", run: lineEnter(opts.onEnter) },
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
        varCompletion(opts.getEnv),
        mask.of(opts.masked ? maskPlugin : []),
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
    setMasked: (masked) => view.dispatch({ effects: mask.reconfigure(masked ? maskPlugin : []) }),
    focus: () => view.focus(),
    hasFocus: () => view.hasFocus,
    destroy: () => view.destroy(),
  };
}
