// Generated ({{$name}}) variables — DISPLAY ONLY: highlighting, hover, and the
// "Generated" group of the {{ popup. The values are generated in Go at send time
// (internal/engine/dynamic.go is the spec: fresh per send, one value per distinct
// token text per send). Keep this list and the $now grammar in step with it
// (dynamicVars.test.ts mirrors dynamic_test.go's tables).

export interface GeneratedVar {
  key: string; // with the "$"
  description: string;
  example: () => string; // an illustrative value for the hover (not the one sent)
}

const hex = (bytes: number) =>
  Array.from(crypto.getRandomValues(new Uint8Array(bytes)), (b) => b.toString(16).padStart(2, "0")).join("");
const unix = (offset = 0) => String(Math.floor(Date.now() / 1000) + offset);
const localDate = () => {
  const d = new Date();
  const p = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
};

// In popup order.
export const GENERATED: GeneratedVar[] = [
  { key: "$uuid", description: "a random UUID (v4)", example: () => crypto.randomUUID() },
  { key: "$timestamp", description: "unix time in seconds", example: () => unix() },
  { key: "$isoTimestamp", description: "the time now, ISO 8601 in UTC", example: () => new Date().toISOString().replace(/\.\d{3}Z$/, "Z") },
  { key: "$date", description: "today, YYYY-MM-DD (local time)", example: localDate },
  { key: "$randomInt", description: "a random integer 0–999999", example: () => String(Math.floor(Math.random() * 1_000_000)) },
  { key: "$randomHex", description: "16 random hex characters", example: () => hex(8) },
  { key: "$now", description: "unix time in seconds (same as $timestamp)", example: () => unix() },
  { key: "$now+3600", description: "unix time N seconds from now ($now+N, $now-N)", example: () => unix(3600) },
];

// $now, $now+N, $now-N (N integer seconds) — engine.NowOffset.
const NOW_KEY = /^\$now(?:([+-])(\d+))?$/;

// What the hover says about a key: undefined = not a generated variable (an
// unknown "$name" stays literal at send time).
export function generatedInfo(key: string): { description: string; example: string } | undefined {
  const m = NOW_KEY.exec(key);
  if (m) {
    if (!m[1]) return { description: "unix time in seconds", example: unix() };
    const n = Number(m[2]);
    const sign = m[1] === "+" ? 1 : -1;
    return {
      description: `unix time ${n} second${n === 1 ? "" : "s"} ${sign > 0 ? "from now" : "ago"}`,
      example: unix(sign * n),
    };
  }
  const g = GENERATED.find((x) => x.key === key);
  return g ? { description: g.description, example: g.example() } : undefined;
}

// Any "$…" key is a generated one (never read from an environment).
export const isGeneratedKey = (key: string) => key.startsWith("$");

export const GENERATED_NOTE = "generated at send time · one value per send";

// The response banner for Go's unresolved list (engine.ResolveSpec): {{KEY}}
// without a value, an unknown {{$name}}, a ":key" path variable without a value.
export function unresolvedBanner(keys: string[]): string {
  const vars = keys.filter((k) => !k.startsWith(":") && !isGeneratedKey(k)).map((k) => `{{${k}}}`);
  const unknown = keys.filter(isGeneratedKey).map((k) => `{{${k}}}`);
  const path = keys.filter((k) => k.startsWith(":"));
  const parts: string[] = [];
  if (vars.length) parts.push(`Unresolved variables: ${vars.join(", ")}`);
  if (unknown.length) parts.push(`Unknown generated ${unknown.length === 1 ? "variable" : "variables"}: ${unknown.join(", ")}`);
  if (path.length) parts.push(`Path ${path.length === 1 ? "variable" : "variables"} without a value: ${path.join(", ")}`);
  return parts.join(" · ");
}
