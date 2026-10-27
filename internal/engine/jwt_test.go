package engine

import (
	"context"
	"encoding/json"
	"io"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
	"time"

	"github.com/golang-jwt/jwt/v5"
)

var jwtNow = time.Unix(1_700_000_000, 0)

func TestDynamicClaim(t *testing.T) {
	for _, tt := range []struct {
		in   string
		want int64
		ok   bool
	}{
		{"{{$now}}", 1_700_000_000, true},
		{"{{$now+3600}}", 1_700_003_600, true},
		{"{{$now-60}}", 1_699_999_940, true},
		{"{{$now+0}}", 1_700_000_000, true},
		{"{{$now+}}", 0, false},
		{"{{$now+1.5}}", 0, false},
		{"{{$now*2}}", 0, false},
		{"{{ $now }}", 0, false},
		{"{{$NOW}}", 0, false},
		{" {{$now}}", 0, false},
		{"{{$now}} ", 0, false},
		{"exp {{$now}}", 0, false},
		{"{{$now}}{{$now}}", 0, false},
		{"{{$now+99999999999999999999}}", 0, false}, // out of range
		{"$now", 0, false},
	} {
		got, ok := DynamicClaim(tt.in, jwtNow)
		if ok != tt.ok || got != tt.want {
			t.Errorf("DynamicClaim(%q) = %d, %v; want %d, %v", tt.in, got, ok, tt.want, tt.ok)
		}
	}
}

func jwtSpec(a Auth) RequestSpec {
	a.Type = AuthJWT
	return RequestSpec{Method: http.MethodGet, URL: "http://x/", Auth: &a}
}

func signed(t *testing.T, spec RequestSpec, vars map[string]string) (RequestSpec, []string) {
	t.Helper()
	r, unresolved := ResolveSpec(spec, vars)
	out, err := SignJWT(r, jwtNow)
	if err != nil {
		t.Fatalf("SignJWT: %v", err)
	}
	return out, unresolved
}

// Vectors computed independently (Python hmac over the same header + claims).
func TestJWTSigningVectors(t *testing.T) {
	payload := `{"sub":"1234567890","name":"John Doe","iat":1516239022}`
	for alg, want := range map[string]string{
		"HS256": "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpYXQiOjE1MTYyMzkwMjIsIm5hbWUiOiJKb2huIERvZSIsInN1YiI6IjEyMzQ1Njc4OTAifQ.fdOPQ05ZfRhkST2-rIWgUpbqUsVhkkNVNcuG7Ki0s-8",
		"HS384": "eyJhbGciOiJIUzM4NCIsInR5cCI6IkpXVCJ9.eyJpYXQiOjE1MTYyMzkwMjIsIm5hbWUiOiJKb2huIERvZSIsInN1YiI6IjEyMzQ1Njc4OTAifQ.YnQ0XsGV7q1kSiw8f6Je8F2lnLOGsTbtOs0jJEsVnPhTLs5luClQdnPrdy67ZuWn",
		"HS512": "eyJhbGciOiJIUzUxMiIsInR5cCI6IkpXVCJ9.eyJpYXQiOjE1MTYyMzkwMjIsIm5hbWUiOiJKb2huIERvZSIsInN1YiI6IjEyMzQ1Njc4OTAifQ.P2L-OXlIA6aT5CtEt2UvYwAEXUxxSd3rEfmmCFSflJTZyZaUoQmJ8k68novA-3aL97EWN0q4mqzuxO0KkLnnRA",
	} {
		out, _ := signed(t, jwtSpec(Auth{JWTAlgorithm: alg, JWTSecret: "your-256-bit-secret", JWTPayload: payload}), nil)
		if out.Auth.jwtToken != want {
			t.Errorf("%s token =\n%s\nwant\n%s", alg, out.Auth.jwtToken, want)
		}
	}
}

func TestJWTResolvesAndVerifies(t *testing.T) {
	spec := jwtSpec(Auth{JWTAlgorithm: "HS256", JWTSecret: "{{JWT_SECRET}}",
		JWTPayload: `{"sub":"{{user_id}}","iat":"{{$now}}","exp":"{{$now+3600}}","nbf":"{{$now-5}}","n":12345678901234567890,"nested":{"at":"{{$now}}"},"note":"{{missing}}","text":"at {{$now}}"}`})
	out, unresolved := signed(t, spec, map[string]string{"JWT_SECRET": "s3cr3t", "user_id": "u-42"})
	if len(unresolved) != 1 || unresolved[0] != "missing" {
		t.Fatalf("unresolved = %v ($now must not be reported)", unresolved)
	}
	tok, err := jwt.Parse(out.Auth.jwtToken, func(*jwt.Token) (any, error) { return []byte("s3cr3t"), nil },
		jwt.WithTimeFunc(func() time.Time { return jwtNow }), jwt.WithValidMethods([]string{"HS256"}))
	if err != nil {
		t.Fatalf("the token does not verify with the secret: %v", err)
	}
	c := tok.Claims.(jwt.MapClaims)
	if c["sub"] != "u-42" || c["iat"] != float64(1_700_000_000) || c["exp"] != float64(1_700_003_600) || c["nbf"] != float64(1_699_999_995) {
		t.Fatalf("claims = %v", c)
	}
	if c["note"] != "{{missing}}" || c["text"] != "at {{$now}}" || c["nested"].(map[string]any)["at"] != float64(1_700_000_000) {
		t.Fatalf("claims = %v", c)
	}
	// Numbers are kept exactly as written (no float rounding).
	raw := strings.Split(out.Auth.jwtToken, ".")[1]
	if !strings.Contains(decodeSeg(t, raw), `"n":12345678901234567890`) {
		t.Fatalf("payload = %s", decodeSeg(t, raw))
	}
}

func decodeSeg(t *testing.T, s string) string {
	t.Helper()
	b, err := jwt.NewParser().DecodeSegment(s)
	if err != nil {
		t.Fatal(err)
	}
	return string(b)
}

func TestJWTBase64Secret(t *testing.T) {
	spec := jwtSpec(Auth{JWTAlgorithm: "HS256", JWTSecret: "AAFiaW5hcnkta2V5/w==", JWTSecretBase64: true, JWTPayload: `{"sub":"x"}`})
	out, _ := signed(t, spec, nil)
	if out.Auth.jwtToken != "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJzdWIiOiJ4In0.Gcr8cTp3oVf6CQpNWU10iXATi3t6NF8AgnbjNiSOHBA" {
		t.Fatalf("token = %s", out.Auth.jwtToken)
	}
}

func TestJWTAborts(t *testing.T) {
	for _, tt := range []struct {
		name string
		a    Auth
		vars map[string]string
		want string
	}{
		{"unresolved secret names the variable", Auth{JWTSecret: "{{JWT_SECRET}}", JWTPayload: `{}`}, nil,
			"JWT not signed: the secret uses {{JWT_SECRET}}, which has no value in the active environment"},
		{"empty secret", Auth{JWTSecret: "", JWTPayload: `{}`}, nil, "JWT not signed: the secret is empty"},
		{"bad base64", Auth{JWTSecret: "not base64!!", JWTSecretBase64: true, JWTPayload: `{}`}, nil, "is marked Base64 but is not valid Base64"},
		{"invalid JSON with position", Auth{JWTSecret: "k", JWTPayload: "{\n  \"a\": 1,\n  \"b\": }"}, nil, "the payload is not valid JSON (line 3, col"},
		{"truncated JSON", Auth{JWTSecret: "k", JWTPayload: `{"a": 1`}, nil, "the payload is not valid JSON (line 1, col 8"},
		{"not an object", Auth{JWTSecret: "k", JWTPayload: `["a"]`}, nil, "the payload must be a JSON object"},
		{"trailing text", Auth{JWTSecret: "k", JWTPayload: `{} {}`}, nil, "text after the JSON object"},
		{"a var that breaks the JSON", Auth{JWTSecret: "k", JWTPayload: `{"a": {{n}}}`}, map[string]string{"n": `"x`}, "not valid JSON"},
		{"unknown algorithm", Auth{JWTAlgorithm: "RS256", JWTSecret: "k", JWTPayload: `{}`}, nil, "unsupported algorithm"},
	} {
		r, _ := ResolveSpec(jwtSpec(tt.a), tt.vars)
		_, err := SignJWT(r, jwtNow)
		if err == nil || !strings.Contains(err.Error(), tt.want) {
			t.Errorf("%s: err = %v, want %q", tt.name, err, tt.want)
		}
	}
	// An empty payload is an empty claim set, not an error.
	if _, err := SignJWT(jwtSpec(Auth{JWTSecret: "k"}), jwtNow); err != nil {
		t.Errorf("empty payload: %v", err)
	}
}

func TestJWTAttach(t *testing.T) {
	base := Auth{JWTAlgorithm: "HS256", JWTSecret: "k", JWTPayload: `{"a":1}`}
	sign := func(a Auth, spec RequestSpec) RequestSpec {
		a.Type = AuthJWT
		spec.Auth = &a
		out, _ := signed(t, spec, nil)
		return out
	}
	plain := RequestSpec{Method: "GET", URL: "http://x/"}

	h := ApplyAuth(sign(base, plain))
	if len(h.Headers) != 1 || h.Headers[0].Key != "Authorization" || !strings.HasPrefix(h.Headers[0].Value, "Bearer ey") {
		t.Fatalf("default header = %+v", h.Headers)
	}
	custom := base
	custom.JWTName, custom.JWTPrefix = "X-Token", "JWT "
	h = ApplyAuth(sign(custom, plain))
	if h.Headers[0].Key != "X-Token" || !strings.HasPrefix(h.Headers[0].Value, "JWT ey") {
		t.Fatalf("custom header = %+v", h.Headers)
	}
	q := base
	q.JWTAddTo, q.JWTPrefix = JWTAddToQuery, "ignored "
	out := ApplyAuth(sign(q, plain))
	if len(out.QueryParams) != 1 || out.QueryParams[0].Key != "token" || !strings.HasPrefix(out.QueryParams[0].Value, "ey") || len(out.Headers) != 0 {
		t.Fatalf("default query = %+v / %+v", out.QueryParams, out.Headers)
	}
	q.JWTName = "access_token"
	if out := ApplyAuth(sign(q, plain)); out.QueryParams[0].Key != "access_token" {
		t.Fatalf("named query = %+v", out.QueryParams)
	}

	// User-written wins.
	mine := plain
	mine.Headers = []Header{{Key: "authorization", Value: "Bearer mine", Enabled: true}}
	if out := ApplyAuth(sign(base, mine)); len(out.Headers) != 1 || out.Headers[0].Value != "Bearer mine" {
		t.Fatalf("user header must win: %+v", out.Headers)
	}
	mineQ := plain
	mineQ.URL = "http://x/?token=mine"
	q.JWTName = ""
	if out := ApplyAuth(sign(q, mineQ)); len(out.QueryParams) != 0 {
		t.Fatalf("user query param must win: %+v", out.QueryParams)
	}

	// Not signed (no SignJWT) → nothing attached.
	r, _ := ResolveSpec(jwtSpec(base), nil)
	if out := ApplyAuth(r); len(out.Headers) != 0 {
		t.Fatalf("an unsigned config attached %+v", out.Headers)
	}
}

func TestJWTSendAndPreview(t *testing.T) {
	var gotAuth string
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		gotAuth = r.Header.Get("Authorization")
		_, _ = io.WriteString(w, "ok")
	}))
	defer srv.Close()
	spec := jwtSpec(Auth{JWTAlgorithm: "HS384", JWTSecret: "{{K}}", JWTPayload: `{"iat":"{{$now}}"}`})
	spec.URL = srv.URL
	r, _ := ResolveSpec(spec, map[string]string{"K": "the-key"})
	s, err := SignJWT(r, jwtNow)
	if err != nil {
		t.Fatal(err)
	}
	if _, err := New(DefaultTimeout).Send(context.Background(), s, SendOptions{}); err != nil {
		t.Fatal(err)
	}
	if _, err := jwt.Parse(strings.TrimPrefix(gotAuth, "Bearer "), func(*jwt.Token) (any, error) { return []byte("the-key"), nil }); err != nil {
		t.Fatalf("sent token does not verify: %v (%q)", err, gotAuth)
	}

	p, err := PreviewJWT(r, jwtNow)
	if err != nil {
		t.Fatal(err)
	}
	var hdr, claims map[string]any
	_ = json.Unmarshal([]byte(p.Header), &hdr)
	_ = json.Unmarshal([]byte(p.Payload), &claims)
	if hdr["alg"] != "HS384" || claims["iat"] != float64(1_700_000_000) || len(p.TokenHead) != 8 || len(p.TokenTail) != 8 {
		t.Fatalf("preview = %+v", p)
	}
	if strings.Contains(p.Header+p.Payload+p.TokenHead+p.TokenTail, "the-key") {
		t.Fatal("the preview leaks the secret")
	}
}
