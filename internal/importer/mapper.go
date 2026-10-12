package importer

import (
	"bytes"
	"encoding/json"
	"fmt"
	"slices"
	"strings"

	"ghostman/internal/api"
	"ghostman/internal/jsonfmt"
)

// The collection mapper: Postman file → CollectionPlan + report entries. Pure.
//
// Shape: the collection becomes ONE new root folder (named after info.name,
// deduplicated "<name> (2)" against the project's root folders); its items keep
// their nesting and order inside it. Every helper below returns its value AND
// the entries its fallbacks produced (never a bare value), so nothing is changed
// or dropped without a report line.

// FolderPlan is a folder to create, with its contents in file order.
type FolderPlan struct {
	Path     string // full path in the Postman file, for the report
	Name     string
	Auth     api.Auth // Type inherit = nothing to set
	Follow   string   // "" | "on" | "off" (Postman's followRedirects)
	Folders  []*FolderPlan
	Requests []*RequestPlan
}

// RequestPlan is a request to create.
type RequestPlan struct {
	Path   string
	Name   string
	Draft  api.RequestDraft // method, url (base), headers, query rows, body, auth
	Follow string
}

// CollectionPlan is everything an import will create, validated up front.
type CollectionPlan struct {
	Report *Report
	Root   *FolderPlan
	Items  int // folders + requests inside the root (the progress total, root excluded)
	// Environments are created after the folder tree (OpenAPI: one per server).
	Environments []*ServerEnvPlan
}

// MethodsSupported are the methods the server accepts.
var MethodsSupported = []string{"GET", "POST", "PUT", "PATCH", "DELETE", "HEAD", "OPTIONS"}

// PlanCollection maps a Postman collection. existingRoots are the names of the
// project's root folders (for the "(2)" dedupe). The report holds the mapping's
// entries; execution adds the created / failed ones.
func PlanCollection(data []byte, source string, existingRoots []string) (*CollectionPlan, error) {
	c, err := parseCollection(data)
	if err != nil {
		return nil, err
	}
	rep := newReport(KindCollection, source, c.format, c.Info.Name)
	m := &mapper{rep: rep}

	collName, notes := mapName("", c.Info.Name, "Imported collection")
	rep.add(notes...)
	root := &FolderPlan{Path: collName, Name: UniqueName(collName, existingRoots)}
	var authNotes []Entry
	root.Auth, authNotes = mapAuth(collName, "the collection", c.Auth)
	rep.add(authNotes...)
	rep.add(mapScripts(collName, c.Event)...)
	if text(c.Info.Description) != "" {
		m.descriptions++
	}
	rep.add(mapVariables(CodeCollectionVars, collName, "collection", c.Variable)...)

	m.items(root, c.Item)

	if m.descriptions > 0 {
		rep.add(drop(CodeDescriptions, "", plural(m.descriptions, "description", "item descriptions")+
			" not imported: Ghostman has no description field yet.", ""))
	}
	if m.examples > 0 {
		rep.add(drop(CodeExamples, "", plural(m.examples, "saved example response", "saved example responses")+
			" not imported: Ghostman has no saved examples.", ""))
	}
	if len(m.interleaved) > 0 {
		e := warn(CodeOrderInterleaved, "", fmt.Sprintf("In %s, sub-folders and requests were mixed in Postman's "+
			"order; Ghostman lists folders before requests, so their order relative to the requests changed.",
			plural(len(m.interleaved), "folder", "folders")), "")
		e.Detail, e.DetailLabel = strings.Join(m.interleaved, "\n"), "Folders"
		rep.add(e)
	}
	return &CollectionPlan{Report: rep, Root: root, Items: m.count}, nil
}

type mapper struct {
	rep          *Report
	count        int
	descriptions int
	examples     int
	interleaved  []string
}

func (m *mapper) items(into *FolderPlan, items []pmItem) {
	seenRequest := false
	for _, it := range items {
		if it.isFolder() {
			if seenRequest && !slices.Contains(m.interleaved, into.Path) {
				m.interleaved = append(m.interleaved, into.Path)
			}
			m.folder(into, it)
			continue
		}
		seenRequest = true
		m.request(into, it)
	}
}

func (m *mapper) folder(into *FolderPlan, it pmItem) {
	name, notes := mapName(into.Path, it.Name, "Untitled folder")
	path := into.Path + " / " + name
	m.rep.add(notes...)
	f := &FolderPlan{Path: path, Name: name}
	var more []Entry
	f.Auth, more = mapAuth(path, fmt.Sprintf("folder '%s'", name), it.Auth)
	m.rep.add(more...)
	f.Follow, more = mapBehavior(path, it.ProtocolProfileBehavior)
	m.rep.add(more...)
	m.rep.add(mapScripts(path, it.Event)...)
	m.rep.add(mapVariables(CodeFolderVars, path, fmt.Sprintf("folder '%s'", name), it.Variable)...)
	if text(it.Description) != "" {
		m.descriptions++
	}
	m.count++
	into.Folders = append(into.Folders, f)
	m.items(f, *it.Item)
}

func (m *mapper) request(into *FolderPlan, it pmItem) {
	name, notes := mapName(into.Path, it.Name, "Untitled request")
	path := into.Path + " / " + name
	m.rep.add(notes...)
	if len(it.Request) == 0 || string(it.Request) == "null" {
		m.rep.add(drop(CodeItemEmpty, path, "this item has neither a request nor sub-items; not imported.", ""))
		return
	}
	var req pmRequest
	var urlOnly string
	if json.Unmarshal(it.Request, &urlOnly) == nil { // a bare URL string: GET it
		req.URL, _ = json.Marshal(urlOnly)
	} else if err := json.Unmarshal(it.Request, &req); err != nil {
		m.rep.add(drop(CodeItemEmpty, path, "the request could not be read ("+jsonProblem(err)+"); not imported.", ""))
		return
	}

	rp := &RequestPlan{Path: path, Name: name}
	d := &rp.Draft
	var more []Entry
	d.Method, more = mapMethod(path, req.Method)
	m.rep.add(more...)
	d.URL, d.QueryParams, more = mapURL(path, req.URL)
	m.rep.add(more...)
	d.Headers, more = mapHeaders(path, req.Header)
	m.rep.add(more...)
	d.Body, more = mapBody(path, req.Body, d.Headers)
	m.rep.add(more...)
	d.Auth, more = mapAuth(path, fmt.Sprintf("request '%s'", name), req.Auth)
	m.rep.add(more...)
	rp.Follow, more = mapBehavior(path, it.ProtocolProfileBehavior)
	m.rep.add(more...)
	m.rep.add(mapScripts(path, it.Event)...)
	if text(req.Description) != "" || text(it.Description) != "" {
		m.descriptions++
	}
	m.examples += len(it.Response)
	m.count++
	into.Requests = append(into.Requests, rp)
}

// UniqueName returns name, or "name (2)", "name (3)", ... — the first not taken.
// Names compare case-insensitively, as the server does ("Dev" is taken by "dev").
func UniqueName(name string, taken []string) string {
	isTaken := func(c string) bool {
		return slices.ContainsFunc(taken, func(t string) bool { return strings.EqualFold(strings.TrimSpace(t), c) })
	}
	if !isTaken(name) {
		return name
	}
	for n := 2; ; n++ {
		if c := fmt.Sprintf("%s (%d)", name, n); !isTaken(c) {
			return c
		}
	}
}

// ---- Mapping helpers: each returns its value plus its report entries ----

// mapName trims a name; an empty one becomes fallback (reported under the parent's
// path + the fallback, the name it now has).
func mapName(parent, name, fallback string) (string, []Entry) {
	if n := strings.TrimSpace(name); n != "" {
		return n, nil
	}
	path := fallback
	if parent != "" {
		path = parent + " / " + fallback
	}
	return fallback, []Entry{warn(CodeNameEmpty, path,
		fmt.Sprintf("this item has no name; imported as '%s'.", fallback), "Rename it if needed.")}
}

func mapMethod(path, method string) (string, []Entry) {
	m := strings.ToUpper(strings.TrimSpace(method))
	if m == "" {
		return "GET", nil // Postman's default too
	}
	if slices.Contains(MethodsSupported, m) {
		return m, nil
	}
	return "GET", []Entry{warn(CodeMethodUnsupported, path,
		fmt.Sprintf("method '%s' is not supported; imported as GET.", m), "Change it manually if needed.")}
}

// mapURL turns Postman's url (a string, or an object with raw and/or parts) into
// our base url + query rows. raw wins when present, {{vars}} byte-verbatim; the
// query rows come from url.query (which knows disabled rows), else from raw.
func mapURL(path string, raw json.RawMessage) (string, []api.KeyValue, []Entry) {
	var notes []Entry
	var u pmURL
	var s string
	if len(raw) == 0 || string(raw) == "null" {
		return "", []api.KeyValue{}, nil
	}
	if json.Unmarshal(raw, &s) == nil {
		u.Raw = s
	} else if json.Unmarshal(raw, &u) != nil {
		return "", []api.KeyValue{}, nil
	}
	full := u.Raw
	if full == "" {
		full = assembleURL(u)
	}
	hash := u.Hash
	if i := strings.Index(full, "#"); i >= 0 {
		hash = full[i+1:]
		full = full[:i]
	}
	if hash != "" {
		notes = append(notes, warn(CodeURLFragment, path,
			fmt.Sprintf("URL fragment '#%s' removed (fragments are never sent to servers).", hash), ""))
	}
	base, query, _ := strings.Cut(full, "?")
	var rows []api.KeyValue
	var rowNotes []Entry
	if u.Query != nil {
		rows, rowNotes = mapRows(path, "query parameter", *u.Query)
	} else {
		rows, rowNotes = mapRows(path, "query parameter", splitQuery(query))
	}
	notes = append(notes, rowNotes...)
	notes = append(notes, pathVariables(path, base, u.Variable)...)
	return base, rows, notes
}

func assembleURL(u pmURL) string {
	var b strings.Builder
	if u.Protocol != "" {
		b.WriteString(u.Protocol + "://")
	}
	if host, ok := strList(u.Host); ok {
		b.WriteString(strings.Join(host, "."))
	}
	if u.Port != "" {
		b.WriteString(":" + u.Port)
	}
	if p, ok := strList(u.Path); ok && len(p) > 0 {
		b.WriteString("/" + strings.TrimPrefix(strings.Join(p, "/"), "/"))
	}
	return b.String()
}

// splitQuery reads "a=1&b" like the URL bar does (urlParams.ts): split on "&",
// then the first "="; verbatim, empty parts skipped.
func splitQuery(q string) []pmKV {
	var out []pmKV
	for _, part := range strings.Split(q, "&") {
		if part == "" {
			continue
		}
		k, v, _ := strings.Cut(part, "=")
		out = append(out, pmKV{Key: flexString(k), Value: flexString(v)})
	}
	return out
}

func pathVariables(path, base string, vars []pmKV) []Entry {
	rest := base
	if i := strings.Index(rest, "://"); i >= 0 {
		rest = rest[i+3:]
	}
	var notes []Entry
	segs := strings.Split(rest, "/")
	for _, seg := range segs[1:] { // segs[0] is the host (its ":port" is not a variable)
		if len(seg) < 2 || seg[0] != ':' {
			continue
		}
		msg := fmt.Sprintf("URL contains path variable '%s'; kept literally.", seg)
		for _, v := range vars {
			if string(v.Key) == seg[1:] && v.Value != "" {
				msg = fmt.Sprintf("URL contains path variable '%s' (Postman's value: '%s'); kept literally.", seg, v.Value)
			}
		}
		notes = append(notes, warn(CodeURLPathVariable, path, msg, "Replace it with a {{variable}} or a real value."))
	}
	return notes
}

// mapRows maps header / query / form rows: disabled → enabled false; rows without
// a key are dropped (the server requires one) — reported, with their values.
func mapRows(path, what string, rows []pmKV) ([]api.KeyValue, []Entry) {
	out := []api.KeyValue{}
	var keyless []string
	for _, r := range rows {
		if strings.TrimSpace(string(r.Key)) == "" {
			if r.Value != "" {
				keyless = append(keyless, string(r.Value))
			}
			continue
		}
		out = append(out, api.KeyValue{Key: string(r.Key), Value: string(r.Value), Enabled: !r.Disabled})
	}
	var notes []Entry
	if len(keyless) > 0 {
		e := drop(CodeRowKeyless, path, plural(len(keyless), what+" without a name", what+"s without a name")+
			" not imported: Ghostman needs a name for every row.", "Add them again with a name if needed.")
		e.Detail, e.DetailLabel = strings.Join(keyless, "\n"), "Values"
		notes = append(notes, e)
	}
	return out, notes
}

func mapHeaders(path string, raw json.RawMessage) ([]api.KeyValue, []Entry) {
	var rows []pmKV
	var s string
	if json.Unmarshal(raw, &s) == nil { // v2.0: "Key: value\n//Disabled: x"
		for _, line := range strings.Split(s, "\n") {
			line = strings.TrimRight(line, "\r")
			if strings.TrimSpace(line) == "" {
				continue
			}
			disabled := strings.HasPrefix(line, "//")
			k, v, _ := strings.Cut(strings.TrimPrefix(line, "//"), ":")
			rows = append(rows, pmKV{Key: flexString(strings.TrimSpace(k)), Value: flexString(strings.TrimSpace(v)), Disabled: disabled})
		}
	} else if len(raw) > 0 {
		_ = json.Unmarshal(raw, &rows)
	}
	return mapRows(path, "header", rows)
}

var languageTypes = map[string]string{
	"json": "application/json", "xml": "application/xml", "text": "text/plain",
	"html": "text/html", "javascript": "application/javascript",
}

func mapBody(path string, b *pmBody, headers []api.KeyValue) (api.RequestBody, []Entry) {
	none := api.RequestBody{Type: api.BodyNone, Fields: []api.KeyValue{}}
	if b == nil || b.Mode == "" {
		return none, nil
	}
	if b.Disabled {
		e := drop(CodeBodyDisabled, path, "the body was disabled in Postman (not sent); Ghostman has no disabled "+
			"bodies, so the request has none.", "Its content is preserved below if you need it.")
		e.Detail, e.DetailLabel = bodyText(b), "Body"
		return none, []Entry{e}
	}
	switch b.Mode {
	case "raw":
		ct := languageTypes[strings.ToLower(b.Options.Raw.Language)]
		if ct == "" {
			ct = headerValue(headers, "content-type")
		}
		if ct == "" {
			ct = api.DefaultRawContentType
		}
		return api.RequestBody{Type: api.BodyRaw, ContentType: ct, Content: b.Raw, Fields: []api.KeyValue{}}, nil
	case "urlencoded":
		fields, notes := mapRows(path, "form field", b.URLEncoded)
		return api.RequestBody{Type: api.BodyForm, Fields: fields}, notes
	case "formdata":
		var text []pmKV
		var notes []Entry
		for _, f := range b.FormData {
			if f.Type == "file" {
				notes = append(notes, drop(CodeBodyFormFile, path,
					fmt.Sprintf("form field '%s' (type file) not imported: file bodies aren't synced.", f.Key),
					"Re-attach it manually."))
				continue
			}
			text = append(text, f)
		}
		fields, more := mapRows(path, "form field", text)
		notes = append(notes, more...)
		notes = append(notes, warn(CodeBodyMultipart, path, "multipart form-data body imported as a URL-encoded form "+
			"(Ghostman has no multipart bodies yet); text fields kept.",
			"An API that requires multipart may reject it."))
		return api.RequestBody{Type: api.BodyForm, Fields: fields}, notes
	case "graphql":
		content := graphQLJSON(b.GraphQL)
		return api.RequestBody{Type: api.BodyRaw, ContentType: "application/json", Content: content, Fields: []api.KeyValue{}},
			[]Entry{warn(CodeBodyGraphQL, path, "GraphQL body imported as raw JSON {query, variables}.",
				"This is the JSON Postman sends for GraphQL; edit it as raw JSON.")}
	case "file":
		return none, []Entry{drop(CodeBodyFile, path, "binary file body not imported: file bodies aren't synced.",
			"Re-attach it manually.")}
	}
	e := drop(CodeBodyUnknown, path, fmt.Sprintf("body mode '%s' is not supported; the request has no body.", b.Mode), "")
	e.Detail, e.DetailLabel = bodyText(b), "Body"
	return none, []Entry{e}
}

func bodyText(b *pmBody) string {
	switch {
	case b.Raw != "":
		return b.Raw
	case b.GraphQL != nil:
		return string(b.GraphQL.Query)
	}
	var lines []string
	for _, f := range append(slices.Clone(b.URLEncoded), b.FormData...) {
		lines = append(lines, fmt.Sprintf("%s: %s", f.Key, f.Value))
	}
	return strings.Join(lines, "\n")
}

// graphQLJSON is {"query": ..., "variables": ...}: the query JSON-encoded, the
// variables text verbatim ({{vars}} included; "{}" when empty), then formatted
// when it parses (jsonfmt keeps {{vars}}); left as built otherwise.
func graphQLJSON(g *pmGQL) string {
	if g == nil {
		g = &pmGQL{}
	}
	var q bytes.Buffer
	enc := json.NewEncoder(&q)
	enc.SetEscapeHTML(false)
	_ = enc.Encode(string(g.Query))
	vars := strings.TrimSpace(string(g.Variables))
	if vars == "" {
		vars = "{}"
	}
	built := `{"query": ` + strings.TrimSpace(q.String()) + `, "variables": ` + vars + `}`
	if pretty, err := jsonfmt.Format(built); err == nil {
		return pretty
	}
	return built
}

func headerValue(rows []api.KeyValue, name string) string {
	for _, r := range rows {
		if r.Enabled && strings.EqualFold(strings.TrimSpace(r.Key), name) {
			return strings.TrimSpace(r.Value)
		}
	}
	return ""
}

var authNames = map[string]string{
	"oauth2": "OAuth 2.0", "oauth1": "OAuth 1.0", "awsv4": "AWS Signature", "digest": "Digest auth",
	"hawk": "Hawk", "ntlm": "NTLM", "edgegrid": "Akamai EdgeGrid", "akamai": "Akamai EdgeGrid",
	"jwt": "JWT Bearer", "asap": "ASAP (Atlassian)",
}

// mapAuth maps Postman auth at any level (collection, folder, request): absent →
// inherit (Postman's default as well), noauth → none, bearer/basic/apikey →
// ours, anything else → inherit + a report line naming what it was.
func mapAuth(path, owner string, raw json.RawMessage) (api.Auth, []Entry) {
	a := api.Auth{Type: api.AuthInherit, APIKeyIn: api.APIKeyInHeader}
	if len(raw) == 0 || string(raw) == "null" {
		return a, nil
	}
	var pa struct {
		Type string `json:"type"`
	}
	if json.Unmarshal(raw, &pa) != nil {
		return a, nil
	}
	params := func(field string) map[string]string { return authParams(raw, field) }
	switch strings.ToLower(pa.Type) {
	case "", "inherit":
		return a, nil
	case "noauth":
		a.Type = api.AuthNone
	case "bearer":
		a.Type, a.BearerToken = api.AuthBearer, params("bearer")["token"]
	case "basic":
		p := params("basic")
		a.Type, a.BasicUsername, a.BasicPassword = api.AuthBasic, p["username"], p["password"]
	case "apikey":
		p := params("apikey")
		a.Type, a.APIKeyName, a.APIKeyValue = api.AuthAPIKey, p["key"], p["value"]
		switch in := strings.ToLower(p["in"]); in {
		case "", "header":
		case "query":
			a.APIKeyIn = api.APIKeyInQuery
		default:
			return a, []Entry{warn(CodeAuthAPIKeyIn, path,
				fmt.Sprintf("API key auth on %s was added to '%s', which is not supported; it is added to a header instead.", owner, in),
				"Switch it to Query params in the Auth tab if needed.")}
		}
	default:
		label := authNames[strings.ToLower(pa.Type)]
		if label == "" {
			label = fmt.Sprintf("'%s'", pa.Type)
		}
		return a, []Entry{warn(CodeAuthUnsupported, path,
			fmt.Sprintf("Auth on %s was %s, which is not supported yet; set to Inherit.", owner, label),
			"Configure Bearer, Basic or API key manually.")}
	}
	return a, nil
}

// authParams reads one auth type's parameters: v2.1 lists [{key, value}] or the
// v2.0 object {"token": "..."}.
func authParams(raw json.RawMessage, field string) map[string]string {
	var holder map[string]json.RawMessage
	_ = json.Unmarshal(raw, &holder)
	out := map[string]string{}
	var list []pmKV
	if json.Unmarshal(holder[field], &list) == nil {
		for _, p := range list {
			out[string(p.Key)] = string(p.Value)
		}
		return out
	}
	var obj map[string]flexString
	if json.Unmarshal(holder[field], &obj) == nil {
		for k, v := range obj {
			out[k] = string(v)
		}
	}
	return out
}

// mapBehavior maps protocolProfileBehavior: followRedirects → our cascading
// follow setting; every other key is reported (not supported).
func mapBehavior(path string, b map[string]json.RawMessage) (string, []Entry) {
	follow := ""
	var other []string
	for k, v := range b {
		if k == "followRedirects" {
			switch string(v) {
			case "true":
				follow = api.SettingOn
			case "false":
				follow = api.SettingOff
			}
			continue
		}
		other = append(other, k)
	}
	if len(other) == 0 {
		return follow, nil
	}
	slices.Sort(other)
	return follow, []Entry{drop(CodeSettingOther, path,
		fmt.Sprintf("request settings %s are not supported; not imported.", quoteList(other)), "")}
}

func quoteList(xs []string) string {
	q := make([]string, len(xs))
	for i, x := range xs {
		q[i] = "'" + x + "'"
	}
	return strings.Join(q, ", ")
}

// mapScripts reports every non-empty script WITH its full text: Ghostman does not
// run scripts, and the user's code must not be swallowed.
func mapScripts(path string, events []pmEvent) []Entry {
	var notes []Entry
	for _, ev := range events {
		src := text(ev.Script.Exec)
		if strings.TrimSpace(src) == "" {
			continue // an empty script (Postman exports them) holds no code
		}
		lines := len(strings.Split(strings.TrimRight(src, "\n"), "\n"))
		kind, code, label := ev.Listen+" script", CodeScriptOther, "Script"
		switch ev.Listen {
		case "prerequest":
			kind, code, label = "pre-request script", CodeScriptPreRequest, "Pre-request script"
		case "test":
			kind, code, label = "test script", CodeScriptTest, "Test script"
		}
		if ev.Disabled {
			kind += ", disabled in Postman"
		}
		e := drop(code, path, fmt.Sprintf("%s (%s): Ghostman doesn't run scripts. Script text preserved below.",
			kind, plural(lines, "line", "lines")), "")
		e.Detail, e.DetailLabel = src, label
		notes = append(notes, e)
	}
	return notes
}

// mapVariables reports collection / folder variables (with their values): Ghostman
// has variables only in environments.
func mapVariables(code, path, owner string, vars []pmKV) []Entry {
	if len(vars) == 0 {
		return nil
	}
	lines := make([]string, 0, len(vars))
	for _, v := range vars {
		lines = append(lines, fmt.Sprintf("%s = %s", v.Key, v.Value))
	}
	msg := plural(len(vars), "collection variable", "collection variables") +
		" not imported: Ghostman has no collection variables."
	if code == CodeFolderVars {
		msg = fmt.Sprintf("%s on %s not imported: Ghostman has no folder variables.",
			plural(len(vars), "variable", "variables"), owner)
	}
	e := drop(code, path, msg, "Create them in an environment (Manage environments) so the {{variables}} resolve.")
	e.Detail, e.DetailLabel = strings.Join(lines, "\n"), "Variables"
	return []Entry{e}
}
