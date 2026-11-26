package engine

import (
	"context"
	"io"
	"net/http"
	"net/http/httptest"
	"regexp"
	"strings"
	"testing"
	"time"
)

var dynNow = time.Date(2026, 11, 26, 9, 15, 2, 0, time.UTC)

func TestGeneratedValueFormats(t *testing.T) {
	g := NewGenerator(dynNow)
	cases := []struct {
		key  string
		want *regexp.Regexp
	}{
		{"$uuid", regexp.MustCompile(`^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$`)},
		{"$now", regexp.MustCompile(`^1795684502$`)},
		{"$now+60", regexp.MustCompile(`^1795684562$`)},
		{"$now-3600", regexp.MustCompile(`^1795680902$`)},
		{"$timestamp", regexp.MustCompile(`^1795684502$`)},
		{"$isoTimestamp", regexp.MustCompile(`^2026-11-26T09:15:02Z$`)},
		{"$date", regexp.MustCompile(`^` + dynNow.Local().Format("2006-01-02") + `$`)},
		{"$randomInt", regexp.MustCompile(`^(0|[1-9][0-9]{0,5})$`)},
		{"$randomHex", regexp.MustCompile(`^[0-9a-f]{16}$`)},
	}
	for _, c := range cases {
		v, ok := g.Value(c.key)
		if !ok || !c.want.MatchString(v) {
			t.Errorf("%s = %q, %v; want %s", c.key, v, ok, c.want)
		}
	}
	for _, k := range []string{"$UUID", "$now+1.5", "$now +1", "$ now", "$", "$guid", "$randomint"} {
		if v, ok := g.Value(k); ok {
			t.Errorf("%q is not a generated variable, got %q", k, v)
		}
	}
}

func TestRandomIntRange(t *testing.T) {
	g := NewGenerator(dynNow)
	for range 2000 {
		if n := g.randomInt(); n < 0 || n > 999_999 {
			t.Fatalf("randomInt out of range: %d", n)
		}
	}
}

// One value per distinct token TEXT per send; fresh values for the next send;
// $now and $now+60 share one clock reading.
func TestGeneratedSameValuePerSend(t *testing.T) {
	spec := RequestSpec{
		URL:     "https://x.test/{{$uuid}}?n={{$now}}",
		Headers: []Header{{Key: "X-Id", Value: "{{$uuid}}", Enabled: true}, {Key: "X-Exp", Value: "{{$now+60}}", Enabled: true}},
		Body:    Body{Type: BodyRaw, Content: `{"id":"{{$uuid}}","hex":"{{$randomHex}}","hex2":"{{$randomHex}}"}`},
	}
	out, unresolved := ResolveSpecWith(spec, nil, NewGenerator(dynNow))
	if len(unresolved) != 0 {
		t.Fatalf("unresolved = %v", unresolved)
	}
	id := strings.TrimPrefix(strings.Split(out.URL, "?")[0], "https://x.test/")
	if out.Headers[0].Value != id || !strings.Contains(out.Body.Content, `"id":"`+id+`"`) {
		t.Fatalf("$uuid differs within one send: url %q header %q body %q", id, out.Headers[0].Value, out.Body.Content)
	}
	if out.Headers[1].Value != "1795684562" || !strings.HasSuffix(out.URL, "?n=1795684502") {
		t.Fatalf("time values: %q %q", out.URL, out.Headers[1].Value)
	}
	hex := regexp.MustCompile(`"hex":"(\w+)","hex2":"(\w+)"`).FindStringSubmatch(out.Body.Content)
	if hex == nil || hex[1] != hex[2] {
		t.Fatalf("$randomHex twice: %q", out.Body.Content)
	}
	again, _ := ResolveSpec(spec, nil)
	if again.Headers[0].Value == id {
		t.Fatal("a second send must generate a fresh $uuid")
	}
}

// Unknown $name: literal + reported. A "$" key is never read from the env map.
func TestGeneratedUnknownStaysLiteral(t *testing.T) {
	spec := RequestSpec{URL: "https://x.test/{{$nope}}/{{$uuid}}/{{$UUID}}"}
	out, unresolved := ResolveSpecWith(spec, map[string]string{"$nope": "from-env", "$uuid": "from-env"}, NewGenerator(dynNow))
	if !strings.HasPrefix(out.URL, "https://x.test/{{$nope}}/") || strings.Contains(out.URL, "from-env") || !strings.HasSuffix(out.URL, "/{{$UUID}}") {
		t.Fatalf("url = %q", out.URL)
	}
	if strings.Join(unresolved, ",") != "$nope,$UUID" {
		t.Fatalf("unresolved = %v", unresolved)
	}
}

// Generated values work inside auth, and in a JWT payload except the time
// claims, which stay for SignJWT (numbers — the JWT behaviour is unchanged).
func TestGeneratedInAuthAndJWT(t *testing.T) {
	g := NewGenerator(dynNow)
	g.uuid = func() string { return "fixed-uuid" }
	spec := RequestSpec{Auth: &Auth{Type: AuthJWT, JWTAlgorithm: "HS256", JWTSecret: "k",
		JWTPayload: `{"jti":"{{$uuid}}","iat":"{{$now}}","at":"at {{$now}}"}`}}
	out, unresolved := ResolveSpecWith(spec, nil, g)
	if len(unresolved) != 0 || out.Auth.JWTPayload != `{"jti":"fixed-uuid","iat":"{{$now}}","at":"at {{$now}}"}` {
		t.Fatalf("payload = %s, %v", out.Auth.JWTPayload, unresolved)
	}
	bearer, _ := ResolveSpecWith(RequestSpec{Auth: &Auth{Type: AuthBearer, BearerToken: "t-{{$uuid}}"}}, nil, g)
	if bearer.Auth.BearerToken != "t-fixed-uuid" {
		t.Fatalf("bearer = %q", bearer.Auth.BearerToken)
	}
}

// A real send: the server sees the generated values; repeated tokens agree.
func TestGeneratedReachTheServer(t *testing.T) {
	var gotPath, gotHeader, gotBody string
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		gotPath, gotHeader = r.URL.Path, r.Header.Get("X-Id")
		b, _ := io.ReadAll(r.Body)
		gotBody = string(b)
	}))
	defer srv.Close()
	spec, _ := ResolveSpec(RequestSpec{Method: "POST", URL: srv.URL + "/{{$uuid}}",
		Headers: []Header{{Key: "X-Id", Value: "{{$uuid}}", Enabled: true}},
		Body:    Body{Type: BodyRaw, ContentType: "text/plain", Content: "{{$uuid}}"}}, nil)
	if _, err := New(5*time.Second).Send(context.Background(), spec, SendOptions{FollowRedirects: true}); err != nil {
		t.Fatal(err)
	}
	if gotPath != "/"+gotHeader || gotBody != gotHeader || len(gotHeader) != 36 {
		t.Fatalf("path %q header %q body %q", gotPath, gotHeader, gotBody)
	}
}
