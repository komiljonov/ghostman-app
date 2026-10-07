package engine

import (
	"context"
	"encoding/base64"
	"encoding/json"
	"net"
	"net/http"
	"net/http/httptest"
	"net/url"
	"strings"
	"testing"
)

// authEcho reports the request's headers and raw query.
func authEcho(t *testing.T) *httptest.Server {
	t.Helper()
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		_ = json.NewEncoder(w).Encode(map[string]any{"headers": r.Header, "query": r.URL.RawQuery})
	}))
	t.Cleanup(srv.Close)
	return srv
}

type authSeen struct {
	Headers map[string][]string `json:"headers"`
	Query   string              `json:"query"`
}

func sendAuth(t *testing.T, spec RequestSpec) authSeen {
	t.Helper()
	resp, err := New(DefaultTimeout).Send(context.Background(), spec, SendOptions{FollowRedirects: true})
	if err != nil {
		t.Fatal(err)
	}
	var s authSeen
	if err := json.Unmarshal([]byte(resp.Body), &s); err != nil {
		t.Fatalf("body %q", resp.Body)
	}
	return s
}

func TestAuthHeaderPerMode(t *testing.T) {
	srv := authEcho(t)
	cases := []struct {
		name      string
		auth      *Auth
		header    string // header to look at
		want      []string
		wantQuery string
	}{
		{"bearer", &Auth{Type: AuthBearer, BearerToken: "tok-1"}, "Authorization", []string{"Bearer tok-1"}, ""},
		{"basic", &Auth{Type: AuthBasic, BasicUsername: "aladdin", BasicPassword: "open sesame"}, "Authorization",
			[]string{"Basic YWxhZGRpbjpvcGVuIHNlc2FtZQ=="}, ""},
		{"api key header", &Auth{Type: AuthAPIKey, APIKeyName: "X-Api-Key", APIKeyValue: "k1", APIKeyIn: APIKeyInHeader}, "X-Api-Key", []string{"k1"}, ""},
		{"api key default placement is header", &Auth{Type: AuthAPIKey, APIKeyName: "X-Api-Key", APIKeyValue: "k1"}, "X-Api-Key", []string{"k1"}, ""},
		{"api key query", &Auth{Type: AuthAPIKey, APIKeyName: "api_key", APIKeyValue: "a b&c", APIKeyIn: APIKeyInQuery}, "Authorization", nil, "a=1&api_key=a+b%26c"},
		{"none", &Auth{Type: AuthNone, BearerToken: "kept but unused"}, "Authorization", nil, ""},
		{"inherit at the end of the chain", &Auth{Type: AuthInherit, BearerToken: "x"}, "Authorization", nil, ""},
		{"nil", nil, "Authorization", nil, ""},
		{"empty bearer token sends nothing", &Auth{Type: AuthBearer}, "Authorization", nil, ""},
	}
	for _, c := range cases {
		url := srv.URL + "/x"
		if c.wantQuery != "" {
			url += "?a=1"
		}
		got := sendAuth(t, RequestSpec{Method: "GET", URL: url, Auth: c.auth})
		if strings.Join(got.Headers[c.header], "|") != strings.Join(c.want, "|") {
			t.Errorf("%s: %s = %v, want %v", c.name, c.header, got.Headers[c.header], c.want)
		}
		if got.Query != c.wantQuery {
			t.Errorf("%s: query = %q, want %q", c.name, got.Query, c.wantQuery)
		}
	}
}

func TestBasicCredentialsBase64(t *testing.T) {
	v := BasicCredentials("user", "p:a:ss") // only the first ':' separates
	raw, err := base64.StdEncoding.DecodeString(strings.TrimPrefix(v, "Basic "))
	if err != nil || string(raw) != "user:p:a:ss" || !strings.HasPrefix(v, "Basic ") {
		t.Fatalf("%q -> %q %v", v, raw, err)
	}
}

func TestAuthUserWrittenWins(t *testing.T) {
	srv := authEcho(t)
	// A manual Authorization header (any case) beats bearer/basic.
	got := sendAuth(t, RequestSpec{Method: "GET", URL: srv.URL,
		Headers: []Header{{Key: "authorization", Value: "Manual 1", Enabled: true}},
		Auth:    &Auth{Type: AuthBearer, BearerToken: "derived"}})
	if strings.Join(got.Headers["Authorization"], "|") != "Manual 1" {
		t.Errorf("manual must win: %v", got.Headers["Authorization"])
	}
	// A DISABLED manual header is not sent, so the derived one is.
	got = sendAuth(t, RequestSpec{Method: "GET", URL: srv.URL,
		Headers: []Header{{Key: "Authorization", Value: "Manual 1", Enabled: false}},
		Auth:    &Auth{Type: AuthBearer, BearerToken: "derived"}})
	if strings.Join(got.Headers["Authorization"], "|") != "Bearer derived" {
		t.Errorf("disabled manual header: %v", got.Headers["Authorization"])
	}
	// API key header name.
	got = sendAuth(t, RequestSpec{Method: "GET", URL: srv.URL,
		Headers: []Header{{Key: "X-API-KEY", Value: "mine", Enabled: true}},
		Auth:    &Auth{Type: AuthAPIKey, APIKeyName: "X-Api-Key", APIKeyValue: "derived"}})
	if strings.Join(got.Headers["X-Api-Key"], "|") != "mine" {
		t.Errorf("api key header: %v", got.Headers["X-Api-Key"])
	}
	// Query: a params row or the URL's own query beats the derived param.
	got = sendAuth(t, RequestSpec{Method: "GET", URL: srv.URL,
		QueryParams: []Header{{Key: "key", Value: "mine", Enabled: true}},
		Auth:        &Auth{Type: AuthAPIKey, APIKeyName: "key", APIKeyValue: "derived", APIKeyIn: APIKeyInQuery}})
	if got.Query != "key=mine" {
		t.Errorf("params row: %q", got.Query)
	}
	got = sendAuth(t, RequestSpec{Method: "GET", URL: srv.URL + "?key=url",
		Auth: &Auth{Type: AuthAPIKey, APIKeyName: "key", APIKeyValue: "derived", APIKeyIn: APIKeyInQuery}})
	if got.Query != "key=url" {
		t.Errorf("url query: %q", got.Query)
	}
}

func TestApplyAuthIsIdempotentAndFeedsSentHelpers(t *testing.T) {
	spec := RequestSpec{Method: "GET", URL: "http://x.io/p", Auth: &Auth{Type: AuthAPIKey, APIKeyName: "k", APIKeyValue: "v", APIKeyIn: APIKeyInQuery}}
	once := ApplyAuth(spec)
	if once.Auth != nil || len(once.QueryParams) != 1 || len(ApplyAuth(once).QueryParams) != 1 || spec.Auth == nil {
		t.Fatalf("once = %+v (input must not change)", once)
	}
	if got := SentURL(spec); got != "http://x.io/p?k=v" {
		t.Errorf("SentURL = %q", got)
	}
	h := SentHeaders(RequestSpec{URL: "http://x.io", Auth: &Auth{Type: AuthBearer, BearerToken: "t"}})
	if len(h) != 1 || h[0].Key != "Authorization" || h[0].Value != "Bearer t" {
		t.Errorf("SentHeaders = %+v", h)
	}
}

func TestDerivedAuthorizationDroppedCrossHost(t *testing.T) {
	target := redirectServer(t)
	_, port, _ := net.SplitHostPort(strings.TrimPrefix(target.URL, "http://"))
	origin := redirectServer(t)
	e := New(DefaultTimeout)
	auth := &Auth{Type: AuthBearer, BearerToken: "s3"}

	other := url.QueryEscape("http://localhost:" + port + "/echo")
	resp, _, err := sendTo(t, e, RequestSpec{Method: "GET", URL: origin.URL + "/r/302?to=" + other, Auth: auth}, true)
	if err != nil || decodeEcho(t, resp).Auth != "" {
		t.Fatalf("cross-host: derived Authorization must be dropped: %v", err)
	}
	same := url.QueryEscape(target.URL + "/echo")
	resp, _, err = sendTo(t, e, RequestSpec{Method: "GET", URL: origin.URL + "/r/302?to=" + same, Auth: auth}, true)
	if err != nil || decodeEcho(t, resp).Auth != "Bearer s3" {
		t.Fatalf("same host: derived Authorization must be kept: %v", err)
	}
}

func TestResolveSpecInsideAuth(t *testing.T) {
	vars := map[string]string{"TOKEN": "secret-local", "USER": "u"}
	cases := []struct {
		in         Auth
		want       Auth
		unresolved []string
	}{
		{Auth{Type: AuthBearer, BearerToken: "{{TOKEN}}", BasicUsername: "{{NOPE}}"},
			Auth{Type: AuthBearer, BearerToken: "secret-local", BasicUsername: "{{NOPE}}"}, nil}, // other modes untouched, not reported
		{Auth{Type: AuthBasic, BasicUsername: "{{USER}}", BasicPassword: "{{PASS}}"},
			Auth{Type: AuthBasic, BasicUsername: "u", BasicPassword: "{{PASS}}"}, []string{"PASS"}},
		{Auth{Type: AuthAPIKey, APIKeyName: "{{USER}}-key", APIKeyValue: "{{TOKEN}}", APIKeyIn: "query"},
			Auth{Type: AuthAPIKey, APIKeyName: "u-key", APIKeyValue: "secret-local", APIKeyIn: "query"}, nil},
		{Auth{Type: AuthNone, BearerToken: "{{X}}"}, Auth{Type: AuthNone, BearerToken: "{{X}}"}, nil},
	}
	for _, c := range cases {
		out, missing := ResolveSpec(RequestSpec{URL: "http://x", Auth: &c.in}, vars)
		if *out.Auth != c.want || strings.Join(missing, ",") != strings.Join(c.unresolved, ",") {
			t.Errorf("%+v -> %+v %v", c.in, *out.Auth, missing)
		}
	}
	// Unresolved keys are collected across the URL and auth, once each.
	_, missing := ResolveSpec(RequestSpec{URL: "{{B}}/x", Auth: &Auth{Type: AuthBearer, BearerToken: "{{B}}{{T}}"}}, nil)
	if strings.Join(missing, ",") != "B,T" {
		t.Errorf("missing = %v", missing)
	}
}
