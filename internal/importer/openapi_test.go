package importer

import (
	"context"
	"reflect"
	"sort"
	"strings"
	"testing"

	"gopkg.in/yaml.v3"

	"ghostman/internal/api"
)

func storePlan(t *testing.T, roots, envs []string) *CollectionPlan {
	t.Helper()
	p, err := PlanOpenAPI(fixture(t, "store.openapi.yaml"), "store.yaml", roots, envs)
	if err != nil {
		t.Fatal(err)
	}
	return p
}

func TestSniffRoutesEveryKind(t *testing.T) {
	cases := []struct {
		file, kind, format string
		folders, requests  int
	}{
		{"store.openapi.yaml", KindOpenAPI, "OpenAPI 3.1.0", 3, 14},
		{"minimal.openapi.json", KindOpenAPI, "OpenAPI 3.0.3", 0, 2},
		{"petstore.swagger.json", KindOpenAPI, "Swagger 2.0", 3, 8},
		{"shop.postman_collection.json", KindCollection, "Collection v2.1", 6, 21},
		{"prod.postman_environment.json", KindEnvironment, "Environment", 0, 0},
	}
	for _, c := range cases {
		info, err := Sniff(fixture(t, c.file))
		if err != nil || info.Kind != c.kind || info.Format != c.format || info.Folders != c.folders || info.Requests != c.requests {
			t.Fatalf("%s: %+v %v", c.file, info, err)
		}
	}
	if info, _ := Sniff(fixture(t, "store.openapi.yaml")); info.Servers != 3 || info.Name != "Pet Store" {
		t.Fatalf("servers %+v", info)
	}
	// YAML round trip: a Postman collection written as YAML routes and maps the same.
	var generic any
	_ = yaml.Unmarshal(fixture(t, "shop.postman_collection.json"), &generic)
	asYAML, _ := yaml.Marshal(generic)
	info, err := Sniff(asYAML)
	if err != nil || info.Kind != KindCollection || info.Requests != 21 {
		t.Fatalf("YAML collection: %+v %v", info, err)
	}
	fromYAML, _ := PlanCollection(asYAML, "shop.yaml", nil)
	fromJSON := shopPlan(t)
	if !reflect.DeepEqual(allRequests(fromYAML.Root, nil)["Shop API / Orders / Create order"].Draft,
		allRequests(fromJSON.Root, nil)["Shop API / Orders / Create order"].Draft) {
		t.Fatal("YAML and JSON map differently")
	}
	for _, bad := range []struct{ doc, want string }{
		{`{"openapi": "2.5.0"}`, "OpenAPI 2.5.0, which is not supported"},
		{`{"swagger": "1.2"}`, "Swagger 1.2, which is not supported"},
		{"openapi: [unclosed", "neither valid JSON nor valid YAML"},
		{`{"asyncapi": "2.6.0"}`, "OpenAPI spec"},
	} {
		if _, err := Sniff([]byte(bad.doc)); err == nil || !strings.Contains(err.Error(), bad.want) {
			t.Fatalf("%s: %v", bad.doc, err)
		}
	}
}

func TestOpenAPITreeAndRequests(t *testing.T) {
	p := storePlan(t, nil, nil)
	var b strings.Builder
	shape(p.Root, 0, &b)
	want := `[Pet Store]
  [Pets]
    GET List pets
    POST createPet
    GET GET /pets/{petId}
    DELETE Delete a pet
    POST Upload a photo
  [Store]
    POST Place an order
    POST Send feedback
    PUT Replace the inventory list
    PUT Deeply nested document
  [Admin]
    GET Statistics
    GET Session info
    GET Needs two credentials
    GET This report operation has an extraordinarily long summary that keeps going well past the one hundre…
  GET Health check
`
	if b.String() != want {
		t.Fatalf("tree:\n%s\nwant:\n%s", b.String(), want)
	}
	reqs := allRequests(p.Root, nil)
	get := func(path string) api.RequestDraft {
		t.Helper()
		r := reqs["Pet Store / "+path]
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
	list := get("Pets / List pets")
	eq("required → enabled, optional → disabled; values from default / enum / example", list.QueryParams,
		[]api.KeyValue{row("limit", "20", false), row("status", "available", true)})
	eq("header param (Accept ignored, cookie dropped)", list.Headers, []api.KeyValue{row("X-Request-Id", "req-123", false)})
	eq("url", list.URL, "{{BASE_URL}}/pets")

	one := get("Pets / GET /pets/{petId}")
	eq("path params → {{vars}}", one.URL, "{{BASE_URL}}/pets/{{petId}}")
	eq("operation param wins over the path-level one", one.QueryParams, []api.KeyValue{row("verbose", "true", true)})
	eq("path-level param applies", get("Pets / Delete a pet").QueryParams, []api.KeyValue{row("verbose", "false", false)})

	create := get("Pets / createPet")
	eq("synthesized body", create.Body.Content, `{
  "name": "Rex",
  "status": "available",
  "weight": 0,
  "vaccinated": false,
  "category": {
    "name": "",
    "slug": "dogs"
  },
  "tags": [
    {
      "label": ""
    }
  ],
  "parent": null,
  "owner": null
}`)
	eq("json picked over xml", create.Body.ContentType, "application/json")
	order := get("Store / Place an order")
	eq("media example verbatim, {{vars}} kept", order.Body.Content, "{\n  \"petId\": \"{{petId}}\",\n  \"quantity\": 2,\n  \"note\": \"deliver after 5pm\"\n}")
	eq("operation security → per-request api key in query", [3]string{order.Auth.Type, order.Auth.APIKeyName, order.Auth.APIKeyIn},
		[3]string{api.AuthAPIKey, "api_key", api.APIKeyInQuery})
	eq("urlencoded form, required enabled", get("Store / Send feedback").Body,
		api.RequestBody{Type: api.BodyForm, Fields: []api.KeyValue{row("rating", "5", true), row("comment", "", false)}})
	eq("multipart text fields, file dropped", get("Pets / Upload a photo").Body.Fields,
		[]api.KeyValue{row("caption", "On the sofa", true), row("album", "", false)})
	inv := get("Store / Replace the inventory list").Body
	eq("other content type → raw with its mime", [2]string{inv.ContentType, inv.Content}, [2]string{"text/plain", "dog=3\ncat=5"})
	if !strings.Contains(get("Store / Deeply nested document").Body.Content, `"l9": {`+"\n"+strings.Repeat("  ", 9)+`"l10": null`) {
		t.Fatalf("depth cap:\n%s", get("Store / Deeply nested document").Body.Content)
	}
	eq("root auth bearer {{TOKEN}}", [2]string{p.Root.Auth.Type, p.Root.Auth.BearerToken}, [2]string{api.AuthBearer, "{{TOKEN}}"})
	eq("security [] → none", get("Health check").Auth.Type, api.AuthNone)
	eq("oauth2 operation → inherit", get("Admin / Statistics").Auth.Type, api.AuthInherit)
	eq("cookie api key → inherit", get("Admin / Session info").Auth.Type, api.AuthInherit)
	eq("same as global → inherit (no override)", get("Pets / List pets").Auth.Type, api.AuthInherit)
	if p.Items != 17 {
		t.Fatalf("items %d", p.Items)
	}
}

func TestOpenAPIReportEntries(t *testing.T) {
	r := storePlan(t, nil, nil).Report
	want := []string{
		"|" + CodeDescriptions, "|" + CodeOAAltContent, "|" + CodeOADepthCap, "|" + CodeOARefBroken, "|" + CodeOARefCycle,
		"|" + CodeOASynthesized,
		"Env 'Local proxy'|" + CodeOAServerRelative,
		"Env 'staging.example.com'|" + CodeOAServerVar,
		"Pet Store / Admin / Needs two credentials|" + CodeOAAuthCombined,
		"Pet Store / Admin / Session info|" + CodeOAAuthCookie,
		"Pet Store / Admin / Session info|" + CodeOAOpSecurity,
		"Pet Store / Admin / Statistics|" + CodeAuthUnsupported,
		"Pet Store / Admin / Statistics|" + CodeOAOpSecurity,
		"Pet Store / Admin / This report operation has an extraordinarily long summary that keeps going well past the one hundre…|" + CodeOANameLong,
		"Pet Store / Pets / Delete a pet|" + CodeOADeprecated,
		"Pet Store / Pets / Delete a pet|" + CodeOAPathParams,
		"Pet Store / Pets / GET /pets/{petId}|" + CodeOAPathParams,
		"Pet Store / Pets / List pets|" + CodeOACookieParams,
		"Pet Store / Pets / Trace a pet|" + CodeOATrace,
		"Pet Store / Pets / Upload a photo|" + CodeBodyFormFile,
		"Pet Store / Pets / Upload a photo|" + CodeBodyMultipart,
		"Pet Store / Pets / Upload a photo|" + CodeOAPathParams,
		"Pet Store / Store / Place an order|" + CodeOAAuthSet,
		"Pet Store / Store / Replace the inventory list|" + CodeOABodyOther,
		"Pet Store|" + CodeOAAuthSet,
	}
	sort.Strings(want)
	if got := codesByPath(r); !reflect.DeepEqual(got, want) {
		t.Fatalf("entries:\n%s\nwant:\n%s", strings.Join(got, "\n"), strings.Join(want, "\n"))
	}
	byCode := map[string]Entry{}
	for _, e := range entries(r) {
		byCode[e.Path+"|"+e.Code] = e
	}
	if e := byCode["|"+CodeOASynthesized]; e.Message != "2 request bodies generated from schemas (the spec gave no example) — review before sending." ||
		e.Detail != "Pet Store / Pets / createPet\nPet Store / Store / Deeply nested document" {
		t.Fatalf("synth: %+v", e)
	}
	if e := byCode["|"+CodeOARefCycle]; !strings.Contains(e.Message, "'#/components/schemas/Pet' refers to itself") {
		t.Fatalf("cycle: %+v", e)
	}
	if e := byCode["Pet Store / Pets / GET /pets/{petId}|"+CodeOAPathParams]; e.Message !=
		"path parameter '{petId}' converted to the Ghostman variable {{petId}}." || e.Action != "Define it in an environment or replace it inline." {
		t.Fatalf("path params: %+v", e)
	}
	if e := byCode["Pet Store / Admin / Statistics|"+CodeAuthUnsupported]; !strings.Contains(e.Message, "OAuth 2.0 (clientCredentials flow)") {
		t.Fatalf("oauth: %+v", e)
	}
	if e := byCode["Pet Store|"+CodeOAAuthSet]; !strings.Contains(e.Action, "Set your token") {
		t.Fatalf("token: %+v", e)
	}
	if len(r.Notes) != 1 || !strings.Contains(r.Notes[0], "imported disabled") {
		t.Fatalf("notes %q (the optional-parameters rule appears ONCE)", r.Notes)
	}
}

func TestServersToEnvironments(t *testing.T) {
	envs := storePlan(t, nil, []string{"Production"}).Environments
	got := make([]string, len(envs))
	for i, e := range envs {
		got[i] = e.Name + " = " + e.BaseURL
	}
	want := []string{"Production (2) = https://eu.example.com/v1", "staging.example.com = https://staging.example.com/{version}",
		"Local proxy = /relative"}
	if !reflect.DeepEqual(got, want) {
		t.Fatalf("envs %q", got)
	}
	// The server compares names case-insensitively: an existing "production" takes "Production".
	if envs := storePlan(t, nil, []string{"production"}).Environments; envs[0].Name != "Production (2)" {
		t.Fatalf("case-insensitive dedupe: %q", envs[0].Name)
	}
	// Two servers with the same description dedupe against each other too.
	two := `{"openapi": "3.0.0", "info": {"title": "T"}, "paths": {}, "servers": [
	  {"url": "https://a.example.com/", "description": "Dev"}, {"url": "https://b.example.com", "description": "Dev"}]}`
	p, err := PlanOpenAPI([]byte(two), "t.json", nil, nil)
	if err != nil || p.Environments[0].Name != "Dev" || p.Environments[1].Name != "Dev (2)" || p.Environments[0].BaseURL != "https://a.example.com" {
		t.Fatalf("%+v %v", p.Environments, err)
	}
	// No servers: no environment, one entry telling the user to create BASE_URL.
	m, _ := PlanOpenAPI(fixture(t, "minimal.openapi.json"), "m.json", nil, nil)
	if len(m.Environments) != 0 || len(m.Report.Changed) != 2 || m.Report.Changed[1].Code != CodeOANoServers {
		t.Fatalf("%+v", m.Report.Changed)
	}
	// Name fallback: summary → operationId → "METHOD /path"; examples via $ref.
	reqs := allRequests(m.Root, nil)
	if reqs["Minimal / GET /ping"] == nil || reqs["Minimal / createThing"].Draft.Body.Content != "{\n  \"name\": \"lamp\",\n  \"watts\": 40\n}" {
		t.Fatalf("minimal: %v", reqs)
	}
}

func TestSwaggerConversion(t *testing.T) {
	p, err := PlanOpenAPI(fixture(t, "petstore.swagger.json"), "petstore.json", nil, nil)
	if err != nil {
		t.Fatal(err)
	}
	if p.Report.Format != "Swagger 2.0" || p.Report.Notes[0] != "Converted from Swagger 2.0 before import." {
		t.Fatalf("%q %q", p.Report.Format, p.Report.Notes)
	}
	// host + basePath + schemes → ONE environment named from the host.
	if len(p.Environments) != 1 || p.Environments[0].Name != "petstore.swagger.io" || p.Environments[0].BaseURL != "https://petstore.swagger.io/v2" {
		t.Fatalf("envs %+v", p.Environments[0])
	}
	var b strings.Builder
	shape(p.Root, 0, &b)
	want := `[Swagger Petstore]
  [pet]
    POST uploads an image
    POST Add a new pet to the store
    PUT Update an existing pet
    GET Finds Pets by status
    GET Find pet by ID
    POST Updates a pet in the store with form data
  [store]
    POST Place an order for a pet
  [user]
    GET Logs user into the system
`
	if b.String() != want {
		t.Fatalf("spec order lost:\n%s", b.String())
	}
	reqs := allRequests(p.Root, nil)
	form := reqs["Swagger Petstore / pet / Updates a pet in the store with form data"].Draft.Body
	if form.Type != api.BodyForm || !reflect.DeepEqual(form.Fields, []api.KeyValue{{Key: "name", Value: "", Enabled: false},
		{Key: "status", Value: "", Enabled: true}}) {
		t.Fatalf("formData → urlencoded body: %+v", form)
	}
	if q := reqs["Swagger Petstore / pet / Finds Pets by status"].Draft.QueryParams; q[0].Value != "available" {
		t.Fatalf("array param value: %+v", q)
	}
	codes := codesByPath(p.Report)
	for _, want := range []string{"Swagger Petstore / pet / uploads an image|" + CodeBodyFormFile, "Swagger Petstore|" + CodeOASchemes,
		"Swagger Petstore / store / Place an order for a pet|" + CodeOABodyOther} {
		if !contains(codes, want) {
			t.Fatalf("missing %s in %v", want, codes)
		}
	}
}

func contains(xs []string, x string) bool {
	for _, e := range xs {
		if e == x {
			return true
		}
	}
	return false
}

func TestBrokenSwaggerCreatesNothing(t *testing.T) {
	broken := `{"swagger": "2.0", "info": {"title": "Bad", "version": "1"}, "host": "api.example.com/v1", "paths": {}}`
	if _, err := Sniff([]byte(broken)); err == nil || !strings.Contains(err.Error(), "could not be converted to OpenAPI 3") ||
		!strings.Contains(err.Error(), "invalid host") {
		t.Fatalf("sniff: %v", err)
	}
	f, c := newFake(t)
	rep, _, err := ImportOpenAPI(context.Background(), c, &fakeVars{values: map[string]string{}}, "p1", "P1", []byte(broken), "bad.json", nil)
	if err == nil || rep != nil || len(f.folders) != 0 || len(f.envs) != 0 {
		t.Fatalf("err %v rep %v folders %d", err, rep, len(f.folders))
	}
}

func TestImportOpenAPIEndToEnd(t *testing.T) {
	f, c := newFake(t)
	vw := &fakeVars{values: map[string]string{}}
	var progress []int
	rep, failure, err := ImportOpenAPI(context.Background(), c, vw, "p1", "P1", fixture(t, "store.openapi.yaml"), "store.yaml",
		func(done, total int) { progress = append(progress, done, total) })
	if err != nil || failure != nil {
		t.Fatal(err, failure)
	}
	want := `[Pet Store] auth=bearer
  [Pets]
    GET List pets
    POST createPet
    GET GET /pets/{petId}
    DELETE Delete a pet
    POST Upload a photo
  [Store]
    POST Place an order
    POST Send feedback
    PUT Replace the inventory list
    PUT Deeply nested document
  [Admin]
    GET Statistics
    GET Session info
    GET Needs two credentials
    GET This report operation has an extraordinarily long summary that keeps going well past the one hundre…
  GET Health check
`
	if got := f.tree(); got != want {
		t.Fatalf("server tree:\n%s", got)
	}
	var envNames []string
	for _, e := range f.envs {
		envNames = append(envNames, e["name"].(string))
	}
	if strings.Join(envNames, "|") != "Production|staging.example.com|Local proxy" ||
		strings.Join(vw.created, ",") != "BASE_URL:regular,BASE_URL:regular,BASE_URL:regular" {
		t.Fatalf("envs %v vars %v", envNames, vw.created)
	}
	if rep.Summary != (Summary{Folders: 4, Requests: 14, Environments: 3, Variables: 3}) || rep.Kind != KindOpenAPI {
		t.Fatalf("summary %+v", rep.Summary)
	}
	last := rep.Notes[len(rep.Notes)-1]
	if last != "Created environments 'Production', 'staging.example.com', 'Local proxy' — activate one to resolve {{BASE_URL}}." {
		t.Fatalf("notes %q", rep.Notes)
	}
	if n := len(progress); progress[n-2] != 20 || progress[n-1] != 20 {
		t.Fatalf("progress %v", progress[n-2:])
	}
	for _, s := range []string{"API spec \"Pet Store\" (OpenAPI 3.1.0", "Note: Optional query", "TRACE operation not imported",
		"schema '#/components/schemas/Pet' refers to itself", "Pet Store / Pets / createPet"} {
		if !strings.Contains(rep.Text, s) {
			t.Fatalf("report text lacks %q", s)
		}
	}
	// Again: "(2)" folder AND "(2)" environments, nothing merged.
	rep2, _, _ := ImportOpenAPI(context.Background(), c, &fakeVars{values: map[string]string{}}, "p1", "P1",
		fixture(t, "store.openapi.yaml"), "store.yaml", nil)
	if rep2.Target != "P1 / Pet Store (2)" || !strings.Contains(rep2.Notes[len(rep2.Notes)-1], "'Production (2)', 'staging.example.com (2)', 'Local proxy (2)'") {
		t.Fatalf("%q %q", rep2.Target, rep2.Notes)
	}
}
