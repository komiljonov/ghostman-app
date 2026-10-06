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
)

// echo returns what the server received as JSON: raw query, headers, body.
func echoServer(t *testing.T) *httptest.Server {
	t.Helper()
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		body, _ := io.ReadAll(r.Body)
		w.Header().Set("Content-Type", "application/json")
		_ = json.NewEncoder(w).Encode(map[string]any{
			"method":  r.Method,
			"query":   r.URL.RawQuery,
			"headers": r.Header,
			"body":    string(body),
		})
	}))
	t.Cleanup(srv.Close)
	return srv
}

type echoed struct {
	Method  string              `json:"method"`
	Query   string              `json:"query"`
	Headers map[string][]string `json:"headers"`
	Body    string              `json:"body"`
}

func send(t *testing.T, spec RequestSpec) (*Response, echoed) {
	t.Helper()
	resp, err := New(DefaultTimeout).SendRequest(context.Background(), spec)
	if err != nil {
		t.Fatalf("send: %v", err)
	}
	var e echoed
	if err := json.Unmarshal([]byte(resp.Body), &e); err != nil {
		t.Fatalf("decode echo %q: %v", resp.Body, err)
	}
	return resp, e
}

func TestQueryParamsMergeWithURL(t *testing.T) {
	srv := echoServer(t)
	tests := []struct {
		name, url string
		params    []Header
		want      string
	}{
		{"no params", "/p", nil, ""},
		{"appended", "/p", []Header{{Key: "a", Value: "1", Enabled: true}}, "a=1"},
		{"merged after existing, which is kept as typed", "/p?x=1&y=a%20b",
			[]Header{{Key: "a", Value: "1", Enabled: true}}, "x=1&y=a%20b&a=1"},
		{"duplicates kept in order, disabled and keyless dropped", "/p",
			[]Header{{Key: "k", Value: "1", Enabled: true}, {Key: "off", Value: "x"}, {Key: "k", Value: "2", Enabled: true}, {Value: "nokey", Enabled: true}},
			"k=1&k=2"},
		{"encoded", "/p", []Header{{Key: "q s", Value: "a&b=c", Enabled: true}}, "q+s=a%26b%3Dc"},
		{"{{vars}} pass through literally", "/p", []Header{{Key: "v", Value: "{{token}}", Enabled: true}}, "v=%7B%7Btoken%7D%7D"},
	}
	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			_, e := send(t, RequestSpec{URL: srv.URL + tt.url, QueryParams: tt.params})
			if e.Query != tt.want {
				t.Errorf("query = %q, want %q", e.Query, tt.want)
			}
		})
	}
}

func TestHeadersEnabledOnly(t *testing.T) {
	_, e := send(t, RequestSpec{URL: echoServer(t).URL, Headers: []Header{
		{Key: "X-On", Value: "1", Enabled: true},
		{Key: "X-Off", Value: "1", Enabled: false},
		{Key: "X-Dup", Value: "a", Enabled: true},
		{Key: "X-Dup", Value: "b", Enabled: true},
	}})
	if e.Headers["X-On"] == nil || e.Headers["X-Off"] != nil || strings.Join(e.Headers["X-Dup"], ",") != "a,b" {
		t.Errorf("headers = %v", e.Headers)
	}
}

func TestBodyContentTypeRules(t *testing.T) {
	srv := echoServer(t)
	tests := []struct {
		name     string
		headers  []Header
		body     Body
		wantCT   string
		wantBody string
	}{
		{"none sends nothing", nil, Body{Type: BodyNone, Content: "ignored"}, "", ""},
		{"raw uses its content type", nil, Body{Type: BodyRaw, ContentType: "application/json", Content: `{"a":1}`},
			"application/json", `{"a":1}`},
		{"raw without content type is text/plain", nil, Body{Type: BodyRaw, Content: "hi"}, "text/plain", "hi"},
		{"explicit Content-Type header wins", []Header{{Key: "content-type", Value: "application/vnd.x", Enabled: true}},
			Body{Type: BodyRaw, ContentType: "application/json", Content: "{}"}, "application/vnd.x", "{}"},
		{"disabled Content-Type header does not win", []Header{{Key: "Content-Type", Value: "nope", Enabled: false}},
			Body{Type: BodyRaw, ContentType: "application/xml", Content: "<a/>"}, "application/xml", "<a/>"},
		{"form is urlencoded, enabled fields only, order kept", nil,
			Body{Type: BodyForm, Fields: []Header{{Key: "a", Value: "1 2", Enabled: true}, {Key: "b", Value: "x", Enabled: false}, {Key: "a", Value: "&", Enabled: true}}},
			"application/x-www-form-urlencoded", "a=1+2&a=%26"},
	}
	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			_, e := send(t, RequestSpec{Method: "POST", URL: srv.URL, Headers: tt.headers, Body: tt.body})
			if got := strings.Join(e.Headers["Content-Type"], ","); got != tt.wantCT {
				t.Errorf("Content-Type = %q, want %q", got, tt.wantCT)
			}
			if e.Body != tt.wantBody {
				t.Errorf("body = %q, want %q", e.Body, tt.wantBody)
			}
		})
	}
}

func TestJSONResponsePrettyPrinted(t *testing.T) {
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		switch r.URL.Path {
		case "/json":
			w.Header().Set("Content-Type", "application/json; charset=utf-8")
			_, _ = w.Write([]byte(`{"a":[1,2],"b":{"c":true}}`))
		case "/invalid":
			w.Header().Set("Content-Type", "application/json")
			_, _ = w.Write([]byte(`{not json`))
		default:
			w.Header().Set("Content-Type", "text/plain")
			_, _ = w.Write([]byte(`{"a":1}`))
		}
	}))
	defer srv.Close()
	e := New(DefaultTimeout)

	resp, _ := e.SendRequest(context.Background(), RequestSpec{URL: srv.URL + "/json"})
	want := "{\n  \"a\": [\n    1,\n    2\n  ],\n  \"b\": {\n    \"c\": true\n  }\n}"
	if !resp.Formatted || resp.Body != want || resp.ContentType != "application/json; charset=utf-8" {
		t.Errorf("json: formatted=%v body=%q", resp.Formatted, resp.Body)
	}
	if resp.BodySize != int64(len(`{"a":[1,2],"b":{"c":true}}`)) {
		t.Errorf("BodySize must be the wire size, got %d", resp.BodySize)
	}
	if resp.RawBody != `{"a":[1,2],"b":{"c":true}}` {
		t.Errorf("RawBody must be the body as received, got %q", resp.RawBody)
	}
	for _, path := range []string{"/invalid", "/text"} {
		resp, _ := e.SendRequest(context.Background(), RequestSpec{URL: srv.URL + path})
		if resp.Formatted || resp.RawBody != "" {
			t.Errorf("%s: must not be formatted (and Body is the raw text), raw=%q", path, resp.RawBody)
		}
	}
}

func TestTruncatedJSONIsNotFormatted(t *testing.T) {
	big := `{"x":"` + strings.Repeat("a", MaxBodyPreview) + `"}`
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, _ *http.Request) {
		w.Header().Set("Content-Type", "application/json")
		_, _ = w.Write([]byte(big))
	}))
	defer srv.Close()
	resp, err := New(DefaultTimeout).SendRequest(context.Background(), RequestSpec{URL: srv.URL})
	if err != nil || !resp.Truncated || resp.Formatted || len(resp.Body) != MaxBodyPreview {
		t.Fatalf("truncated=%v formatted=%v len=%d err=%v", resp.Truncated, resp.Formatted, len(resp.Body), err)
	}
}

func TestCancellation(t *testing.T) {
	srv := httptest.NewServer(http.HandlerFunc(func(_ http.ResponseWriter, r *http.Request) {
		select {
		case <-r.Context().Done():
		case <-time.After(5 * time.Second):
		}
	}))
	defer srv.Close()

	ctx, cancel := context.WithCancel(context.Background())
	time.AfterFunc(100*time.Millisecond, cancel)
	start := time.Now()
	_, err := New(DefaultTimeout).SendRequest(ctx, RequestSpec{URL: srv.URL})
	if err == nil || err.Error() != "request cancelled" {
		t.Fatalf("err = %v, want \"request cancelled\"", err)
	}
	if time.Since(start) > 2*time.Second {
		t.Errorf("cancellation took %s", time.Since(start))
	}
}
