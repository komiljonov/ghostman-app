package importer

import (
	"encoding/json"
	"fmt"
	"net/url"
	"regexp"
	"slices"
	"strings"
	"unicode/utf8"

	"ghostman/internal/api"
)

// The OpenAPI mapper: an OpenAPI 3.0 / 3.1 spec (or a Swagger 2.0 spec, converted
// first — swagger.go) → the same CollectionPlan the Postman importer executes,
// plus one environment per server. Pure; works on the order-preserving tree.
//
//	the spec        → ONE new root folder named info.title (deduped "(2)"), auth from
//	                  the global security requirement on it (the cascade covers all)
//	tags            → one level of folders, by each operation's FIRST tag: declared
//	                  tags in order, then tags in order of appearance; untagged
//	                  operations go into the root folder
//	operation       → one request (path × method), spec order: name = summary, else
//	                  operationId, else "METHOD /path" (shortened past 100 characters);
//	                  url = {{BASE_URL}} + path with {p} → {{p}}; query / header
//	                  parameters → rows (path-level + operation-level, the operation
//	                  wins on name+in), value = example / default / enum[0] / "",
//	                  enabled = required; cookie parameters dropped; trace dropped
//	requestBody     → JSON first (raw, the media example, else generated from the
//	                  schema), else urlencoded / multipart (form rows; file fields
//	                  dropped), else raw with that type
//	servers         → one environment each (name = description, else host; deduped),
//	                  with a regular BASE_URL = the url (variables substituted,
//	                  trailing "/" stripped)
//
// Generated bodies follow example > default > enum[0] > const > a type placeholder
// ("" / 0 / false / [one item] / an object of its properties, readOnly ones left
// out), resolve local $refs (any "#/..." JSON pointer — specs point into paths
// too) with a cycle guard (a $ref already on the path → null, one report entry
// per schema) and a nesting cap of 8.

// ServerEnvPlan is an environment to create for one server.
type ServerEnvPlan struct {
	Name    string
	BaseURL string
}

const (
	maxSchemaDepth  = 8
	maxRequestName  = 100
	baseURLVariable = "BASE_URL"
	tokenVariable   = "TOKEN"
	apiKeyVariable  = "API_KEY"
)

// OpenAPI deviation codes (part of FallbackCodes).
const (
	CodeOANameLong       = "openapi.name_long"
	CodeOATrace          = "openapi.trace"
	CodeOAPathParams     = "openapi.path_params"
	CodeOACookieParams   = "openapi.cookie_params"
	CodeOADeprecated     = "openapi.deprecated"
	CodeOASynthesized    = "openapi.synthesized_bodies"
	CodeOARefCycle       = "openapi.ref_cycle"
	CodeOADepthCap       = "openapi.depth_cap"
	CodeOARefBroken      = "openapi.ref_broken"
	CodeOABodyOther      = "openapi.body_other"
	CodeOAAltContent     = "openapi.alt_content"
	CodeOAAuthSet        = "openapi.auth_placeholder"
	CodeOAAuthCookie     = "openapi.auth_cookie"
	CodeOAAuthCombined   = "openapi.auth_combined"
	CodeOAOpSecurity     = "openapi.op_security"
	CodeOAServerVar      = "openapi.server_variable"
	CodeOAServerRelative = "openapi.server_relative"
	CodeOANoServers      = "openapi.no_servers"
	CodeOASchemes        = "openapi.schemes_merged"
)

var openAPIMethods = []string{"get", "put", "post", "delete", "options", "head", "patch", "trace"}

type oaMapper struct {
	doc        *omap
	rep        *Report
	title      string
	optional   int // optional parameters / fields imported disabled
	altContent []string
	synth      []string            // requests with generated bodies
	cycles     map[string][]string // schema $ref → requests
	cycleOrder []string
	depthHit   []string
	broken     map[string][]string
	brokenList []string
	authNoted  map[string]bool
	cur        string // the request being mapped (for aggregated entries)
}

// PlanOpenAPI maps an OpenAPI 3.x or Swagger 2.0 spec (JSON or YAML).
// existingRoots / existingEnvs are the project's root folder and environment
// names, for the "(2)" dedupe.
func PlanOpenAPI(data []byte, source string, existingRoots, existingEnvs []string) (*CollectionPlan, error) {
	tree, err := decodeTree(data)
	if err != nil {
		return nil, err
	}
	doc, ok := tree.(*omap)
	if !ok {
		return nil, ErrNotSupported
	}
	format, err := openAPIFormat(doc)
	if err != nil {
		return nil, err
	}
	var notes []string
	var order *pathOrder
	converted := false
	if strings.HasPrefix(format, "Swagger") {
		doc, order, err = convertSwagger(doc)
		if err != nil {
			return nil, err
		}
		converted = true
		notes = append(notes, "Converted from Swagger 2.0 before import.")
	}
	m := &oaMapper{doc: doc, cycles: map[string][]string{}, broken: map[string][]string{}, authNoted: map[string]bool{}}
	title, nameNotes := mapName("", doc.obj("info").str("title"), "Imported API")
	m.rep = newReport(KindOpenAPI, source, format, doc.obj("info").str("title"))
	m.rep.Notes = notes
	m.rep.add(nameNotes...)
	m.title = title

	root := &FolderPlan{Path: title, Name: UniqueName(title, existingRoots)}
	globalReq := doc.arr("security")
	var authNotes []Entry
	root.Auth, authNotes, _ = m.securityAuth(title, globalReq, "the root folder")
	m.rep.add(authNotes...)

	descriptions := 0
	if doc.obj("info").str("description") != "" {
		descriptions++
	}
	// Tag folders: declared order, then appearance.
	folders := map[string]*FolderPlan{}
	var folderOrder []string
	addTag := func(name string) *FolderPlan {
		if f, ok := folders[name]; ok {
			return f
		}
		f := &FolderPlan{Path: title + " / " + name, Name: name, Auth: api.Auth{Type: api.AuthInherit, APIKeyIn: api.APIKeyInHeader}}
		folders[name] = f
		folderOrder = append(folderOrder, name)
		return f
	}
	used := map[string]bool{}
	for _, p := range doc.obj("paths").Keys() {
		item, _ := m.deref(doc.obj("paths").get(p)).(*omap)
		for _, method := range openAPIMethods {
			if op := item.obj(method); op != nil {
				if tags := op.arr("tags"); len(tags) > 0 {
					if t, _ := tags[0].(string); strings.TrimSpace(t) != "" {
						used[strings.TrimSpace(t)] = true
					}
				}
			}
		}
	}
	for _, t := range doc.arr("tags") {
		to, _ := t.(*omap)
		name := strings.TrimSpace(to.str("name"))
		if name != "" && used[name] {
			addTag(name)
			if to.str("description") != "" {
				descriptions++
			}
		}
	}

	count := 0
	for _, op := range m.operations(order) {
		if op.method == "trace" {
			at := title
			if tag := op.firstTag(); tag != "" {
				at += " / " + tag
			}
			m.rep.add(drop(CodeOATrace, at+" / "+op.label(), "TRACE operation not imported: Ghostman sends only "+
				"GET, POST, PUT, PATCH, DELETE, HEAD and OPTIONS.", ""))
			continue
		}
		parent := root
		if tag := op.firstTag(); tag != "" {
			parent = addTag(tag)
		}
		req, n := m.request(parent.Path, op, globalReq)
		descriptions += n
		parent.Requests = append(parent.Requests, req)
		count++
	}
	for _, name := range folderOrder {
		root.Folders = append(root.Folders, folders[name])
	}

	plan := &CollectionPlan{Report: m.rep, Root: root, Items: len(root.Folders) + count}
	plan.Environments = m.servers(doc, existingEnvs, converted)
	m.finish(descriptions)
	return plan, nil
}

func openAPIFormat(doc *omap) (string, error) {
	if v := doc.str("openapi"); v != "" {
		if strings.HasPrefix(v, "3.") {
			return "OpenAPI " + v, nil
		}
		return "", fmt.Errorf("this is OpenAPI %s, which is not supported. Supported: OpenAPI 3.0 and 3.1, and Swagger 2.0", v)
	}
	if v := doc.str("swagger"); v != "" {
		if v == "2.0" {
			return "Swagger 2.0", nil
		}
		return "", fmt.Errorf("this is Swagger %s, which is not supported. Supported: Swagger 2.0, and OpenAPI 3.0 and 3.1", v)
	}
	return "", ErrNotSupported
}

type oaOperation struct {
	path, method string
	item, op     *omap
}

func (o oaOperation) label() string {
	if s := strings.TrimSpace(o.op.str("summary")); s != "" {
		return s
	}
	if id := strings.TrimSpace(o.op.str("operationId")); id != "" {
		return id
	}
	return strings.ToUpper(o.method) + " " + o.path
}

func (o oaOperation) firstTag() string {
	if tags := o.op.arr("tags"); len(tags) > 0 {
		t, _ := tags[0].(string)
		return strings.TrimSpace(t)
	}
	return ""
}

// operations in spec order (for a converted Swagger spec: the original order).
func (m *oaMapper) operations(order *pathOrder) []oaOperation {
	paths := m.doc.obj("paths")
	var out []oaOperation
	keys := paths.Keys()
	if order != nil {
		keys = order.sortPaths(keys)
	}
	for _, p := range keys {
		item, _ := m.deref(paths.get(p)).(*omap)
		methods := slices.Clone(item.Keys())
		if order != nil {
			methods = order.sortMethods(p, methods)
		}
		for _, k := range methods {
			if slices.Contains(openAPIMethods, k) {
				if op := item.obj(k); op != nil {
					out = append(out, oaOperation{path: p, method: k, item: item, op: op})
				}
			}
		}
	}
	return out
}

var pathParam = regexp.MustCompile(`\{([^{}]+)\}`)

// request maps one operation; it also returns how many descriptions it had.
func (m *oaMapper) request(parentPath string, op oaOperation, globalReq []any) (*RequestPlan, int) {
	name, nameNotes := requestName(parentPath, op.label())
	path := parentPath + " / " + name
	m.cur = path
	m.rep.add(nameNotes...)
	rp := &RequestPlan{Path: path, Name: name}
	d := &rp.Draft
	d.Method = strings.ToUpper(op.method)

	// URL: {{BASE_URL}} + the path, {p} → {{p}}.
	var converted []string
	d.URL = "{{" + baseURLVariable + "}}" + pathParam.ReplaceAllStringFunc(op.path, func(s string) string {
		converted = append(converted, s[1:len(s)-1])
		return "{{" + s[1:len(s)-1] + "}}"
	})
	if len(converted) > 0 {
		m.rep.add(warn(CodeOAPathParams, path, fmt.Sprintf("%s %s converted to %s %s.",
			word(len(converted), "path parameter", "path parameters"), quoteList(wrapAll(converted, "{", "}")),
			word(len(converted), "the Ghostman variable", "Ghostman variables"), strings.Join(wrapAll(converted, "{{", "}}"), ", ")),
			fmt.Sprintf("Define %s in an environment or replace %s inline.", itThem(len(converted)), itThem(len(converted)))))
	}

	var notes []Entry
	d.QueryParams, d.Headers, notes = m.parameters(path, op)
	m.rep.add(notes...)
	d.Body, notes = m.requestBody(path, op.op.get("requestBody"))
	m.rep.add(notes...)

	d.Auth = api.Auth{Type: api.AuthInherit, APIKeyIn: api.APIKeyInHeader}
	if op.op.has("security") && !sameRequirement(op.op.arr("security"), globalReq) {
		a, notes, ok := m.securityAuth(path, op.op.arr("security"), fmt.Sprintf("request '%s'", name))
		m.rep.add(notes...)
		if ok {
			d.Auth = a
		} else {
			m.rep.add(warn(CodeOAOpSecurity, path, "this operation's own security requirement can't be set up in "+
				"Ghostman; it inherits the root folder's auth instead.", "Set its Auth tab manually if needed."))
		}
	}
	if op.op.boolean("deprecated") {
		m.rep.add(warn(CodeOADeprecated, path, "marked deprecated in the spec; imported anyway.", ""))
	}
	descriptions := 0
	if op.op.str("description") != "" {
		descriptions = 1
	}
	return rp, descriptions
}

func requestName(parent, label string) (string, []Entry) {
	name, notes := mapName(parent, label, "Untitled request")
	if utf8.RuneCountInString(name) <= maxRequestName {
		return name, notes
	}
	short := string([]rune(name)[:maxRequestName-1]) + "…"
	return short, append(notes, warn(CodeOANameLong, parent+" / "+short,
		fmt.Sprintf("the name was longer than %d characters and was shortened. The full name: %q.", maxRequestName, name), ""))
}

func wrapAll(xs []string, l, r string) []string {
	out := make([]string, len(xs))
	for i, x := range xs {
		out[i] = l + x + r
	}
	return out
}

// parameters merges path-level and operation-level parameters (the operation
// wins on name+in) into query and header rows.
func (m *oaMapper) parameters(path string, op oaOperation) ([]api.KeyValue, []api.KeyValue, []Entry) {
	type key struct{ name, in string }
	var order []key
	byKey := map[key]*omap{}
	for _, list := range [][]any{op.item.arr("parameters"), op.op.arr("parameters")} {
		for _, raw := range list {
			p, _ := m.deref(raw).(*omap)
			if p == nil {
				continue
			}
			k := key{p.str("name"), p.str("in")}
			if _, seen := byKey[k]; !seen {
				order = append(order, k)
			}
			byKey[k] = p
		}
	}
	query, headers := []api.KeyValue{}, []api.KeyValue{}
	var cookies []string
	for _, k := range order {
		p := byKey[k]
		if strings.TrimSpace(k.name) == "" {
			continue
		}
		row := api.KeyValue{Key: k.name, Value: scalarString(m.paramExample(p)), Enabled: p.boolean("required")}
		switch k.in {
		case "query":
			query = append(query, row)
		case "header":
			switch strings.ToLower(k.name) {
			case "accept", "content-type", "authorization":
				continue // OpenAPI: such header parameters are ignored (body / auth define them)
			}
			headers = append(headers, row)
		case "cookie":
			cookies = append(cookies, k.name)
			continue
		default:
			continue // path parameters: the URL conversion
		}
		if !row.Enabled {
			m.optional++
		}
	}
	var notes []Entry
	if len(cookies) > 0 {
		notes = append(notes, drop(CodeOACookieParams, path, fmt.Sprintf("cookie parameters %s not imported: "+
			"Ghostman has no cookies yet.", quoteList(cookies)), "Add them as a Cookie header if the API needs them."))
	}
	return query, headers, notes
}

// paramExample: example > examples[first].value > schema example / default / enum[0].
func (m *oaMapper) paramExample(p *omap) any {
	if p.has("example") {
		return m.plain(p.get("example"), nil)
	}
	if ex := p.obj("examples"); ex != nil && len(ex.Keys()) > 0 {
		if e, _ := m.deref(ex.get(ex.Keys()[0])).(*omap); e != nil && e.has("value") {
			return m.plain(e.get("value"), nil)
		}
	}
	s, _ := m.deref(p.get("schema")).(*omap)
	for _, sch := range []*omap{s, m.itemsOf(s)} {
		switch {
		case sch.has("example"):
			return m.plain(sch.get("example"), nil)
		case sch.has("default"):
			return m.plain(sch.get("default"), nil)
		case len(sch.arr("enum")) > 0:
			return sch.arr("enum")[0]
		}
	}
	if s == nil && p.has("default") { // Swagger-style leftovers
		return p.get("default")
	}
	return ""
}

// itemsOf is an array schema's item schema (nil otherwise).
func (m *oaMapper) itemsOf(s *omap) *omap {
	if schemaType(s) != "array" {
		return nil
	}
	items, _ := m.deref(s.get("items")).(*omap)
	return items
}

// scalarString renders an example value for a row: strings verbatim, numbers as
// written, arrays comma-joined, objects as compact JSON.
func scalarString(v any) string {
	switch x := v.(type) {
	case nil:
		return ""
	case string:
		return x
	case json.Number:
		return x.String()
	case bool:
		if x {
			return "true"
		}
		return "false"
	case []any:
		parts := make([]string, len(x))
		for i, e := range x {
			parts[i] = scalarString(e)
		}
		return strings.Join(parts, ",")
	}
	b, _ := marshalValue(v)
	return string(b)
}

func isJSONType(ct string) bool {
	ct = strings.ToLower(strings.TrimSpace(strings.Split(ct, ";")[0]))
	return ct == "application/json" || strings.HasSuffix(ct, "+json") || strings.HasSuffix(ct, "/json")
}

func (m *oaMapper) requestBody(path string, raw any) (api.RequestBody, []Entry) {
	none := api.RequestBody{Type: api.BodyNone, Fields: []api.KeyValue{}}
	rb, _ := m.deref(raw).(*omap)
	content := rb.obj("content")
	if content == nil || len(content.Keys()) == 0 {
		return none, nil
	}
	pick := ""
	for _, ct := range content.Keys() {
		if isJSONType(ct) {
			pick = ct
			break
		}
	}
	for _, want := range []string{"application/x-www-form-urlencoded", "multipart/form-data"} {
		if pick != "" {
			break
		}
		for _, ct := range content.Keys() {
			if strings.EqualFold(strings.TrimSpace(strings.Split(ct, ";")[0]), want) {
				pick = ct
				break
			}
		}
	}
	var notes []Entry
	other := false
	if pick == "" {
		pick, other = content.Keys()[0], true
	}
	if len(content.Keys()) > 1 {
		m.altContent = append(m.altContent, path)
	}
	media, _ := m.deref(content.get(pick)).(*omap)
	base := strings.ToLower(strings.TrimSpace(strings.Split(pick, ";")[0]))
	if (base == "*/*" || base == "application/*") && media.has("schema") {
		// No content type in the spec (Swagger without "consumes"): a schema'd body is JSON in practice.
		notes = append(notes, warn(CodeOABodyOther, path, fmt.Sprintf("the spec gives no content type for the body "+
			"('%s'); imported as JSON.", pick), "Change the content type if the API expects something else."))
		pick, base, other = "application/json", "application/json", false
	}
	switch {
	case isJSONType(pick):
		if ex, ok := m.mediaExample(media); ok {
			return api.RequestBody{Type: api.BodyRaw, ContentType: pick, Content: exampleText(ex), Fields: []api.KeyValue{}}, notes
		}
		v := m.schemaValue(media.get("schema"), 0, nil)
		m.synth = append(m.synth, path)
		return api.RequestBody{Type: api.BodyRaw, ContentType: pick, Content: prettyJSON(v), Fields: []api.KeyValue{}}, notes
	case base == "application/x-www-form-urlencoded" || base == "multipart/form-data":
		fields, files := m.formFields(media.get("schema"))
		for _, f := range files {
			notes = append(notes, drop(CodeBodyFormFile, path,
				fmt.Sprintf("form field '%s' (type file) not imported: file bodies aren't synced.", f), "Re-attach it manually."))
		}
		if base == "multipart/form-data" {
			notes = append(notes, warn(CodeBodyMultipart, path, "multipart form-data body imported as a URL-encoded form "+
				"(Ghostman has no multipart bodies yet); text fields kept.", "An API that requires multipart may reject it."))
		}
		return api.RequestBody{Type: api.BodyForm, Fields: fields}, notes
	}
	text := ""
	if ex, ok := m.mediaExample(media); ok {
		if s, isStr := ex.(string); isStr {
			text = s
		} else {
			text = prettyJSON(ex)
		}
	}
	if other {
		with := ", empty"
		if text != "" {
			with = " with the spec's example"
		}
		notes = append(notes, warn(CodeOABodyOther, path, fmt.Sprintf("the body is '%s'; imported as a raw body of that "+
			"type%s.", pick, with), "Fill it in before sending."))
	}
	return api.RequestBody{Type: api.BodyRaw, ContentType: pick, Content: text, Fields: []api.KeyValue{}}, notes
}

func (m *oaMapper) mediaExample(media *omap) (any, bool) {
	if media.has("example") {
		return m.plain(media.get("example"), nil), true
	}
	if ex := media.obj("examples"); ex != nil && len(ex.Keys()) > 0 {
		if e, _ := m.deref(ex.get(ex.Keys()[0])).(*omap); e != nil && e.has("value") {
			return m.plain(e.get("value"), nil), true
		}
	}
	return nil, false
}

// exampleText: an example given as a JSON string is used as written when it is
// JSON itself, else JSON-encoded.
func exampleText(v any) string {
	if s, ok := v.(string); ok {
		if json.Valid([]byte(s)) {
			return s
		}
	}
	return prettyJSON(v)
}

// formFields reads a form schema's properties: text fields (enabled = required),
// and the names of binary / file fields (dropped).
func (m *oaMapper) formFields(raw any) ([]api.KeyValue, []string) {
	s := m.mergedSchema(raw, nil)
	fields := []api.KeyValue{}
	var files []string
	if s == nil {
		return fields, nil
	}
	required := map[string]bool{}
	for _, r := range s.arr("required") {
		if k, ok := r.(string); ok {
			required[k] = true
		}
	}
	props := s.obj("properties")
	for _, k := range props.Keys() {
		p, _ := m.deref(props.get(k)).(*omap)
		if p.boolean("readOnly") {
			continue
		}
		if t := schemaType(p); t == "file" || (t == "string" && (p.str("format") == "binary")) ||
			(t == "array" && func() bool { it, _ := m.deref(p.get("items")).(*omap); return it.str("format") == "binary" }()) {
			files = append(files, k)
			continue
		}
		v := m.schemaValue(props.get(k), 1, nil)
		row := api.KeyValue{Key: k, Value: scalarString(v), Enabled: required[k]}
		if !row.Enabled {
			m.optional++
		}
		fields = append(fields, row)
	}
	return fields, files
}

// mergedSchema resolves a schema and merges allOf parts' properties / required.
func (m *oaMapper) mergedSchema(raw any, stack []string) *omap {
	s, _ := m.deref(raw).(*omap)
	if s == nil || len(s.arr("allOf")) == 0 {
		return s
	}
	out := newOmap()
	props := newOmap()
	var req []any
	for _, part := range append([]any{s}, s.arr("allOf")...) {
		ps, _ := m.deref(part).(*omap)
		if ps == nil {
			continue
		}
		if ps != s && len(ps.arr("allOf")) > 0 && len(stack) < maxSchemaDepth {
			ps = m.mergedSchema(ps, append(stack, "allOf"))
		}
		if pp := ps.obj("properties"); pp != nil {
			for _, k := range pp.Keys() {
				props.set(k, pp.get(k))
			}
		}
		req = append(req, ps.arr("required")...)
	}
	out.set("type", "object")
	out.set("properties", props)
	out.set("required", req)
	return out
}

// deref follows $ref chains (one hop at a time, a cycle stops it); refs that
// point to nothing are reported once per ref.
func (m *oaMapper) deref(v any) any {
	seen := map[string]bool{}
	for {
		o, ok := v.(*omap)
		if !ok {
			return v
		}
		ref := o.str("$ref")
		if ref == "" || seen[ref] {
			return v
		}
		seen[ref] = true
		target, err := resolvePointer(m.doc, ref)
		if err != nil {
			m.brokenRef(ref)
			return nil
		}
		v = target
	}
}

func (m *oaMapper) brokenRef(ref string) {
	if _, ok := m.broken[ref]; !ok {
		m.brokenList = append(m.brokenList, ref)
	}
	if m.cur != "" && !slices.Contains(m.broken[ref], m.cur) {
		m.broken[ref] = append(m.broken[ref], m.cur)
	} else if _, ok := m.broken[ref]; !ok {
		m.broken[ref] = nil
	}
}

// plain resolves $refs inside an example value (some specs point examples at
// other examples), with a cycle guard.
func (m *oaMapper) plain(v any, stack []string) any {
	switch x := v.(type) {
	case *omap:
		if ref := x.str("$ref"); ref != "" && len(x.Keys()) == 1 {
			if slices.Contains(stack, ref) || len(stack) > maxSchemaDepth {
				return nil
			}
			target, err := resolvePointer(m.doc, ref)
			if err != nil {
				m.brokenRef(ref)
				return nil
			}
			return m.plain(target, append(stack, ref))
		}
		out := newOmap()
		for _, k := range x.Keys() {
			out.set(k, m.plain(x.vals[k], stack))
		}
		return out
	case []any:
		out := make([]any, len(x))
		for i, e := range x {
			out[i] = m.plain(e, stack)
		}
		return out
	}
	return v
}

func schemaType(s *omap) string {
	switch t := s.get("type").(type) {
	case string:
		return t
	case []any: // 3.1: ["string", "null"]
		for _, e := range t {
			if str, _ := e.(string); str != "" && str != "null" {
				return str
			}
		}
		if len(t) > 0 {
			return "null"
		}
	}
	switch {
	case s.has("properties"):
		return "object"
	case s.has("items"):
		return "array"
	}
	return ""
}

// schemaValue generates a value from a schema (see the package comment above).
func (m *oaMapper) schemaValue(raw any, depth int, stack []string) any {
	s, ok := raw.(*omap)
	if !ok {
		return nil
	}
	if ref := s.str("$ref"); ref != "" {
		if slices.Contains(stack, ref) {
			m.cycle(ref)
			return nil
		}
		target, err := resolvePointer(m.doc, ref)
		if err != nil {
			m.brokenRef(ref)
			return nil
		}
		return m.schemaValue(target, depth, append(slices.Clone(stack), ref))
	}
	if depth > maxSchemaDepth {
		if !slices.Contains(m.depthHit, m.cur) {
			m.depthHit = append(m.depthHit, m.cur)
		}
		return nil
	}
	switch {
	case s.has("example"):
		return m.plain(s.get("example"), nil)
	case s.has("examples") && len(s.arr("examples")) > 0: // 3.1 schema examples
		return m.plain(s.arr("examples")[0], nil)
	case s.has("default"):
		return m.plain(s.get("default"), nil)
	case len(s.arr("enum")) > 0:
		return s.arr("enum")[0]
	case s.has("const"):
		return s.get("const")
	}
	if all := s.arr("allOf"); len(all) > 0 {
		out := newOmap()
		var last any
		for _, part := range all {
			v := m.schemaValue(part, depth, stack)
			if o, ok := v.(*omap); ok {
				for _, k := range o.Keys() {
					out.set(k, o.vals[k])
				}
			} else if v != nil {
				last = v
			}
		}
		if s.has("properties") { // properties next to allOf belong to the same object
			if o, ok := m.objectValue(s, depth, stack).(*omap); ok {
				for _, k := range o.Keys() {
					out.set(k, o.vals[k])
				}
			}
		}
		if len(out.Keys()) > 0 || last == nil {
			return out
		}
		return last
	}
	for _, key := range []string{"oneOf", "anyOf"} {
		if alts := s.arr(key); len(alts) > 0 {
			return m.schemaValue(alts[0], depth, stack)
		}
	}
	switch schemaType(s) {
	case "object":
		return m.objectValue(s, depth, stack)
	case "array":
		if !s.has("items") {
			return []any{}
		}
		return []any{m.schemaValue(s.get("items"), depth+1, stack)}
	case "string":
		return ""
	case "integer", "number":
		return json.Number("0")
	case "boolean":
		return false
	}
	return nil
}

func (m *oaMapper) objectValue(s *omap, depth int, stack []string) any {
	out := newOmap()
	props := s.obj("properties")
	for _, k := range props.Keys() {
		p, _ := m.deref(props.get(k)).(*omap)
		if p.boolean("readOnly") {
			continue // the server sets it; a request does not send it
		}
		out.set(k, m.schemaValue(props.get(k), depth+1, stack))
	}
	return out
}

func (m *oaMapper) cycle(ref string) {
	if _, ok := m.cycles[ref]; !ok {
		m.cycleOrder = append(m.cycleOrder, ref)
	}
	if !slices.Contains(m.cycles[ref], m.cur) {
		m.cycles[ref] = append(m.cycles[ref], m.cur)
	}
}

func sameRequirement(a, b []any) bool {
	x, _ := marshalValue(a)
	y, _ := marshalValue(b)
	return string(x) == string(y)
}

// securityAuth maps a security requirement list (its FIRST requirement) to our
// auth. ok=false: it cannot be set up (an entry says why). absent → inherit;
// [] or [{}] → none (anonymous) — except on the root folder, where nothing is
// above it anyway (inherit).
func (m *oaMapper) securityAuth(path string, reqs []any, owner string) (api.Auth, []Entry, bool) {
	a := api.Auth{Type: api.AuthInherit, APIKeyIn: api.APIKeyInHeader}
	isRoot := owner == "the root folder"
	if reqs == nil {
		return a, nil, true
	}
	first, _ := firstReq(reqs)
	if first == nil || len(first.Keys()) == 0 {
		if !isRoot {
			a.Type = api.AuthNone
		}
		return a, nil, true
	}
	var notes []Entry
	name := first.Keys()[0]
	if len(first.Keys()) > 1 {
		notes = append(notes, warn(CodeOAAuthCombined, path, fmt.Sprintf("the spec requires %s together; only '%s' "+
			"was set up on %s.", quoteList(first.Keys()), name, owner), "Add the others as headers or query params manually."))
	}
	scheme, _ := m.deref(m.doc.obj("components").obj("securitySchemes").get(name)).(*omap)
	if scheme == nil {
		return a, append(notes, warn(CodeAuthUnsupported, path, fmt.Sprintf("Auth on %s uses security scheme '%s', which "+
			"the spec does not define; set to Inherit.", owner, name), "Configure Bearer, Basic or API key manually.")), false
	}
	noteOnce := func(e Entry) {
		if !m.authNoted[name+"|"+e.Code] {
			m.authNoted[name+"|"+e.Code] = true
			notes = append(notes, e)
		}
	}
	switch strings.ToLower(scheme.str("type")) {
	case "http":
		switch strings.ToLower(scheme.str("scheme")) {
		case "bearer":
			a.Type, a.BearerToken = api.AuthBearer, "{{"+tokenVariable+"}}"
			noteOnce(warn(CodeOAAuthSet, path, fmt.Sprintf("Auth '%s' (HTTP bearer) set on %s with the token {{%s}}.",
				name, owner, tokenVariable), fmt.Sprintf("Set your token: create %s in your environment, as a secret "+
				"variable so it stays on this machine.", tokenVariable)))
			return a, notes, true
		case "basic":
			a.Type = api.AuthBasic
			noteOnce(warn(CodeOAAuthSet, path, fmt.Sprintf("Auth '%s' (HTTP basic) set on %s with an empty username and "+
				"password.", name, owner), "Fill them in (Settings… on the folder, Auth), ideally with secret {{variables}}."))
			return a, notes, true
		}
		noteOnce(warn(CodeAuthUnsupported, path, fmt.Sprintf("Auth on %s is HTTP '%s' (scheme '%s'), which is not "+
			"supported yet; set to Inherit.", owner, scheme.str("scheme"), name), "Configure Bearer, Basic or API key manually."))
		return a, notes, false
	case "apikey":
		switch in := strings.ToLower(scheme.str("in")); in {
		case "header", "query":
			a.Type, a.APIKeyName, a.APIKeyValue = api.AuthAPIKey, scheme.str("name"), "{{"+apiKeyVariable+"}}"
			if in == "query" {
				a.APIKeyIn = api.APIKeyInQuery
			}
			noteOnce(warn(CodeOAAuthSet, path, fmt.Sprintf("Auth '%s' (API key in %s '%s') set on %s with the value {{%s}}.",
				name, in, scheme.str("name"), owner, apiKeyVariable), fmt.Sprintf("Create %s in your environment, as a "+
				"secret variable so it stays on this machine.", apiKeyVariable)))
			return a, notes, true
		default:
			noteOnce(warn(CodeOAAuthCookie, path, fmt.Sprintf("Auth on %s is an API key in a cookie ('%s'); Ghostman has "+
				"no cookies yet, so it is set to Inherit.", owner, scheme.str("name")), "Send it as a Cookie header manually."))
			return a, notes, false
		}
	case "oauth2":
		flows := scheme.obj("flows")
		label := "OAuth 2.0"
		if flows != nil && len(flows.Keys()) > 0 {
			label += " (" + strings.Join(flows.Keys(), ", ") + " flow)"
		}
		noteOnce(warn(CodeAuthUnsupported, path, fmt.Sprintf("Auth on %s is %s via scheme '%s', which is not supported "+
			"yet; set to Inherit.", owner, label, name), "Get a token yourself and use Bearer with it."))
		return a, notes, false
	}
	label := scheme.str("type")
	if label == "openIdConnect" {
		label = "OpenID Connect"
	}
	noteOnce(warn(CodeAuthUnsupported, path, fmt.Sprintf("Auth on %s is %s (scheme '%s'), which is not supported yet; "+
		"set to Inherit.", owner, label, name), "Configure Bearer, Basic or API key manually."))
	return a, notes, false
}

func firstReq(reqs []any) (*omap, bool) {
	if len(reqs) == 0 {
		return nil, false
	}
	o, _ := reqs[0].(*omap)
	return o, true
}

var serverVar = regexp.MustCompile(`\{([^{}]+)\}`)

// servers → one environment each.
func (m *oaMapper) servers(doc *omap, existingEnvs []string, converted bool) []*ServerEnvPlan {
	list := doc.arr("servers")
	if converted {
		list = m.mergeSchemes(list)
	}
	if len(list) == 0 {
		m.rep.add(warn(CodeOANoServers, m.title, "the spec lists no servers; request URLs start with {{BASE_URL}}.",
			"Create an environment with a BASE_URL variable (e.g. https://api.example.com) and activate it."))
		return nil
	}
	taken := slices.Clone(existingEnvs)
	var out []*ServerEnvPlan
	for _, raw := range list {
		s, _ := raw.(*omap)
		u := s.str("url")
		vars := s.obj("variables")
		var missing []string
		u = serverVar.ReplaceAllStringFunc(u, func(t string) string {
			k := t[1 : len(t)-1]
			if v := vars.obj(k); v != nil && v.has("default") {
				return scalarString(v.get("default"))
			}
			missing = append(missing, k)
			return t
		})
		u = strings.TrimRight(u, "/")
		name := strings.TrimSpace(s.str("description"))
		parsed, perr := url.Parse(u)
		if name == "" {
			switch {
			case perr == nil && parsed.Host != "":
				name = parsed.Host
			case u != "":
				name = u
			default:
				name = "Server"
			}
		}
		name = UniqueName(name, taken)
		taken = append(taken, name)
		if len(missing) > 0 {
			m.rep.add(warn(CodeOAServerVar, "Env '"+name+"'", fmt.Sprintf("the server URL has variables %s without a default; "+
				"they were kept literally in BASE_URL.", quoteList(wrapAll(missing, "{", "}"))), "Edit BASE_URL in Manage environments."))
		}
		if perr != nil || parsed.Scheme == "" || parsed.Host == "" {
			m.rep.add(warn(CodeOAServerRelative, "Env '"+name+"'", fmt.Sprintf("the server URL '%s' is relative; BASE_URL "+
				"was set to it as written.", s.str("url")), "Prepend the host in Manage environments."))
		}
		out = append(out, &ServerEnvPlan{Name: name, BaseURL: u})
	}
	return out
}

// mergeSchemes: a converted Swagger spec gets one server per scheme for the same
// host + basePath; they become ONE environment (https preferred).
func (m *oaMapper) mergeSchemes(list []any) []any {
	type hp struct{ host, path string }
	var order []hp
	best := map[hp]*omap{}
	schemes := map[hp][]string{}
	for _, raw := range list {
		s, _ := raw.(*omap)
		u, err := url.Parse(s.str("url"))
		if err != nil {
			continue
		}
		k := hp{u.Host, u.Path}
		if _, ok := best[k]; !ok {
			order = append(order, k)
			best[k] = s
		} else if u.Scheme == "https" {
			best[k] = s
		}
		schemes[k] = append(schemes[k], u.Scheme)
	}
	out := make([]any, 0, len(order))
	for _, k := range order {
		if len(schemes[k]) > 1 {
			chosen, _ := url.Parse(best[k].str("url"))
			m.rep.add(warn(CodeOASchemes, m.title, fmt.Sprintf("the Swagger spec lists the schemes %s for %s; one environment "+
				"was created, using %s.", quoteList(schemes[k]), k.host, chosen.Scheme), ""))
		}
		out = append(out, best[k])
	}
	return out
}

// finish adds the aggregated entries.
func (m *oaMapper) finish(descriptions int) {
	if n := len(m.synth); n > 0 {
		e := warn(CodeOASynthesized, "", plural(n, "request body", "request bodies")+" generated from schemas "+
			"(the spec gave no example) — review before sending.", "")
		e.Detail, e.DetailLabel = strings.Join(m.synth, "\n"), "Requests"
		m.rep.add(e)
	}
	for _, ref := range m.cycleOrder {
		e := warn(CodeOARefCycle, "", fmt.Sprintf("schema '%s' refers to itself; generated bodies put null where it repeats.", ref),
			"Fill those parts in by hand if the API needs them.")
		e.Detail, e.DetailLabel = strings.Join(m.cycles[ref], "\n"), "Requests"
		m.rep.add(e)
	}
	if n := len(m.depthHit); n > 0 {
		e := warn(CodeOADepthCap, "", fmt.Sprintf("%s nested deeper than %d levels; the deeper parts are null.",
			plural(n, "generated body is", "generated bodies are"), maxSchemaDepth), "")
		e.Detail, e.DetailLabel = strings.Join(m.depthHit, "\n"), "Requests"
		m.rep.add(e)
	}
	for _, ref := range m.brokenList {
		e := warn(CodeOARefBroken, "", fmt.Sprintf("reference '%s' points to nothing in the spec; null was used there.", ref), "")
		if len(m.broken[ref]) > 0 {
			e.Detail, e.DetailLabel = strings.Join(m.broken[ref], "\n"), "Requests"
		}
		m.rep.add(e)
	}
	if n := len(m.altContent); n > 0 {
		e := warn(CodeOAAltContent, "", plural(n, "request body offers", "request bodies offer")+" several content types; "+
			"JSON (else a form) was imported.", "")
		e.Detail, e.DetailLabel = strings.Join(m.altContent, "\n"), "Requests"
		m.rep.add(e)
	}
	if descriptions > 0 {
		m.rep.add(drop(CodeDescriptions, "", plural(descriptions, "description", "descriptions")+
			" not imported: Ghostman has no description field yet.", ""))
	}
	if m.optional > 0 {
		m.rep.Notes = append(m.rep.Notes, "Optional query, header and form parameters were imported disabled; required "+
			"ones are enabled. Turn on the ones you use.")
	}
}
