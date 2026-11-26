package main

import (
	"context"
	"io"
	"net/http"
	"net/http/httptest"
	"regexp"
	"strings"
	"testing"

	"github.com/golang-jwt/jwt/v5"

	"ghostman/internal/api"
)

const secretToken = "sk-live-SECRET-9f8e7d"

// A project with one active environment "dev": BASE_URL (regular) and API_TOKEN
// (secret, its value only on this machine), JWT_SECRET (secret).
func codegenApp(t *testing.T) *App {
	t.Helper()
	a := newTestApp(t, true, map[string]http.HandlerFunc{
		"GET /api/v1/projects/{project_id}/environments": func(w http.ResponseWriter, _ *http.Request) {
			_, _ = w.Write([]byte(`[{"id":"e1","name":"dev","sort_order":0}]`))
		},
		"GET /api/v1/environments/e1/variables": func(w http.ResponseWriter, _ *http.Request) {
			_, _ = w.Write([]byte(`[{"id":"v1","key":"BASE_URL","type":"regular","value":"https://api.example.com","sort_order":0},
				{"id":"v2","key":"API_TOKEN","type":"secret","value":null,"sort_order":1},
				{"id":"v3","key":"JWT_SECRET","type":"secret","value":null,"sort_order":2}]`))
		},
	})
	ctx := context.Background()
	for k, v := range map[string]string{"API_TOKEN": secretToken, "JWT_SECRET": "jwt-signing-key"} {
		if err := a.store.PutSecret(ctx, "e1", k, v); err != nil {
			t.Fatal(err)
		}
	}
	if err := a.store.PutSetting(ctx, "active_env_p1", "e1"); err != nil {
		t.Fatal(err)
	}
	return a
}

func fullDraft() (api.RequestDraft, SendOptions) {
	draft := api.RequestDraft{
		Method: "POST", URL: "{{BASE_URL}}/items",
		Headers:     []api.KeyValue{{Key: "X-Missing", Value: "{{MISSING}}", Enabled: true}},
		QueryParams: []api.KeyValue{{Key: "page", Value: "2", Enabled: true}},
		Body:        api.RequestBody{Type: api.BodyRaw, ContentType: "application/json", Content: `{"q": "it's"}`},
		PreScript:   `gm.request.headers.set("X", "1")`,
	}
	opts := SendOptions{FollowRedirects: false, Auth: &api.Auth{Type: api.AuthBearer, BearerToken: "{{API_TOKEN}}"}}
	return draft, opts
}

func TestGenerateCodeResolvedVsTemplate(t *testing.T) {
	a := codegenApp(t)
	draft, opts := fullDraft()

	r := a.GenerateCode("p1", "r1", draft, opts, CodegenOptions{Target: "curl", Resolved: true})
	if r.Error != nil {
		t.Fatal(r.Error.Message)
	}
	s := r.Data.Snippet
	for _, want := range []string{"https://api.example.com/items?page=2", "Authorization: Bearer " + secretToken, "--max-redirs 0", "--max-time 30",
		"# pre/post scripts are not represented"} {
		if !strings.Contains(s, want) {
			t.Errorf("resolved: missing %q in\n%s", want, s)
		}
	}
	if !r.Data.Secrets {
		t.Error("a snippet carrying a secret value must say so")
	}
	if !hasWarning(r.Data.Warnings, "{{MISSING}} has no value here") || !hasWarning(r.Data.Warnings, "pre/post scripts are not represented") {
		t.Errorf("warnings = %v", r.Data.Warnings)
	}

	tr := a.GenerateCode("p1", "r1", draft, opts, CodegenOptions{Target: "curl", Resolved: false})
	if tr.Error != nil {
		t.Fatal(tr.Error.Message)
	}
	ts := tr.Data.Snippet
	if strings.Contains(ts, secretToken) || tr.Data.Secrets {
		t.Fatalf("a template snippet must not carry the secret:\n%s", ts)
	}
	for _, want := range []string{"'{{BASE_URL}}/items?page=2'", "Authorization: Bearer {{API_TOKEN}}", "X-Missing: {{MISSING}}"} {
		if !strings.Contains(ts, want) {
			t.Errorf("template: missing %q in\n%s", want, ts)
		}
	}
	for _, target := range []string{"fetch", "python", "go"} {
		g := a.GenerateCode("p1", "r1", draft, opts, CodegenOptions{Target: target, Resolved: false})
		if g.Error != nil || strings.Contains(g.Data.Snippet, secretToken) {
			t.Errorf("%s template: %v\n%s", target, g.Error, g.Data.Snippet)
		}
	}
}

// Generated values: template mode keeps the {{$…}} tokens; resolved mode
// generates ONE value per token per snippet. ":id" is plain text (path
// variables are retired: nothing substitutes it).
func TestGenerateCodeDynamicAndPlainColon(t *testing.T) {
	a := codegenApp(t)
	draft := api.RequestDraft{Method: "GET", URL: "{{BASE_URL}}/users/:id/{{$uuid}}",
		Headers: []api.KeyValue{{Key: "X-Id", Value: "{{$uuid}}", Enabled: true}}}
	opts := SendOptions{FollowRedirects: true}
	tr := a.GenerateCode("p1", "r1", draft, opts, CodegenOptions{Target: "curl", Resolved: false})
	if tr.Error != nil || !strings.Contains(tr.Data.Snippet, "'{{BASE_URL}}/users/:id/{{$uuid}}'") || !strings.Contains(tr.Data.Snippet, "X-Id: {{$uuid}}") {
		t.Fatalf("template: %v\n%s", tr.Error, tr.Data.Snippet)
	}
	r := a.GenerateCode("p1", "r1", draft, opts, CodegenOptions{Target: "curl", Resolved: true})
	if r.Error != nil {
		t.Fatal(r.Error.Message)
	}
	m := regexp.MustCompile(`https://api\.example\.com/users/:id/([0-9a-f-]{36})`).FindStringSubmatch(r.Data.Snippet)
	if m == nil || !strings.Contains(r.Data.Snippet, "X-Id: "+m[1]) {
		t.Fatalf("resolved (one $uuid per snippet, :id as typed):\n%s", r.Data.Snippet)
	}
	if len(r.Data.Warnings) != 0 {
		t.Errorf("warnings = %v", r.Data.Warnings)
	}
}

// Template mode never Base64-encodes unresolved Basic credentials (that hid the
// variables: "e3tsb2dpbn19Ont7cGFzc3dvcmR9fQ==" is "{{login}}:{{password}}").
func TestGenerateCodeBasicTemplate(t *testing.T) {
	a := codegenApp(t)
	draft := api.RequestDraft{Method: "GET", URL: "{{BASE_URL}}/me"}
	opts := SendOptions{FollowRedirects: true, Auth: &api.Auth{Type: api.AuthBasic, BasicUsername: "{{login}}", BasicPassword: "{{password}}"}}
	for _, target := range []string{"curl", "fetch", "python", "go"} {
		r := a.GenerateCode("p1", "r1", draft, opts, CodegenOptions{Target: target, Resolved: false})
		if r.Error != nil {
			t.Fatal(r.Error.Message)
		}
		s := r.Data.Snippet
		if !strings.Contains(s, "Basic <base64 of {{login}}:{{password}}>") || strings.Contains(s, "e3tsb2dpbn19Ont7cGFzc3dvcmR9fQ==") {
			t.Errorf("%s template basic:\n%s", target, s)
		}
	}
	// Resolved: the real credentials, encoded as Send sends them.
	opts.Auth = &api.Auth{Type: api.AuthBasic, BasicUsername: "u", BasicPassword: "{{API_TOKEN}}"}
	r := a.GenerateCode("p1", "r1", draft, opts, CodegenOptions{Target: "curl", Resolved: true})
	if r.Error != nil || !strings.Contains(r.Data.Snippet, "Authorization: Basic dTpzay1saXZlLVNFQ1JFVC05ZjhlN2Q=") {
		t.Errorf("resolved basic: %v\n%s", r.Error, r.Data.Snippet)
	}
}

func TestGenerateCodeJWT(t *testing.T) {
	a := codegenApp(t)
	draft := api.RequestDraft{Method: "GET", URL: "{{BASE_URL}}/me"}
	opts := SendOptions{FollowRedirects: true, Auth: &api.Auth{Type: api.AuthJWT, JWTAlgorithm: "HS256", JWTSecret: "{{JWT_SECRET}}",
		JWTPayload: `{"sub":"7","iat":"{{$now}}"}`, JWTAddTo: "header"}}

	r := a.GenerateCode("p1", "r1", draft, opts, CodegenOptions{Target: "python", Resolved: true})
	if r.Error != nil {
		t.Fatal(r.Error.Message)
	}
	s := r.Data.Snippet
	i := strings.Index(s, `"Bearer `)
	if i < 0 {
		t.Fatalf("no token in\n%s", s)
	}
	tok := s[i+len(`"Bearer `):]
	end := strings.Index(tok, `"`)
	if end < 0 {
		t.Fatalf("unterminated token in\n%s", s)
	}
	tok = tok[:end]
	if _, err := jwt.Parse(tok, func(*jwt.Token) (any, error) { return []byte("jwt-signing-key"), nil }); err != nil {
		t.Fatalf("the resolved snippet's token does not verify: %v", err)
	}
	if !r.Data.Secrets || strings.Contains(s, "jwt-signing-key") {
		t.Errorf("secrets flag / the signing key must never appear: %v\n%s", r.Data.Secrets, s)
	}

	tr := a.GenerateCode("p1", "r1", draft, opts, CodegenOptions{Target: "curl", Resolved: false})
	if !strings.Contains(tr.Data.Snippet, "Bearer <signed at send time>") || !strings.Contains(tr.Data.Snippet, "# JWT: <signed at send time>") {
		t.Errorf("template JWT:\n%s", tr.Data.Snippet)
	}

	// A secret without a value: Send would refuse; the snippet says why and keeps a placeholder.
	opts.Auth.JWTSecret = "{{NOPE}}"
	w := a.GenerateCode("p1", "r1", draft, opts, CodegenOptions{Target: "curl", Resolved: true})
	if w.Error != nil || !strings.Contains(w.Data.Snippet, "<signed at send time>") || !hasWarning(w.Data.Warnings, "JWT not signed") {
		t.Errorf("unsignable JWT: %v %v\n%s", w.Error, w.Data.Warnings, w.Data.Snippet)
	}
}

func TestCodegenPrefsAndTargets(t *testing.T) {
	a := codegenApp(t)
	if got := a.GetCodegenPrefs(); got != DefaultCodegenOptions {
		t.Fatalf("defaults = %+v", got)
	}
	want := CodegenOptions{Target: "python", Resolved: false, OneLine: true, Proxy: true}
	if r := a.SetCodegenPrefs(want); r.Error != nil {
		t.Fatal(r.Error.Message)
	}
	if got := a.GetCodegenPrefs(); got != want {
		t.Fatalf("persisted = %+v", got)
	}
	if r := a.SetCodegenPrefs(CodegenOptions{Target: "cobol"}); r.Error == nil {
		t.Fatal("an unknown target is refused")
	}
	ids := []string{}
	for _, tg := range a.CodegenTargets() {
		ids = append(ids, tg.ID)
	}
	if strings.Join(ids, ",") != "curl,fetch,python,go" {
		t.Fatalf("targets = %v", ids)
	}
}

// "Copy as curl" from history renders the AS-SENT record.
func TestHistoryCurl(t *testing.T) {
	var gotBody string
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		b, _ := io.ReadAll(r.Body)
		gotBody = string(b)
	}))
	t.Cleanup(srv.Close)
	a := codegenApp(t)
	draft := api.RequestDraft{Method: "PUT", URL: srv.URL + "/x", Body: api.RequestBody{Type: api.BodyRaw, ContentType: "text/plain", Content: "it's {{API_TOKEN}}"}}
	if r := a.SendRequest("p1", "r1", draft, SendOptions{FollowRedirects: true}); r.Error != nil {
		t.Fatal(r.Error.Message)
	}
	page := a.ListHistory(HistoryFilter{})
	if page.Error != nil || len(page.Data.Items) == 0 {
		t.Fatalf("history: %v", page.Error)
	}
	c := a.HistoryCurl(page.Data.Items[0].ID, true)
	if c.Error != nil {
		t.Fatal(c.Error.Message)
	}
	want := "it's " + secretToken
	if gotBody != want || !strings.Contains(c.Data.Snippet, `--data-raw 'it'\''s `+secretToken+`'`) ||
		!strings.Contains(c.Data.Snippet, "-X PUT") || strings.ContainsAny(c.Data.Snippet, "\n") {
		t.Errorf("history curl:\n%s", c.Data.Snippet)
	}
}

func hasWarning(ws []string, sub string) bool {
	for _, w := range ws {
		if strings.Contains(w, sub) {
			return true
		}
	}
	return false
}
