package engine

import (
	"context"
	"io"
	"net"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
	"time"
)

func TestSendRequest_Basic(t *testing.T) {
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.Header.Get("X-On") != "yes" || r.Header.Get("X-Off") != "" {
			http.Error(w, "header filtering broken", http.StatusBadRequest)
			return
		}
		body, _ := io.ReadAll(r.Body)
		w.Header().Set("Content-Type", "text/plain")
		w.WriteHeader(http.StatusCreated)
		_, _ = w.Write([]byte(r.Method + " " + string(body)))
	}))
	defer srv.Close()

	resp, err := New(DefaultTimeout).SendRequest(context.Background(), RequestSpec{
		Method: "post",
		URL:    srv.URL,
		Headers: []Header{
			{Key: "X-On", Value: "yes", Enabled: true},
			{Key: "X-Off", Value: "no", Enabled: false},
		},
		Body: Body{Type: BodyRaw, ContentType: "text/plain", Content: "hello"},
	})
	if err != nil {
		t.Fatalf("unexpected error: %v", err)
	}
	if resp.Status != http.StatusCreated || resp.StatusText != "Created" {
		t.Errorf("status = %d %q", resp.Status, resp.StatusText)
	}
	if resp.Body != "POST hello" || resp.BodySize != int64(len("POST hello")) || resp.Truncated {
		t.Errorf("body = %q size=%d truncated=%v", resp.Body, resp.BodySize, resp.Truncated)
	}
	if resp.Proto != "HTTP/1.1" {
		t.Errorf("proto = %q", resp.Proto)
	}
	if !hasHeader(resp.Headers, "Content-Type", "text/plain") {
		t.Errorf("missing Content-Type header in %v", resp.Headers)
	}
}

func TestSendRequest_TruncatesLargeBody(t *testing.T) {
	const size = MaxBodyPreview*3 + 17
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, _ *http.Request) {
		_, _ = w.Write([]byte(strings.Repeat("a", size)))
	}))
	defer srv.Close()

	resp, err := New(DefaultTimeout).SendRequest(context.Background(), RequestSpec{URL: srv.URL})
	if err != nil {
		t.Fatalf("unexpected error: %v", err)
	}
	if !resp.Truncated || len(resp.Body) != MaxBodyPreview || resp.BodySize != size {
		t.Errorf("truncated=%v len(body)=%d size=%d", resp.Truncated, len(resp.Body), resp.BodySize)
	}
}

func TestSendRequest_TruncationKeepsValidUTF8(t *testing.T) {
	// "é" is 2 bytes; an odd prefix makes the 256 KB cut land mid-rune.
	payload := "x" + strings.Repeat("é", MaxBodyPreview)
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, _ *http.Request) {
		_, _ = w.Write([]byte(payload))
	}))
	defer srv.Close()

	resp, err := New(DefaultTimeout).SendRequest(context.Background(), RequestSpec{URL: srv.URL})
	if err != nil {
		t.Fatalf("unexpected error: %v", err)
	}
	if len(resp.Body) != MaxBodyPreview-1 || strings.ContainsRune(resp.Body, '�') {
		t.Errorf("len(body)=%d, want %d with no replacement chars", len(resp.Body), MaxBodyPreview-1)
	}
}

func TestSendRequest_Errors(t *testing.T) {
	// Grab a free port, then close it so connecting is refused.
	ln, err := net.Listen("tcp", "127.0.0.1:0")
	if err != nil {
		t.Fatal(err)
	}
	closedAddr := ln.Addr().String()
	_ = ln.Close()

	slow := httptest.NewServer(http.HandlerFunc(func(_ http.ResponseWriter, r *http.Request) {
		select {
		case <-r.Context().Done():
		case <-time.After(5 * time.Second):
		}
	}))
	defer slow.Close()

	tests := []struct {
		name    string
		url     string
		timeout time.Duration
		want    string
	}{
		{"empty", "  ", DefaultTimeout, "enter a URL"},
		{"no scheme", "example.com/path", DefaultTimeout, "must start with http:// or https://"},
		{"bad scheme", "ftp://example.com", DefaultTimeout, "must start with http:// or https://"},
		{"unparsable", "http://[::1", DefaultTimeout, "invalid URL"},
		{"unknown host", "http://ghostman-does-not-exist.invalid", DefaultTimeout, "could not resolve host"},
		{"refused", "http://" + closedAddr, DefaultTimeout, "connection refused"},
		{"timeout", slow.URL, 200 * time.Millisecond, "timed out"},
	}
	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			resp, err := New(tt.timeout).SendRequest(context.Background(), RequestSpec{Method: "GET", URL: tt.url})
			if err == nil {
				t.Fatalf("expected error, got response %+v", resp)
			}
			if !strings.Contains(err.Error(), tt.want) {
				t.Errorf("error = %q, want it to contain %q", err, tt.want)
			}
		})
	}
}

func hasHeader(hs []Header, key, value string) bool {
	for _, h := range hs {
		if h.Key == key && h.Value == value {
			return true
		}
	}
	return false
}
