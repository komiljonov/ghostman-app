// CodeMirror completion sources for the headers table's cells (rules:
// headerComplete.ts). Kept out of codemirror.ts and free of CodeMirror runtime
// imports, so the table can create them without loading the editor bundle (the
// cells load it lazily, VarCell). Both stay quiet inside an unclosed "{{" — the
// {{var}} source's context.
import type { Completion, CompletionContext, CompletionSource } from "@codemirror/autocomplete";
import { GROUP_LABEL, headerKeyOptions, headerValueOptions, wordBefore } from "./headerComplete";
import { completionSpot } from "./varComplete";

// The word being typed outside an unclosed "{{" (null inside one: the var source's).
function headerWord(ctx: CompletionContext): { word: string; from: number } | null {
  const line = ctx.state.doc.lineAt(ctx.pos);
  const at = ctx.pos - line.from;
  if (completionSpot(line.text.slice(0, at), line.text.slice(at), ctx.pos)) return null;
  const { word, start } = wordBefore(line.text.slice(0, at));
  if (word === "" && !ctx.explicit) return null;
  return { word, from: line.from + start };
}

// KEY cells of the headers table: recently used keys (this project, local) above
// the common header names; inserted in canonical casing.
export function headerKeySource(getRecent: () => readonly string[]): CompletionSource {
  return (ctx) => {
    const w = headerWord(ctx);
    if (!w) return null;
    const options = headerKeyOptions(w.word, getRecent());
    if (options.length === 0) return null;
    return {
      from: w.from,
      to: ctx.pos,
      filter: false,
      options: options.map((o): Completion => ({
        label: o.label,
        section: { name: GROUP_LABEL[o.group], rank: o.group === "recent" ? 0 : 1 },
      })),
    };
  };
}

// VALUE cells of the headers table: common mime types while the row's key is Content-Type.
export function headerValueSource(getKey: () => string): CompletionSource {
  return (ctx) => {
    const w = headerWord(ctx);
    if (!w) return null;
    const options = headerValueOptions(getKey(), w.word);
    if (options.length === 0) return null;
    return { from: w.from, to: ctx.pos, filter: false, options: options.map((label): Completion => ({ label })) };
  };
}
