// "Add missing variables" (environment tab): the dialog's selection rules and
// wording. Go finds the missing keys (MissingVariables: the project's used
// {{keys}} minus this environment's, a secret counting as present) and creates
// them (CreateMissingVariables: regular, value ""). Pinned by missingVars.test.ts.

// Every offered key starts checked.
export const initialSelection = (keys: string[]) => new Set(keys);

export function toggleKey(sel: Set<string>, key: string): Set<string> {
  const next = new Set(sel);
  if (next.has(key)) next.delete(key);
  else next.add(key);
  return next;
}

// The header checkbox: all → none, otherwise → all.
export const toggleAll = (sel: Set<string>, keys: string[]) =>
  (keys.every((k) => sel.has(k)) ? new Set<string>() : new Set(keys));

// The keys to create, in the offered order.
export const chosenKeys = (sel: Set<string>, keys: string[]) => keys.filter((k) => sel.has(k));

export const createLabel = (n: number) => (n === 0 ? "Create" : `Create ${n} ${n === 1 ? "variable" : "variables"}`);

export const emptyText = (env: string) => `No missing variables — every {{variable}} this project uses exists in ${env}.`;

// After creating: one line for what worked, one per failure.
export function resultLines(r: { created: string[]; failed: { key: string; message: string }[] }): { ok: string; errors: string[] } {
  const n = r.created.length;
  return {
    ok: n === 0 ? "" : `Created ${n} ${n === 1 ? "variable" : "variables"} — fill in their values in the table.`,
    errors: r.failed.map((f) => `${f.key}: ${f.message}`),
  };
}
