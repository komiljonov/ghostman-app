package api

import (
	"bytes"
	"context"
	"encoding/base64"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"net/http"
	"net/http/httptest"
	"reflect"
	"sync"
	"testing"
)

func TestWebhookEndpoints(t *testing.T) {
	ctx := context.Background()
	const hook = `{"id":"w1","project_id":"p1","name":"Payme","slug":"ab12cd34ef","domain":"","resp_status":200,
		"resp_headers":null,"resp_body":"","created_by":"u1","created_at":"x"}`
	tests := []struct {
		name                 string
		status               int
		resp                 string
		call                 func(c *APIClient) (any, error)
		wantMethod, wantPath string
		wantRaw              string
		want                 any
	}{
		{
			name: "meta", status: 200, resp: `{"hooks_domains":["hooks.test","alt.test"]}`,
			call:       func(c *APIClient) (any, error) { return c.GetMeta(ctx) },
			wantMethod: "GET", wantPath: "/api/v1/meta",
			want: Meta{HooksDomains: []string{"hooks.test", "alt.test"}},
		},
		{
			name: "meta without domains is an empty list", status: 200, resp: `{"hooks_domains":null}`,
			call:       func(c *APIClient) (any, error) { return c.GetMeta(ctx) },
			wantMethod: "GET", wantPath: "/api/v1/meta",
			want: Meta{HooksDomains: []string{}},
		},
		{
			name: "create without a domain omits it", status: 201, resp: hook,
			call: func(c *APIClient) (any, error) {
				w, err := c.CreateWebhook(ctx, "p1", NewWebhook{Name: "Payme"})
				return w.RespHeaders, err
			},
			wantMethod: "POST", wantPath: "/api/v1/projects/p1/webhooks", wantRaw: `{"name":"Payme"}`,
			want: []KeyValue{},
		},
		{
			name: "create with a domain", status: 201, resp: hook,
			call: func(c *APIClient) (any, error) {
				d := "alt.test"
				w, err := c.CreateWebhook(ctx, "p1", NewWebhook{Name: "Payme", Domain: &d})
				return w.Slug, err
			},
			wantMethod: "POST", wantPath: "/api/v1/projects/p1/webhooks", wantRaw: `{"name":"Payme","domain":"alt.test"}`,
			want: "ab12cd34ef",
		},
		{
			name: "list", status: 200, resp: `[{"id":"w1","name":"Payme","slug":"ab12cd34ef","domain":"","resp_status":201,"created_at":"x"}]`,
			call:       func(c *APIClient) (any, error) { return c.ListWebhooks(ctx, "p1") },
			wantMethod: "GET", wantPath: "/api/v1/projects/p1/webhooks",
			want: []Webhook{{ID: "w1", Name: "Payme", Slug: "ab12cd34ef", RespStatus: 201, CreatedAt: "x"}},
		},
		{
			name: "get", status: 200, resp: hook,
			call:       func(c *APIClient) (any, error) { w, err := c.GetWebhook(ctx, "w1"); return w.ProjectID, err },
			wantMethod: "GET", wantPath: "/api/v1/webhooks/w1", want: "p1",
		},
		{
			name: "update sends only the changed fields; keyless rows dropped", status: 200, resp: hook,
			call: func(c *APIClient) (any, error) {
				st := int32(201)
				rows := []KeyValue{{Key: "X-A", Value: "1", Enabled: false}, {Key: "", Value: "half"}}
				_, err := c.UpdateWebhook(ctx, "w1", WebhookPatch{RespStatus: &st, RespHeaders: &rows})
				return nil, err
			},
			wantMethod: "PATCH", wantPath: "/api/v1/webhooks/w1",
			wantRaw: `{"resp_status":201,"resp_headers":[{"key":"X-A","value":"1","enabled":false}]}`,
		},
		{
			name: "update an empty body is sent", status: 200, resp: hook,
			call: func(c *APIClient) (any, error) {
				empty := ""
				_, err := c.UpdateWebhook(ctx, "w1", WebhookPatch{RespBody: &empty})
				return nil, err
			},
			wantMethod: "PATCH", wantPath: "/api/v1/webhooks/w1", wantRaw: `{"resp_body":""}`,
		},
		{
			name: "delete", status: 204,
			call:       func(c *APIClient) (any, error) { return nil, c.DeleteWebhook(ctx, "w1") },
			wantMethod: "DELETE", wantPath: "/api/v1/webhooks/w1",
		},
		{
			name: "clear captures", status: 204,
			call:       func(c *APIClient) (any, error) { return nil, c.ClearCaptures(ctx, "w1") },
			wantMethod: "DELETE", wantPath: "/api/v1/webhooks/w1/captures",
		},
		{
			name: "get capture decodes the base64 body", status: 200,
			resp: `{"id":7,"method":"POST","path":"/payme/callback","query":"a=1","content_type":"application/json",
				"body_size":11,"body_truncated":false,"source_ip":"10.0.0.1","received_at":"x",
				"headers":[{"key":"Host","value":"hooks.test"},{"key":"X-A","value":"1"},{"key":"X-A","value":"2"}],
				"body":"eyJvayI6dHJ1ZX0="}`,
			call: func(c *APIClient) (any, error) {
				cp, err := c.GetCapture(ctx, "w1", 7)
				return []any{string(cp.Body), len(cp.Headers), cp.Headers[2].Value, cp.Query}, err
			},
			wantMethod: "GET", wantPath: "/api/v1/webhooks/w1/captures/7",
			want: []any{`{"ok":true}`, 3, "2", "a=1"},
		},
		{
			name: "get capture with a null body", status: 200,
			resp: `{"id":8,"method":"GET","path":"/","query":"","content_type":"","body_size":0,"body_truncated":false,
				"source_ip":"x","received_at":"x","headers":null,"body":null}`,
			call: func(c *APIClient) (any, error) {
				cp, err := c.GetCapture(ctx, "w1", 8)
				return []any{cp.Body == nil, cp.Headers}, err
			},
			wantMethod: "GET", wantPath: "/api/v1/webhooks/w1/captures/8",
			want: []any{true, []CapturedHeader{}},
		},
	}
	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			c, rec := replayServer(t, tt.status, tt.resp)
			got, err := tt.call(c)
			if err != nil {
				t.Fatalf("unexpected error: %v", err)
			}
			if rec.method != tt.wantMethod || rec.path != tt.wantPath || rec.auth != "Bearer tok" {
				t.Errorf("request = %s %s (auth %q), want %s %s", rec.method, rec.path, rec.auth, tt.wantMethod, tt.wantPath)
			}
			if rec.raw != tt.wantRaw {
				t.Errorf("body = %s\nwant   %s", rec.raw, tt.wantRaw)
			}
			if tt.want != nil && !reflect.DeepEqual(got, tt.want) {
				t.Errorf("got  %#v\nwant %#v", got, tt.want)
			}
		})
	}
}

func TestListCapturesCursor(t *testing.T) {
	var gotQuery string
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		gotQuery = r.URL.RawQuery
		_, _ = io.WriteString(w, `[{"id":5,"method":"POST","path":"/","query":"","content_type":"text/plain","body_size":2,
			"body_truncated":true,"source_ip":"1.2.3.4","received_at":"x"}]`)
	}))
	t.Cleanup(srv.Close)
	c := New(srv.URL)

	got, err := c.ListCaptures(context.Background(), "w1", 4, 100)
	if err != nil {
		t.Fatal(err)
	}
	if gotQuery != "after=4&limit=100" {
		t.Errorf("query = %q", gotQuery)
	}
	if len(got) != 1 || got[0].ID != 5 || !got[0].BodyTruncated || got[0].SourceIP != "1.2.3.4" {
		t.Errorf("got %+v", got)
	}
	if _, err := c.ListCaptures(context.Background(), "w1", 0, 0); err != nil {
		t.Fatal(err)
	}
	if gotQuery != "" {
		t.Errorf("first poll query = %q, want none", gotQuery)
	}
}

// A stored body of the server's 1 MB cap is ~1.37 MB as base64: over the
// client's default read cap, so GetCapture has its own.
func TestGetCaptureReadsAFullSizeBody(t *testing.T) {
	body := bytes.Repeat([]byte("x"), 1<<20)
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, _ *http.Request) {
		_, _ = fmt.Fprintf(w, `{"id":1,"method":"PUT","path":"/","query":"","content_type":"text/plain","body_size":2621440,
			"body_truncated":true,"source_ip":"x","received_at":"x","headers":[],"body":%q}`, base64.StdEncoding.EncodeToString(body))
	}))
	t.Cleanup(srv.Close)
	got, err := New(srv.URL).GetCapture(context.Background(), "w1", 1)
	if err != nil {
		t.Fatal(err)
	}
	if !bytes.Equal(got.Body, body) || !got.BodyTruncated {
		t.Fatalf("body %d bytes, truncated %v", len(got.Body), got.BodyTruncated)
	}
}

func TestWebhookErrorsReachTheCallerVerbatim(t *testing.T) {
	for _, tt := range []struct {
		status int
		msg    string
	}{
		{409, "a project can have at most 20 webhook endpoints"},
		{409, "webhook capture is not configured on this server (HOOKS_DOMAINS)"},
		{400, "domain must be one of hooks.test, alt.test, or empty for the default (hooks.test)"},
	} {
		c, _ := replayServer(t, tt.status, `{"error":{"code":"conflict","message":"`+tt.msg+`"}}`)
		_, err := c.CreateWebhook(context.Background(), "p1", NewWebhook{Name: "x"})
		var apiErr *APIError
		if !errors.As(err, &apiErr) || apiErr.Status != tt.status || apiErr.Message != tt.msg {
			t.Errorf("err = %#v, want %d %q", err, tt.status, tt.msg)
		}
	}
}

func TestCaptureDraft(t *testing.T) {
	d := CaptureDraft(Capture{
		CaptureSummary: CaptureSummary{Method: "post", Path: "/payme/callback", Query: "a=1&b=x=y&&flag", ContentType: "application/json"},
		Headers: []CapturedHeader{
			{Key: "Host", Value: "hooks.test"}, {Key: "Accept-Encoding", Value: "gzip"}, {Key: "Connection", Value: "close"},
			{Key: "content-length", Value: "11"}, {Key: "Authorization", Value: "Bearer t"}, {Key: "X-A", Value: "1"}, {Key: "X-A", Value: "2"},
		},
		Body: []byte(`{"ok":true}`),
	})
	if d.Method != http.MethodPost || d.URL != "/payme/callback" {
		t.Errorf("method/url = %s %s", d.Method, d.URL)
	}
	wantHeaders := []KeyValue{{"Authorization", "Bearer t", true}, {"X-A", "1", true}, {"X-A", "2", true}}
	if !reflect.DeepEqual(d.Headers, wantHeaders) {
		t.Errorf("headers = %+v", d.Headers)
	}
	wantQuery := []KeyValue{{"a", "1", true}, {"b", "x=y", true}, {"flag", "", true}}
	if !reflect.DeepEqual(d.QueryParams, wantQuery) {
		t.Errorf("query = %+v", d.QueryParams)
	}
	if d.Body.Type != BodyRaw || d.Body.ContentType != "application/json" || d.Body.Content != `{"ok":true}` {
		t.Errorf("body = %+v", d.Body)
	}
	if d.Auth.Type != AuthInherit {
		t.Errorf("auth = %+v", d.Auth)
	}

	empty := CaptureDraft(Capture{CaptureSummary: CaptureSummary{Method: "PROPFIND", Path: ""}})
	if empty.Method != http.MethodGet || empty.URL != "/" || empty.Body.Type != BodyNone || len(empty.Headers) != 0 {
		t.Errorf("empty = %+v", empty)
	}
	textNoType := CaptureDraft(Capture{CaptureSummary: CaptureSummary{Method: "PUT", Path: "/x"}, Body: []byte("hi")})
	if textNoType.Body.ContentType != "text/plain" {
		t.Errorf("content type = %q", textNoType.Body.ContentType)
	}
}

// TestCopyCaptureAsRequest runs the composed flow against a fake server:
// GET webhook → GET capture → POST request (root) → PATCH contents.
func TestCopyCaptureAsRequest(t *testing.T) {
	var mu sync.Mutex
	var calls []string
	var created, patch map[string]any
	failPatch := false
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		mu.Lock()
		defer mu.Unlock()
		calls = append(calls, r.Method+" "+r.URL.Path)
		raw, _ := io.ReadAll(r.Body)
		switch r.Method + " " + r.URL.Path {
		case "GET /api/v1/webhooks/w1":
			_, _ = io.WriteString(w, `{"id":"w1","project_id":"p1","name":"Payme ","slug":"s","domain":"","resp_status":200,"resp_headers":[],"resp_body":""}`)
		case "GET /api/v1/webhooks/w1/captures/7":
			_, _ = io.WriteString(w, `{"id":7,"method":"POST","path":"/cb","query":"k=v","content_type":"application/json",
				"headers":[{"key":"Host","value":"hooks.test"},{"key":"Content-Length","value":"2"},{"key":"X-Sig","value":"abc"}],
				"body":"e30="}`)
		case "POST /api/v1/projects/p1/requests":
			_ = json.Unmarshal(raw, &created)
			w.WriteHeader(http.StatusCreated)
			_, _ = io.WriteString(w, `{"id":"r9","project_id":"p1","folder_id":null,"name":"Payme capture","method":"POST"}`)
		case "PATCH /api/v1/requests/r9":
			_ = json.Unmarshal(raw, &patch)
			if failPatch {
				w.WriteHeader(http.StatusBadRequest)
				_, _ = io.WriteString(w, `{"error":{"code":"bad_request","message":"headers[0].value is too long"}}`)
				return
			}
			_, _ = io.WriteString(w, `{"id":"r9","project_id":"p1","folder_id":null,"name":"Payme capture","method":"POST"}`)
		case "DELETE /api/v1/requests/r9":
			w.WriteHeader(http.StatusNoContent)
		default:
			w.WriteHeader(http.StatusNotFound)
		}
	}))
	t.Cleanup(srv.Close)
	c := New(srv.URL)

	got, err := c.CopyCaptureAsRequest(context.Background(), "w1", 7)
	if err != nil {
		t.Fatal(err)
	}
	if got.ID != "r9" {
		t.Errorf("got %+v", got)
	}
	if created["name"] != "Payme capture" || created["folder_id"] != nil || created["url"] != "/cb" || created["method"] != "POST" {
		t.Errorf("create = %v", created)
	}
	headers, _ := json.Marshal(patch["headers"])
	if string(headers) != `[{"enabled":true,"key":"X-Sig","value":"abc"}]` {
		t.Errorf("patched headers = %s", headers)
	}
	body, _ := json.Marshal(patch["body"])
	if string(body) != `{"content":"{}","content_type":"application/json","type":"raw"}` {
		t.Errorf("patched body = %s", body)
	}
	query, _ := json.Marshal(patch["query_params"])
	if string(query) != `[{"enabled":true,"key":"k","value":"v"}]` {
		t.Errorf("patched query = %s", query)
	}

	// A rejected contents PATCH deletes the half-made request and returns its error.
	calls, failPatch = nil, true
	_, err = c.CopyCaptureAsRequest(context.Background(), "w1", 7)
	var apiErr *APIError
	if !errors.As(err, &apiErr) || apiErr.Message != "headers[0].value is too long" {
		t.Fatalf("err = %v", err)
	}
	if last := calls[len(calls)-1]; last != "DELETE /api/v1/requests/r9" {
		t.Errorf("calls = %v", calls)
	}
}
