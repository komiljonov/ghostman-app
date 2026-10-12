// Package importer imports API definitions into a Ghostman project: Postman
// exports — collections (Collection Format v2.0 and v2.1) and environments — and
// OpenAPI specs (3.0, 3.1; Swagger 2.0 via conversion), JSON or YAML.
//
// The work is split so the mapping can be tested without a server:
//
//	Sniff           what kind of file this is (collection / environment / OpenAPI / neither)
//	PlanCollection  Postman collection → an in-memory plan + report entries (pure, mapper.go)
//	PlanEnvironment Postman environment → an in-memory plan + report entries (pure, env.go)
//	PlanOpenAPI     OpenAPI / Swagger → the same plan + environments per server (pure, openapi.go)
//	Execute*        plan → server calls, in order, stopping at the first failure
//	                (execute.go), filling in the rest of the report
//
// The report is a complete accounting: every mapping helper returns its value
// TOGETHER with the report entries its fallbacks produced, so no fallback can
// change or drop something silently (report.go; pinned by the fixture tests).
package importer

import (
	"bytes"
	"encoding/json"
	"errors"
	"strconv"
	"strings"
)

// Kinds of importable file.
const (
	KindCollection  = "collection"
	KindEnvironment = "environment"
	KindOpenAPI     = "openapi"
)

// Human errors for files that cannot be imported (shown as-is in the UI).
var (
	ErrNotSupported = errors.New("this file is not something Ghostman can import. Supported: an OpenAPI spec " +
		"(3.0 or 3.1) or a Swagger 2.0 spec, as JSON or YAML; a Postman collection (Collection v2.0 or v2.1 " +
		"export); or a Postman environment export")
	ErrCollectionV1 = errors.New("this is a Postman Collection v1 file, which is not supported. In Postman, " +
		"export the collection again and choose Collection v2.1")
)

// FileInfo describes a sniffed file (the import modal shows it before importing).
type FileInfo struct {
	Kind      string `json:"kind"`   // KindCollection | KindEnvironment
	Name      string `json:"name"`   // collection / environment name from the file
	Format    string `json:"format"` // "Collection v2.1", "Collection v2.0", "Environment", "Globals"
	Folders   int    `json:"folders"`
	Requests  int    `json:"requests"`
	Variables int    `json:"variables"`
	Servers   int    `json:"servers"` // OpenAPI: one environment each
}

// Sniff decides what data (JSON or YAML) is: an OpenAPI spec ("openapi": "3.x"),
// a Swagger spec ("swagger": "2.0", converted), a Postman collection ("info" +
// "item"), a Postman environment ("values" + a name or the scope marker), a v1
// collection (rejected with an explanation) or anything else (ErrNotSupported).
func Sniff(data []byte) (FileInfo, error) {
	tree, err := decodeTree(data)
	if err != nil {
		return FileInfo{}, err
	}
	root, ok := tree.(*omap)
	if !ok {
		return FileInfo{}, ErrNotSupported
	}
	if root.has("openapi") || root.has("swagger") {
		plan, err := PlanOpenAPI(data, "", nil, nil)
		if err != nil {
			return FileInfo{}, err
		}
		return FileInfo{Kind: KindOpenAPI, Name: plan.Report.Name, Format: plan.Report.Format, Folders: len(plan.Root.Folders),
			Requests: countRequests(plan.Root), Servers: len(plan.Environments)}, nil
	}
	if data, err = treeJSON(root); err != nil {
		return FileInfo{}, err
	}
	hasInfo, hasItem, hasValues := root.has("info"), root.has("item"), root.has("values")
	hasRequests, hasOrder := root.has("requests"), root.has("order")
	switch {
	case hasInfo && hasItem:
		c, err := parseCollection(data)
		if err != nil {
			return FileInfo{}, err
		}
		folders, requests := countItems(c.Item)
		return FileInfo{Kind: KindCollection, Name: c.Info.Name, Format: c.format, Folders: folders, Requests: requests}, nil
	case hasRequests && (hasOrder || root.has("folders")):
		return FileInfo{}, ErrCollectionV1
	case hasValues && (root.has("name") || root.has("_postman_variable_scope")):
		e, err := parseEnvironment(data)
		if err != nil {
			return FileInfo{}, err
		}
		format := "Environment"
		if e.Scope == "globals" {
			format = "Globals"
		}
		return FileInfo{Kind: KindEnvironment, Name: e.Name, Format: format, Variables: len(e.Values)}, nil
	}
	return FileInfo{}, ErrNotSupported
}

func countRequests(f *FolderPlan) int {
	n := len(f.Requests)
	for _, sub := range f.Folders {
		n += countRequests(sub)
	}
	return n
}

// asJSON turns a YAML document into JSON (a JSON one is returned as is), so the
// Postman readers accept YAML files too.
func asJSON(data []byte) ([]byte, error) {
	trimmed := bytes.TrimLeft(bytes.TrimPrefix(data, []byte("\xef\xbb\xbf")), " \t\r\n")
	if len(trimmed) > 0 && (trimmed[0] == '{' || trimmed[0] == '[') {
		return data, nil
	}
	tree, err := decodeYAMLTree(data)
	if err != nil {
		return nil, err
	}
	return treeJSON(tree)
}

func countItems(items []pmItem) (folders, requests int) {
	for _, it := range items {
		if it.isFolder() {
			folders++
			f, r := countItems(*it.Item)
			folders += f
			requests += r
		} else if it.Request != nil {
			requests++
		}
	}
	return folders, requests
}

func jsonProblem(err error) string {
	var se *json.SyntaxError
	if errors.As(err, &se) {
		return "syntax error at byte " + strconv.FormatInt(se.Offset, 10)
	}
	return strings.TrimPrefix(err.Error(), "json: ")
}

// ---- The Postman file model (lenient: v2.0 and v2.1 shapes both decode) ----

type pmCollection struct {
	Info struct {
		Name        string          `json:"name"`
		Schema      string          `json:"schema"`
		Description json.RawMessage `json:"description"`
	} `json:"info"`
	Item     []pmItem        `json:"item"`
	Auth     json.RawMessage `json:"auth"`
	Event    []pmEvent       `json:"event"`
	Variable []pmKV          `json:"variable"`

	format string // "Collection v2.1" | "Collection v2.0"
}

type pmItem struct {
	Name                    string                     `json:"name"`
	Item                    *[]pmItem                  `json:"item"` // present (even empty) = a folder
	Request                 json.RawMessage            `json:"request"`
	Auth                    json.RawMessage            `json:"auth"` // folders (requests carry it in request)
	Event                   []pmEvent                  `json:"event"`
	Description             json.RawMessage            `json:"description"`
	Response                []json.RawMessage          `json:"response"`
	Variable                []pmKV                     `json:"variable"`
	ProtocolProfileBehavior map[string]json.RawMessage `json:"protocolProfileBehavior"`
}

func (it pmItem) isFolder() bool { return it.Item != nil }

type pmRequest struct {
	Method      string          `json:"method"`
	Header      json.RawMessage `json:"header"` // an array of rows, or (v2.0) one "K: v\n" string
	Body        *pmBody         `json:"body"`
	URL         json.RawMessage `json:"url"` // a string, or an object
	Auth        json.RawMessage `json:"auth"`
	Description json.RawMessage `json:"description"`
}

type pmURL struct {
	Raw      string          `json:"raw"`
	Protocol string          `json:"protocol"`
	Host     json.RawMessage `json:"host"` // string or []string
	Port     string          `json:"port"`
	Path     json.RawMessage `json:"path"` // string, []string or [{value}]
	Query    *[]pmKV         `json:"query"`
	Hash     string          `json:"hash"`
	Variable []pmKV          `json:"variable"`
}

type pmBody struct {
	Mode       string  `json:"mode"`
	Raw        string  `json:"raw"`
	URLEncoded []pmKV  `json:"urlencoded"`
	FormData   []pmKV  `json:"formdata"`
	GraphQL    *pmGQL  `json:"graphql"`
	Disabled   bool    `json:"disabled"`
	Options    pmBodyO `json:"options"`
}

type pmBodyO struct {
	Raw struct {
		Language string `json:"language"`
	} `json:"raw"`
}

type pmGQL struct {
	Query     flexString `json:"query"`
	Variables flexString `json:"variables"`
}

// pmKV is a Postman key/value row (headers, query, form fields, variables).
type pmKV struct {
	Key      flexString      `json:"key"`
	Value    flexString      `json:"value"`
	Disabled bool            `json:"disabled"`
	Enabled  *bool           `json:"enabled"` // environments use "enabled"
	Type     string          `json:"type"`    // form-data: "text" | "file"; env: "default" | "secret"
	Src      json.RawMessage `json:"src"`
}

type pmEvent struct {
	Listen string `json:"listen"` // "prerequest" | "test"
	Script struct {
		Exec json.RawMessage `json:"exec"` // []string or string
	} `json:"script"`
	Disabled bool `json:"disabled"`
}

type pmEnvironment struct {
	Name   string `json:"name"`
	Values []pmKV `json:"values"`
	Scope  string `json:"_postman_variable_scope"`
}

// flexString decodes a JSON string verbatim, and numbers / booleans as their JSON
// text (Postman files carry e.g. "value": 42). null and absent are "".
type flexString string

func (f *flexString) UnmarshalJSON(b []byte) error {
	var s string
	if err := json.Unmarshal(b, &s); err == nil {
		*f = flexString(s)
		return nil
	}
	if string(b) == "null" {
		*f = ""
		return nil
	}
	*f = flexString(bytes.TrimSpace(b))
	return nil
}

func parseCollection(data []byte) (*pmCollection, error) {
	data, err := asJSON(data)
	if err != nil {
		return nil, err
	}
	var c pmCollection
	if err := json.Unmarshal(bytes.TrimPrefix(data, []byte("\xef\xbb\xbf")), &c); err != nil {
		return nil, errors.New("the collection could not be read (" + jsonProblem(err) + ")")
	}
	schema := strings.ToLower(c.Info.Schema)
	switch {
	case strings.Contains(schema, "v1."):
		return nil, ErrCollectionV1
	case strings.Contains(schema, "v2.0"):
		c.format = "Collection v2.0"
	default: // v2.1, or no schema at all: the v2.1 reader accepts both shapes
		c.format = "Collection v2.1"
	}
	return &c, nil
}

func parseEnvironment(data []byte) (*pmEnvironment, error) {
	data, err := asJSON(data)
	if err != nil {
		return nil, err
	}
	var e pmEnvironment
	if err := json.Unmarshal(bytes.TrimPrefix(data, []byte("\xef\xbb\xbf")), &e); err != nil {
		return nil, errors.New("the environment could not be read (" + jsonProblem(err) + ")")
	}
	return &e, nil
}

// text reads a Postman description / script field: a string, a list of lines,
// or a {"content": ...} object.
func text(raw json.RawMessage) string {
	if len(raw) == 0 || string(raw) == "null" {
		return ""
	}
	var s string
	if json.Unmarshal(raw, &s) == nil {
		return s
	}
	var lines []string
	if json.Unmarshal(raw, &lines) == nil {
		return strings.Join(lines, "\n")
	}
	var obj struct {
		Content string `json:"content"`
	}
	if json.Unmarshal(raw, &obj) == nil {
		return obj.Content
	}
	return ""
}

// strList reads a field that is a string or a list of strings / {value} objects.
func strList(raw json.RawMessage) ([]string, bool) {
	if len(raw) == 0 || string(raw) == "null" {
		return nil, false
	}
	var s string
	if json.Unmarshal(raw, &s) == nil {
		return []string{s}, true
	}
	var list []json.RawMessage
	if json.Unmarshal(raw, &list) != nil {
		return nil, false
	}
	out := make([]string, 0, len(list))
	for _, el := range list {
		var v string
		if json.Unmarshal(el, &v) == nil {
			out = append(out, v)
			continue
		}
		var obj struct {
			Value string `json:"value"`
		}
		if json.Unmarshal(el, &obj) == nil {
			out = append(out, obj.Value)
		}
	}
	return out, true
}
