package codegen

import (
	"flag"
	"os"
	"path/filepath"
	"strings"
	"testing"
	"time"

	"github.com/golang-jwt/jwt/v5"

	"ghostman/internal/engine"
)

var update = flag.Bool("update", false, "rewrite the golden files")

// TortureBody has everything quoting can get wrong.
const TortureBody = "{\"name\": \"it's \\\"quoted\\\"\", \"cost\": \"$HOME ${PATH} $(whoami) `id`\",\n" +
	"\"path\": \"C:\\\\temp\\\\x\", \"tab\":\"\t\", \"crlf\": \"a\r\nb\",\n\"uni\": \"üñí ✓ 😀 \u2028\"}\n"

func prepared(t *testing.T, spec engine.RequestSpec) engine.Prepared {
	t.Helper()
	p, err := engine.Prepare(spec)
	if err != nil {
		t.Fatal(err)
	}
	return p
}

func hdr(k, v string) engine.Header { return engine.Header{Key: k, Value: v, Enabled: true} }

const jwtSecret = "s3cret-key"

// fixtures: name → input (+ curl options variants where it matters).
func fixtures(t *testing.T) map[string]Input {
	t.Helper()
	signed, err := engine.SignJWT(engine.RequestSpec{
		Method: "GET", URL: "https://api.example.com/me",
		Auth: &engine.Auth{Type: engine.AuthJWT, JWTAlgorithm: "HS256", JWTSecret: jwtSecret, JWTPayload: `{"sub":"42","role":"admin"}`, JWTAddTo: engine.JWTAddToHeader},
	}, time.Date(2026, 11, 26, 10, 0, 0, 0, time.UTC))
	if err != nil {
		t.Fatal(err)
	}
	jwtTemplate := engine.WithJWTPlaceholder(engine.RequestSpec{
		Method: "GET", URL: "https://api.example.com/me",
		Auth: &engine.Auth{Type: engine.AuthJWT, JWTAlgorithm: "HS256", JWTSecret: "{{JWT_SECRET}}", JWTPayload: `{"sub":"42"}`, JWTAddTo: engine.JWTAddToHeader},
	})
	parts := []engine.Part{
		{Key: "title", Kind: engine.PartText, Value: "@not-a-file <neither", Enabled: true},
		{Key: "avatar", Kind: engine.PartFile, FileName: "avatar.png", Path: "/home/me/pics/a b.png", Enabled: true},
		{Key: "skipped", Kind: engine.PartText, Value: "x", Enabled: false},
	}
	return map[string]Input{
		"get_minimal": {Request: prepared(t, engine.RequestSpec{Method: "GET", URL: "https://api.example.com/items"}), FollowRedirects: true},
		"full_post": {
			Request: prepared(t, engine.RequestSpec{
				Method: "POST", URL: "https://api.example.com/items?existing=1",
				Headers:     []engine.Header{hdr("X-Trace", "abc"), hdr("X-Empty", ""), {Key: "X-Off", Value: "no", Enabled: false}, hdr("Accept", "application/json")},
				QueryParams: []engine.Header{hdr("tag", "a"), hdr("tag", "b c")},
				Body:        engine.Body{Type: engine.BodyRaw, ContentType: "application/json", Content: TortureBody},
				Auth:        &engine.Auth{Type: engine.AuthBearer, BearerToken: "tok-123"},
			}),
			Timeout: 30 * time.Second, FollowRedirects: true,
		},
		"urlencoded": {
			Request: prepared(t, engine.RequestSpec{
				Method: "POST", URL: "https://api.example.com/login",
				Body: engine.Body{Type: engine.BodyForm, Fields: []engine.Header{hdr("user", "a b&c=d"), hdr(" pass ", "p'w\"$"), hdr("user", "second")}},
			}),
			FollowRedirects: true,
		},
		"multipart_resolved": {
			Request:         prepared(t, engine.RequestSpec{Method: "POST", URL: "https://api.example.com/upload", Body: engine.Body{Type: engine.BodyMultipart, Parts: parts}}),
			FollowRedirects: true, FilePaths: true,
		},
		"multipart_template": {
			Request:         prepared(t, engine.RequestSpec{Method: "POST", URL: "https://api.example.com/upload", Body: engine.Body{Type: engine.BodyMultipart, Parts: parts}}),
			FollowRedirects: true, FilePaths: false, Notes: []string{"file paths are placeholders (template values)"},
		},
		"jwt_resolved":  {Request: prepared(t, signed), FollowRedirects: true},
		"jwt_template":  {Request: prepared(t, jwtTemplate), FollowRedirects: true, Notes: []string{"JWT: " + engine.JWTPlaceholder}},
		"flags_noredir": {Request: prepared(t, engine.RequestSpec{Method: "DELETE", URL: "https://api.example.com/items/7"}), Timeout: 1500 * time.Millisecond, FollowRedirects: false},
		"proxy_scripts": {
			Request:         prepared(t, engine.RequestSpec{Method: "GET", URL: "https://api.example.com/{{unresolved}}"}),
			FollowRedirects: true, Notes: []string{"pre/post scripts are not represented"},
			Proxy: &Proxy{URL: "http://localhost:3128", Label: "Local squid", HasCredentials: true},
		},
	}
}

func golden(t *testing.T, name, got string) {
	t.Helper()
	path := filepath.Join("testdata", name+".golden")
	if *update {
		if err := os.MkdirAll("testdata", 0o755); err != nil {
			t.Fatal(err)
		}
		if err := os.WriteFile(path, []byte(got), 0o644); err != nil {
			t.Fatal(err)
		}
		return
	}
	want, err := os.ReadFile(path)
	if err != nil {
		t.Fatalf("%s: %v (run with -update)", name, err)
	}
	if string(want) != got {
		t.Errorf("%s differs from its golden file:\n--- got\n%s\n--- want\n%s", name, got, want)
	}
}

func TestGoldenSnippets(t *testing.T) {
	for name, in := range fixtures(t) {
		for _, target := range Targets() {
			got, err := Generate(target.ID, in, Options{})
			if err != nil {
				t.Fatal(err)
			}
			golden(t, name+"."+target.ID, got)
		}
		oneLine, _ := Generate("curl", in, Options{OneLine: true, IncludeProxy: true})
		golden(t, name+".curl-oneline", oneLine)
	}
}

func TestCurlOneLineHasNoNewlines(t *testing.T) {
	for name, in := range fixtures(t) {
		got, _ := Generate("curl", in, Options{OneLine: true})
		if strings.ContainsAny(got, "\n\r") {
			t.Errorf("%s: one-line curl contains a line break: %q", name, got)
		}
	}
}

func TestCurlFlags(t *testing.T) {
	f := fixtures(t)
	got, _ := Generate("curl", f["flags_noredir"], Options{})
	for _, want := range []string{"-X DELETE", "--max-time 2", "--max-redirs 0"} {
		if !strings.Contains(got, want) {
			t.Errorf("missing %q in %s", want, got)
		}
	}
	if strings.Contains(got, " -L") {
		t.Error("redirects off must not follow")
	}
	full, _ := Generate("curl", f["full_post"], Options{})
	for _, want := range []string{"-H 'X-Empty;'", "-H 'Authorization: Bearer tok-123'", "?existing=1&tag=a&tag=b+c'", "--max-time 30", "-L"} {
		if !strings.Contains(full, want) {
			t.Errorf("missing %q in %s", want, full)
		}
	}
	if strings.Contains(full, "X-Off") || strings.Contains(full, "-X POST") {
		t.Errorf("disabled header or redundant -X POST in %s", full)
	}
	withProxy, _ := Generate("curl", f["proxy_scripts"], Options{IncludeProxy: true})
	if !strings.Contains(withProxy, "-x 'http://localhost:3128'") || strings.Contains(withProxy, "not represented in this snippet") {
		t.Errorf("proxy: %s", withProxy)
	}
	without, _ := Generate("curl", f["proxy_scripts"], Options{})
	if strings.Contains(without, "-x ") || !strings.Contains(without, "# sent through the proxy Local squid") {
		t.Errorf("no proxy: %s", without)
	}
}

func TestJWTSnippets(t *testing.T) {
	f := fixtures(t)
	for _, target := range Targets() {
		got, _ := Generate(target.ID, f["jwt_resolved"], Options{})
		i := strings.Index(got, "Bearer ")
		if i < 0 {
			t.Fatalf("%s: no bearer token in %s", target.ID, got)
		}
		tok := got[i+len("Bearer "):]
		tok = tok[:strings.IndexAny(tok, "'\"")]
		claims := jwt.MapClaims{}
		if _, err := jwt.ParseWithClaims(tok, claims, func(*jwt.Token) (any, error) { return []byte(jwtSecret), nil }); err != nil {
			t.Fatalf("%s: token does not verify: %v", target.ID, err)
		}
		if claims["sub"] != "42" {
			t.Errorf("%s: claims %v", target.ID, claims)
		}
		tmpl, _ := Generate(target.ID, f["jwt_template"], Options{})
		if !strings.Contains(tmpl, "Bearer "+engine.JWTPlaceholder) || strings.Contains(tmpl, jwtSecret) {
			t.Errorf("%s template: %s", target.ID, tmpl)
		}
	}
}

func TestKeepVarTokens(t *testing.T) {
	spec := engine.RequestSpec{
		Method: "POST", URL: "{{BASE_URL}}/v1/{{user id}}?q={{Q}}",
		QueryParams: []engine.Header{hdr("token", "{{API_TOKEN}}")},
		Body:        engine.Body{Type: engine.BodyForm, Fields: []engine.Header{hdr("k", "{{V}} x")}},
	}
	if _, err := engine.Prepare(spec); err == nil {
		t.Fatal("an unresolved base URL is not a sendable URL")
	}
	p := engine.PrepareTemplate(spec)
	if !strings.Contains(p.URL, "%7B%7BAPI_TOKEN%7D%7D") {
		t.Fatalf("appended params are wire-encoded: %s", p.URL)
	}
	k := KeepVarTokens(p)
	if k.URL != "{{BASE_URL}}/v1/{{user id}}?q={{Q}}&token={{API_TOKEN}}" || k.Body.Raw != "k={{V}}+x" {
		t.Fatalf("template form: %s / %s", k.URL, k.Body.Raw)
	}
}

func TestUnknownTarget(t *testing.T) {
	if _, err := Generate("cobol", Input{}, Options{}); err == nil {
		t.Fatal("unknown target must fail")
	}
}
