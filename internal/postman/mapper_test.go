package postman

import (
	"encoding/json"
	"errors"
	"os"
	"reflect"
	"slices"
	"sort"
	"strings"
	"testing"

	"ghostman/internal/api"
)

func fixture(t *testing.T, name string) []byte {
	t.Helper()
	b, err := os.ReadFile("testdata/" + name)
	if err != nil {
		t.Fatal(err)
	}
	return b
}

func shopPlan(t *testing.T, roots ...string) *CollectionPlan {
	t.Helper()
	p, err := PlanCollection(fixture(t, "shop.postman_collection.json"), "shop.json", roots)
	if err != nil {
		t.Fatal(err)
	}
	return p
}

// allRequests flattens a plan by path.
func allRequests(f *FolderPlan, out map[string]*RequestPlan) map[string]*RequestPlan {
	if out == nil {
		out = map[string]*RequestPlan{}
	}
	for _, r := range f.Requests {
		out[r.Path] = r
	}
	for _, sub := range f.Folders {
		allRequests(sub, out)
	}
	return out
}

func shape(f *FolderPlan, depth int, b *strings.Builder) {
	b.WriteString(strings.Repeat("  ", depth) + "[" + f.Name + "]\n")
	for _, sub := range f.Folders {
		shape(sub, depth+1, b)
	}
	for _, r := range f.Requests {
		b.WriteString(strings.Repeat("  ", depth+1) + r.Draft.Method + " " + r.Name + "\n")
	}
}

func entries(r *Report) []Entry {
	var all []Entry
	for _, s := range [][]Entry{r.Imported, r.Changed, r.Dropped, r.Failed} {
		all = append(all, s...)
	}
	return all
}

// codesByPath: "path|code" for every mapping entry.
func codesByPath(r *Report) []string {
	var out []string
	for _, e := range entries(r) {
		out = append(out, e.Path+"|"+e.Code)
	}
	sort.Strings(out)
	return out
}

func TestSniff(t *testing.T) {
	info, err := Sniff(fixture(t, "shop.postman_collection.json"))
	if err != nil || info.Kind != KindCollection || info.Name != "Shop API" || info.Format != "Collection v2.1" ||
		info.Folders != 6 || info.Requests != 21 {
		t.Fatalf("shop: %+v %v", info, err)
	}
	info, err = Sniff(fixture(t, "legacy_v20.postman_collection.json"))
	if err != nil || info.Format != "Collection v2.0" {
		t.Fatalf("v2.0: %+v %v", info, err)
	}
	info, err = Sniff(fixture(t, "prod.postman_environment.json"))
	if err != nil || info.Kind != KindEnvironment || info.Name != "prod" || info.Variables != 8 {
		t.Fatalf("env: %+v %v", info, err)
	}
	if _, err := Sniff(fixture(t, "v1.postman_collection.json")); !errors.Is(err, ErrCollectionV1) {
		t.Fatalf("v1: %v", err)
	}
	if _, err := Sniff([]byte(`{"openapi": "3.0.0", "paths": {}}`)); !errors.Is(err, ErrNotPostman) {
		t.Fatalf("other JSON: %v", err)
	}
	if _, err := Sniff([]byte(`{"info": `)); err == nil || !strings.Contains(err.Error(), "not valid JSON") {
		t.Fatalf("broken JSON: %v", err)
	}
	if !strings.Contains(ErrNotPostman.Error(), "collection") || !strings.Contains(ErrNotPostman.Error(), "environment") {
		t.Fatal("the error must name both supported kinds")
	}
	// A v2.1-shaped file that declares a v1 schema is rejected too.
	if _, err := Sniff([]byte(`{"info": {"name": "x", "schema": "https://schema.getpostman.com/json/collection/v1.0.0/"}, "item": []}`)); !errors.Is(err, ErrCollectionV1) {
		t.Fatalf("v1 schema: %v", err)
	}
}

func TestCollectionTreeShape(t *testing.T) {
	p := shopPlan(t)
	var b strings.Builder
	shape(p.Root, 0, &b)
	want := `[Shop API]
  [Orders]
    [Archive]
      [Old]
        GET Get old
    POST Create order
    GET Export
  [Admin]
    DELETE Purge cache
  [Users]
    GET Get user
    POST Login
    GET Key in query
    GET Key in cookie
    GET Public
    GET Signed
  [Bodies]
    POST Search
    POST Upload avatar
    POST XML by header
    POST Plain
    PUT Binary
    POST Odd mode
    POST Muted body
    GET No redirects
  GET Ping
  GET Bare string
  GET Untitled request
`
	if b.String() != want {
		t.Fatalf("tree:\n%s\nwant:\n%s", b.String(), want)
	}
	if p.Items != 27 {
		t.Fatalf("items = %d", p.Items)
	}
}

func TestRequestMapping(t *testing.T) {
	p := shopPlan(t)
	reqs := allRequests(p.Root, nil)
	get := func(path string) api.RequestDraft {
		t.Helper()
		r := reqs["Shop API / "+path]
		if r == nil {
			t.Fatalf("no request %q", path)
		}
		return r.Draft
	}
	row := func(k, v string, on bool) api.KeyValue { return api.KeyValue{Key: k, Value: v, Enabled: on} }
	eq := func(name string, got, want any) {
		t.Helper()
		if !reflect.DeepEqual(got, want) {
			t.Fatalf("%s:\n got %#v\nwant %#v", name, got, want)
		}
	}

	co := get("Orders / Create order")
	eq("create url", co.URL, "{{baseUrl}}/post")
	eq("create query", co.QueryParams, []api.KeyValue{row("source", "postman", true), row("debug", "1", false)})
	eq("create headers", co.Headers, []api.KeyValue{row("X-Trace", "{{trace}}", true), row("X-Debug", "1", false)})
	eq("create body type", co.Body.ContentType, "application/json")
	eq("create auth", co.Auth.Type, api.AuthInherit)

	old := get("Orders / Archive / Old / Get old")
	eq("assembled url", old.URL, "https://api.example.com:8443/orders/old")
	eq("assembled query", old.QueryParams, []api.KeyValue{row("page", "{{page}}", true), row("all", "", true)})

	eq("path var kept", get("Users / Get user").URL, "{{baseUrl}}/users/:id/posts")
	login := get("Users / Login")
	eq("basic", [3]string{login.Auth.Type, login.Auth.BasicUsername, login.Auth.BasicPassword},
		[3]string{api.AuthBasic, "{{user}}", "{{pass}}"})
	eq("urlencoded", login.Body, api.RequestBody{Type: api.BodyForm, Fields: []api.KeyValue{row("remember", "true", true), row("otp", "", false)}})
	q := get("Users / Key in query").Auth
	eq("apikey query", [4]string{q.Type, q.APIKeyName, q.APIKeyValue, q.APIKeyIn}, [4]string{api.AuthAPIKey, "api_key", "{{apiKey}}", api.APIKeyInQuery})
	eq("apikey cookie → header", get("Users / Key in cookie").Auth.APIKeyIn, api.APIKeyInHeader)
	eq("noauth", get("Users / Public").Auth.Type, api.AuthNone)
	eq("awsv4 → inherit", get("Users / Signed").Auth.Type, api.AuthInherit)

	eq("graphql", get("Bodies / Search").Body, api.RequestBody{Type: api.BodyRaw, ContentType: "application/json",
		Content: "{\n  \"query\": \"query Q($n: Int) { items(first: $n) { id } }\",\n  \"variables\": {\n    \"n\": {{limit}}\n  }\n}",
		Fields:  []api.KeyValue{}})
	eq("formdata text fields", get("Bodies / Upload avatar").Body.Fields, []api.KeyValue{row("user", "{{userId}}", true)})
	eq("type from header", get("Bodies / XML by header").Body.ContentType, "application/xml")
	eq("default type", get("Bodies / Plain").Body.ContentType, "text/plain")
	eq("binary → none", get("Bodies / Binary").Body.Type, api.BodyNone)
	eq("odd → none", get("Bodies / Odd mode").Body.Type, api.BodyNone)
	eq("muted → none", get("Bodies / Muted body").Body.Type, api.BodyNone)
	eq("follow off", reqs["Shop API / Bodies / No redirects"].Follow, api.SettingOff)
	eq("bare string", get("Bare string"), api.RequestDraft{Method: "GET", URL: "https://example.com/plain",
		Headers: []api.KeyValue{}, QueryParams: []api.KeyValue{}, Body: api.RequestBody{Type: api.BodyNone, Fields: []api.KeyValue{}},
		Auth: api.Auth{Type: api.AuthInherit, APIKeyIn: api.APIKeyInHeader}})
	eq("fragment stripped", get("Ping").URL, "{{baseUrl}}/get")

	// Collection auth lands on the root folder; the cascade does the rest.
	eq("root auth", [2]string{p.Root.Auth.Type, p.Root.Auth.BearerToken}, [2]string{api.AuthBearer, "{{token}}"})
	eq("oauth2 folder → inherit", p.Root.Folders[1].Auth.Type, api.AuthInherit)
}

// {{vars}} pass through byte for byte: the raw body equals the file's string.
func TestVariablesAreByteVerbatim(t *testing.T) {
	var file struct {
		Item []struct {
			Name string `json:"name"`
			Item []struct {
				Name    string `json:"name"`
				Request struct {
					Body struct {
						Raw string `json:"raw"`
					} `json:"body"`
				} `json:"request"`
			} `json:"item"`
		} `json:"item"`
	}
	if err := json.Unmarshal(fixture(t, "shop.postman_collection.json"), &file); err != nil {
		t.Fatal(err)
	}
	raw := file.Item[1].Item[0].Request.Body.Raw
	got := allRequests(shopPlan(t).Root, nil)["Shop API / Orders / Create order"].Draft.Body.Content
	if got != raw || !strings.Contains(got, "{{ spaced }}") || !strings.Contains(got, "{{qty}}") {
		t.Fatalf("body changed:\n%q\n%q", got, raw)
	}
}

func TestCollectionReportEntries(t *testing.T) {
	r := shopPlan(t).Report
	want := []string{
		"|" + CodeDescriptions,
		"|" + CodeExamples,
		"|" + CodeOrderInterleaved,
		"Shop API / Admin / Purge cache|" + CodeScriptOther,
		"Shop API / Admin|" + CodeAuthUnsupported,
		"Shop API / Admin|" + CodeFolderVars,
		"Shop API / Bodies / Binary|" + CodeBodyFile,
		"Shop API / Bodies / Muted body|" + CodeBodyDisabled,
		"Shop API / Bodies / No redirects|" + CodeSettingOther,
		"Shop API / Bodies / Odd mode|" + CodeBodyUnknown,
		"Shop API / Bodies / Search|" + CodeBodyGraphQL,
		"Shop API / Bodies / Upload avatar|" + CodeBodyFormFile,
		"Shop API / Bodies / Upload avatar|" + CodeBodyMultipart,
		"Shop API / Orders / Create order|" + CodeRowKeyless,
		"Shop API / Orders / Create order|" + CodeScriptPreRequest,
		"Shop API / Orders / Create order|" + CodeScriptTest,
		"Shop API / Orders / Export|" + CodeMethodUnsupported,
		"Shop API / Ping|" + CodeURLFragment,
		"Shop API / Placeholder|" + CodeItemEmpty,
		"Shop API / Untitled request|" + CodeNameEmpty,
		"Shop API / Users / Get user|" + CodeURLPathVariable,
		"Shop API / Users / Key in cookie|" + CodeAuthAPIKeyIn,
		"Shop API / Users / Signed|" + CodeAuthUnsupported,
		"Shop API|" + CodeCollectionVars,
		"Shop API|" + CodeScriptPreRequest,
	}
	sort.Strings(want)
	if got := codesByPath(r); !reflect.DeepEqual(got, want) {
		t.Fatalf("entries:\n%s\nwant:\n%s", strings.Join(got, "\n"), strings.Join(want, "\n"))
	}
	find := func(path, code string) Entry {
		for _, e := range entries(r) {
			if e.Path == path && e.Code == code {
				return e
			}
		}
		t.Fatalf("no %s at %s", code, path)
		return Entry{}
	}
	// Wording and preserved texts.
	if e := find("Shop API / Orders / Export", CodeMethodUnsupported); e.Message != "method 'PURGE' is not supported; imported as GET." ||
		e.Action != "Change it manually if needed." || e.Severity != Warning {
		t.Fatalf("PURGE: %+v", e)
	}
	if e := find("Shop API / Admin", CodeAuthUnsupported); e.Message != "Auth on folder 'Admin' was OAuth 2.0, which is not supported yet; set to Inherit." {
		t.Fatalf("oauth2: %+v", e)
	}
	if e := find("Shop API / Users / Get user", CodeURLPathVariable); !strings.Contains(e.Message, "':id'") || !strings.Contains(e.Message, "'42'") {
		t.Fatalf("path var: %+v", e)
	}
	pre := find("Shop API / Orders / Create order", CodeScriptPreRequest)
	if pre.Severity != Dropped || !strings.HasPrefix(pre.Message, "pre-request script (3 lines)") ||
		pre.Detail != "const id = pm.variables.replaceIn('{{$guid}}');\npm.variables.set('orderId', id);\nconsole.log(id);" {
		t.Fatalf("script: %+v", pre)
	}
	if e := find("Shop API / Bodies / Upload avatar", CodeBodyFormFile); !strings.Contains(e.Message, "form field 'file' (type file)") {
		t.Fatalf("file field: %+v", e)
	}
	if e := find("", CodeDescriptions); !strings.HasPrefix(e.Message, "3 item descriptions") {
		t.Fatalf("descriptions: %+v", e)
	}
	if e := find("", CodeExamples); !strings.HasPrefix(e.Message, "2 saved example responses") {
		t.Fatalf("examples: %+v", e)
	}
	if e := find("Shop API", CodeCollectionVars); e.Detail != "baseUrl = https://httpbin.org\nretries = 3" {
		t.Fatalf("collection vars: %+v", e)
	}
	if e := find("Shop API / Orders / Create order", CodeRowKeyless); e.Detail != "orphan-value" {
		t.Fatalf("keyless: %+v", e)
	}
	// The empty test script at the collection level holds no code: no entry.
	for _, e := range entries(r) {
		if e.Path == "Shop API" && e.Code == CodeScriptTest {
			t.Fatal("empty script reported")
		}
	}
}

func TestLegacyV20(t *testing.T) {
	p, err := PlanCollection(fixture(t, "legacy_v20.postman_collection.json"), "legacy.json", nil)
	if err != nil {
		t.Fatal(err)
	}
	if p.Report.Format != "Collection v2.0" {
		t.Fatalf("format %q", p.Report.Format)
	}
	root := p.Root
	if root.Auth.Type != api.AuthBasic || root.Auth.BasicUsername != "{{u}}" || root.Auth.BasicPassword != "{{p}}" {
		t.Fatalf("root auth %+v", root.Auth)
	}
	docs := root.Folders[0]
	if docs.Auth.Type != api.AuthBearer || docs.Auth.BearerToken != "{{docToken}}" {
		t.Fatalf("folder auth %+v", docs.Auth)
	}
	d := docs.Requests[0].Draft
	want := api.RequestDraft{Method: "GET", URL: "{{host}}/docs",
		QueryParams: []api.KeyValue{{Key: "lang", Value: "en", Enabled: true}, {Key: "draft", Value: "", Enabled: true}},
		Headers: []api.KeyValue{{Key: "Accept", Value: "application/json", Enabled: true}, {Key: "X-Old", Value: "1", Enabled: false},
			{Key: "X-Empty", Value: "", Enabled: true}},
		Body: api.RequestBody{Type: api.BodyNone, Fields: []api.KeyValue{}},
		Auth: api.Auth{Type: api.AuthAPIKey, APIKeyName: "X-Key", APIKeyValue: "{{k}}", APIKeyIn: api.APIKeyInHeader}}
	if !reflect.DeepEqual(d, want) {
		t.Fatalf("v2.0 request:\n got %#v\nwant %#v", d, want)
	}
	if n := len(entries(p.Report)); n != 0 {
		t.Fatalf("a clean v2.0 file has no report entries, got %v", codesByPath(p.Report))
	}
}

func TestNameDedupe(t *testing.T) {
	if got := shopPlan(t).Root.Name; got != "Shop API" {
		t.Fatal(got)
	}
	if got := shopPlan(t, "Shop API", "Other").Root.Name; got != "Shop API (2)" {
		t.Fatal(got)
	}
	if got := shopPlan(t, "Shop API", "Shop API (2)").Root.Name; got != "Shop API (3)" {
		t.Fatal(got)
	}
	// Report paths keep the file's names; only the created folder is renamed.
	if p := shopPlan(t, "Shop API"); p.Root.Path != "Shop API" {
		t.Fatal(p.Root.Path)
	}
}

func TestEnvironmentPlan(t *testing.T) {
	p, err := PlanEnvironment(fixture(t, "prod.postman_environment.json"), "prod.json", []string{"prod"})
	if err != nil {
		t.Fatal(err)
	}
	if p.Name != "prod (2)" {
		t.Fatalf("name %q (collisions never merge)", p.Name)
	}
	want := []VariablePlan{
		{Key: "baseUrl", Value: "https://httpbin.org"},
		{Key: "token", Secret: true},
		{Key: "apiKey", Secret: true},
		{Key: "legacy_url", Value: "https://old.example.com"},
		{Key: "retries", Value: "3"},
		{Key: "templated", Value: "{{baseUrl}}/v2"},
	}
	if !reflect.DeepEqual(p.Variables, want) {
		t.Fatalf("variables:\n got %+v\nwant %+v", p.Variables, want)
	}
	got := codesByPath(p.Report)
	wantCodes := []string{"Env 'prod'|" + CodeEnvDisabled, "Env 'prod'|" + CodeEnvDuplicate, "Env 'prod'|" + CodeEnvKeyless, "Env 'prod'|" + CodeEnvSecret}
	if !reflect.DeepEqual(got, wantCodes) {
		t.Fatalf("env entries %v", got)
	}
	for _, e := range p.Report.Changed {
		switch e.Code {
		case CodeEnvSecret:
			if e.Message != "2 secret variables imported WITHOUT values (Ghostman never syncs secret values)." ||
				e.Action != "Set them in Manage environments → prod (2)." || e.Detail != "token\napiKey" {
				t.Fatalf("secret: %+v", e)
			}
		case CodeEnvDisabled:
			if !strings.Contains(e.Message, "'legacy_url' was disabled in Postman; imported enabled") {
				t.Fatalf("disabled: %+v", e)
			}
		}
	}
	// Secret values never appear anywhere in the report.
	if p.Report.render(); strings.Contains(p.Report.Text, "s3cr3t") || strings.Contains(p.Report.Text, "k-123") {
		t.Fatal("a secret value leaked into the report")
	}
}

// Every fallback code is produced by at least one fixture: no mapping branch can
// deviate without a report entry going untested.
func TestEveryFallbackEmitsAnEntry(t *testing.T) {
	seen := map[string]bool{}
	for _, f := range []string{"shop.postman_collection.json", "legacy_v20.postman_collection.json"} {
		p, err := PlanCollection(fixture(t, f), f, nil)
		if err != nil {
			t.Fatal(err)
		}
		for _, e := range entries(p.Report) {
			seen[e.Code] = true
		}
	}
	for _, f := range []string{"prod.postman_environment.json", "globals.postman_globals.json"} {
		p, err := PlanEnvironment(fixture(t, f), f, nil)
		if err != nil {
			t.Fatal(err)
		}
		for _, e := range entries(p.Report) {
			seen[e.Code] = true
		}
	}
	var missing []string
	for _, c := range FallbackCodes {
		if !seen[c] {
			missing = append(missing, c)
		}
	}
	if len(missing) > 0 {
		t.Fatalf("fallback codes no fixture produces: %v", missing)
	}
	for c := range seen {
		if !slices.Contains(FallbackCodes, c) {
			t.Fatalf("code %q is produced but not listed in FallbackCodes", c)
		}
	}
}
