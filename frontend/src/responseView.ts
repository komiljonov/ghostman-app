// Response pane rules: which body views (Pretty | Raw | Preview) a response
// offers, the default view, and which toolbar controls apply in the current mode.
// The toolbar never hides a control: what does not apply is disabled with a
// tooltip saying why, so nothing shifts when switching modes or responses.

export type BodyView = "pretty" | "raw" | "preview";
export type ResponseSection = "body" | "headers";

export interface ResponseLike {
  contentType: string;
  formatted: boolean; // Go pretty-printed the body (valid, untruncated JSON)
  body: string;
  rawBody?: string; // the body as received, set only when formatted
  truncated?: boolean;
}

export const BODY_VIEWS: { id: BodyView; label: string }[] = [
  { id: "pretty", label: "Pretty" },
  { id: "raw", label: "Raw" },
  { id: "preview", label: "Preview" },
];

export const isHTML = (contentType: string) => contentType.toLowerCase().includes("text/html");
export const isJSONType = (contentType: string) => contentType.toLowerCase().includes("json");

// Pretty with the collapsible structure: only for valid JSON that Go formatted.
export const hasStructure = (resp: ResponseLike) => resp.formatted;

// A JSON response cut at 256 KB cannot be parsed: Pretty shows the flat text with
// a "structure view unavailable (truncated response)" notice.
export const prettyFallback = (resp: ResponseLike) => !resp.formatted && !!resp.truncated && isJSONType(resp.contentType);

export interface Availability {
  enabled: boolean;
  title: string; // tooltip; says why when disabled
}

export function viewAvailability(resp: ResponseLike | undefined): Record<BodyView, Availability> {
  if (!resp) {
    const none = { enabled: false, title: "Send the request first" };
    return { pretty: none, raw: none, preview: none };
  }
  return {
    pretty: resp.formatted
      ? { enabled: true, title: "Formatted JSON" }
      : prettyFallback(resp)
        ? { enabled: true, title: "Structure view unavailable (truncated response)" }
        : { enabled: false, title: "Only for JSON responses" },
    raw: { enabled: true, title: "Body as received" },
    preview: isHTML(resp.contentType)
      ? { enabled: true, title: "Render the HTML (sandboxed, no scripts)" }
      : { enabled: false, title: "Only for HTML responses" },
  };
}

// A new response starts in: Preview for HTML, Pretty for formatted JSON, else Raw.
export function defaultView(resp: ResponseLike): BodyView {
  if (isHTML(resp.contentType)) return "preview";
  return resp.formatted || prettyFallback(resp) ? "pretty" : "raw";
}

// The chosen view if this response offers it, otherwise its default.
export function effectiveView(resp: ResponseLike, chosen: BodyView | undefined): BodyView {
  return chosen && viewAvailability(resp)[chosen].enabled ? chosen : defaultView(resp);
}

export function bodyText(resp: ResponseLike, view: BodyView): string {
  return view === "raw" ? resp.rawBody || resp.body : resp.body;
}

// Attributes of the Preview iframe. The sandbox is EMPTY: no allow-scripts (no
// script runs, not even inline handlers) and no allow-same-origin (the document
// gets an opaque origin: no access to the app, its storage or the Wails bridge).
// Absolute stylesheet/image URLs still load; relative URLs have no base and break
// (acceptable for a preview).
export function previewFrameAttrs(body: string) {
  return { sandbox: "", srcdoc: body, referrerpolicy: "no-referrer" as const, title: "HTML preview" };
}

export interface ToolbarControls {
  sections: Availability; // Body | Headers
  views: Availability; // the Pretty | Raw | Preview switcher as a whole
  wrap: Availability;
  search: Availability; // search in the body (Ctrl+F)
  fold: Availability; // Collapse All / Expand All
  save: Availability; // save the full response to a file
}

export function toolbarControls(s: {
  hasResponse: boolean;
  section: ResponseSection;
  view: BodyView;
  structured?: boolean; // the Pretty view shows the collapsible JSON structure
}): ToolbarControls {
  const noResponse = { enabled: false, title: "Send the request first" };
  if (!s.hasResponse) {
    return { sections: noResponse, views: noResponse, wrap: noResponse, search: noResponse, fold: noResponse, save: noResponse };
  }
  const bodyOnly = { enabled: false, title: "Applies to body view" };
  const textView = s.section === "body" && s.view !== "preview";
  return {
    sections: { enabled: true, title: "" },
    views: s.section === "body" ? { enabled: true, title: "" } : bodyOnly,
    wrap: s.section !== "body"
      ? bodyOnly
      : s.view === "preview"
        ? { enabled: false, title: "Applies to Pretty and Raw views" }
        : { enabled: true, title: "Wrap long lines" },
    search: s.section !== "body"
      ? bodyOnly
      : textView ? { enabled: true, title: "Search in response (Ctrl+F)" } : { enabled: false, title: "Applies to Pretty and Raw views" },
    fold: s.section === "body" && s.view === "pretty" && s.structured
      ? { enabled: true, title: "" }
      : { enabled: false, title: "Applies to the Pretty JSON view" },
    save: { enabled: true, title: "Save the full response body to a file" },
  };
}

// Context menus in the response body / headers (the shared ContextMenu renders them).
export type BodyMenuAction = "copy" | "copyAll" | "search";

export function bodyMenu(s: { hasSelection: boolean }): { action: BodyMenuAction; label: string; enabled: boolean }[] {
  return [
    { action: "copy", label: "Copy", enabled: s.hasSelection },
    { action: "copyAll", label: "Copy All", enabled: true },
    { action: "search", label: "Search in response", enabled: true },
  ];
}

export interface HeaderLike {
  key: string;
  value: string;
}

export const headerLine = (h: HeaderLike) => `${h.key}: ${h.value}`;
export const allHeadersText = (headers: HeaderLike[]) => headers.map(headerLine).join(String.fromCharCode(10));

// What "Copy" / "Copy All" put on the clipboard: the text as displayed in the
// current view (pretty text in Pretty, the raw string in Raw).
export const copyAllText = bodyText;

// Which right-click menu the response pane offers: the body menu in Pretty/Raw,
// the headers menu in Headers mode; none in Preview (the sandboxed page) or
// before a response.
export function responseMenuKind(s: { hasResponse: boolean; section: ResponseSection; view: BodyView }): "body" | "headers" | null {
  if (!s.hasResponse) return null;
  if (s.section === "headers") return "headers";
  return s.view === "preview" ? null : "body";
}
