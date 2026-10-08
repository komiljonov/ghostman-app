package main

import (
	"context"
	"encoding/json"
	"io"
	"net/http"
	"net/http/httptest"
	"os"
	"path/filepath"
	"strings"
	"sync/atomic"
	"testing"

	"github.com/wailsapp/wails/v2/pkg/runtime"

	"ghostman/internal/api"
)

// jsonTarget serves /data (version n: n*10 items) and /page (HTML).
func jsonTarget(t *testing.T, version *atomic.Int64) *httptest.Server {
	t.Helper()
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.URL.Path == "/page" {
			w.Header().Set("Content-Type", "text/html")
			_, _ = w.Write([]byte("<h1>not json</h1>"))
			return
		}
		n := int(version.Load()) * 10
		items := make([]map[string]any, n)
		for i := range items {
			items[i] = map[string]any{"id": i, "revenue": i * 100}
		}
		w.Header().Set("Content-Type", "application/json")
		_ = json.NewEncoder(w).Encode(map[string]any{"data": items})
	}))
	t.Cleanup(srv.Close)
	return srv
}

func send(t *testing.T, a *App, tab, url string) {
	t.Helper()
	if r := a.SendRequest("p1", tab, api.RequestDraft{Method: "GET", URL: url}, SendOptions{RequestName: "Analytics"}); r.Error != nil {
		t.Fatal(r.Error.Message)
	}
}

func TestEvalResponseFilterAndCacheInvalidation(t *testing.T) {
	var version atomic.Int64
	version.Store(12) // 120 items
	srv := jsonTarget(t, &version)
	a := newTestApp(t, true, nil)

	if r := a.EvalResponseFilter("r1", ".data"); r.Error != "send the request first" {
		t.Fatalf("no response: %+v", r)
	}
	send(t, a, "r1", srv.URL+"/data")
	r := a.EvalResponseFilter("r1", ".data[] | select(.revenue > 1000) | .id")
	if r.Error != "" || r.Count != 109 || !strings.HasPrefix(r.MatchedNote, "109 results · ") {
		t.Fatalf("filter = %+v", r)
	}
	if e := a.EvalResponseFilter("r1", ".data[] | select("); e.Error == "" || e.ResultJSON != "" {
		t.Fatalf("syntax error expected: %+v", e)
	}
	if empty := a.EvalResponseFilter("r1", "   "); empty != (FilterResult{}) {
		t.Fatalf("blank query = %+v", empty)
	}
	// A re-send replaces the cached parse: the result follows the new body.
	version.Store(2) // 20 items
	send(t, a, "r1", srv.URL+"/data")
	if r := a.EvalResponseFilter("r1", ".data | length"); strings.TrimSpace(r.ResultJSON) != "20" {
		t.Fatalf("stale parse after resend: %+v", r)
	}
	// Not JSON.
	send(t, a, "r2", srv.URL+"/page")
	if r := a.EvalResponseFilter("r2", "."); r.Error != "the response is not JSON" {
		t.Fatalf("html: %+v", r)
	}
	// A closed tab has nothing to filter.
	a.ReleaseResponse("r1")
	if r := a.EvalResponseFilter("r1", "."); r.Error != "send the request first" {
		t.Fatalf("released: %+v", r)
	}
}

func TestCopyAndSaveUseTheWholeResult(t *testing.T) {
	var version atomic.Int64
	version.Store(5000) // 50 000 items: the filtered result is far over the 256 KB preview
	srv := jsonTarget(t, &version)
	a := newTestApp(t, true, map[string]http.HandlerFunc{
		"GET /api/v1/requests/{id}": func(w http.ResponseWriter, _ *http.Request) {
			_, _ = w.Write([]byte(`{"id":"r1","project_id":"p1","name":"Analytics","method":"GET","url":""}`))
		},
	})
	send(t, a, "r1", srv.URL+"/data")
	shown := a.EvalResponseFilter("r1", ".data[]")
	if !shown.Truncated || len(shown.ResultJSON) > 256*1024 || !strings.Contains(shown.MatchedNote, "showing the first 256.0 KB") {
		t.Fatalf("preview not capped: truncated=%v len=%d note=%q", shown.Truncated, len(shown.ResultJSON), shown.MatchedNote)
	}
	var copied string
	a.clipboard = func(_ context.Context, text string) error { copied = text; return nil }
	if r := a.CopyFilteredResult("r1", ".data[]"); r.Error != nil {
		t.Fatal(r.Error.Message)
	}
	var items []any
	if json.Unmarshal([]byte(copied), &items) != nil || len(items) != 50_000 || !strings.HasPrefix(copied, shown.ResultJSON[:1000]) {
		t.Fatalf("copied %d bytes, %d items", len(copied), len(items))
	}
	dir := t.TempDir()
	var offered string
	a.saveDialog = func(_ context.Context, o runtime.SaveDialogOptions) (string, error) {
		offered = o.DefaultFilename
		return filepath.Join(dir, o.DefaultFilename), nil
	}
	res := a.SaveFilteredResponseToFile("r1", ".data[]")
	if res.Error != nil || offered != "Analytics filtered.json" {
		t.Fatalf("save: %+v offered %q", res.Error, offered)
	}
	got, _ := os.ReadFile(res.Data.Path)
	if string(got) != copied || res.Data.BytesWritten != int64(len(copied)) {
		t.Fatal("saved file differs from the copied result")
	}
	// A string result is saved as text.
	a.SaveFilteredResponseToFile("r1", `"total: \(.data | length)"`)
	if offered != "Analytics filtered.txt" {
		t.Fatalf("text result offered %q", offered)
	}
	if r := a.CopyFilteredResult("r1", ".data["); r.Error == nil {
		t.Fatal("a broken query must not copy")
	}
}

func TestEvalHistoryFilter(t *testing.T) {
	var version atomic.Int64
	version.Store(3)
	srv := jsonTarget(t, &version)
	a := newTestApp(t, true, nil)
	send(t, a, "r1", srv.URL+"/data")
	version.Store(1)
	send(t, a, "r1", srv.URL+"/data")
	rows := historyRows(t, a) // newest first: 10 items, then 30
	newest, older := rows[0].ID, rows[1].ID
	for id, want := range map[int64]string{newest: "10", older: "30", newest + 0: "10"} {
		if r := a.EvalHistoryFilter(id, ".data | length"); strings.TrimSpace(r.ResultJSON) != want {
			t.Fatalf("entry %d: %+v, want %s", id, r, want)
		}
	}
	if r := a.EvalHistoryFilter(99999, "."); r.Error != "this history entry no longer exists" {
		t.Fatalf("missing: %+v", r)
	}
	a.SendRequest("p1", "r9", api.RequestDraft{Method: "GET", URL: "http://127.0.0.1:1/x"}, SendOptions{}) // fails: recorded
	if r := a.EvalHistoryFilter(historyRows(t, a)[0].ID, "."); !strings.Contains(r.Error, "failed") {
		t.Fatalf("failed send: %+v", r)
	}
	var copied string
	a.clipboard = func(_ context.Context, text string) error { copied = text; return nil }
	if r := a.CopyHistoryFilteredResult(older, ".data[0]"); r.Error != nil || !strings.Contains(copied, `"revenue": 0`) {
		t.Fatalf("history copy: %+v %q", r.Error, copied)
	}
}

func TestResponseFilterRidesTheAutosave(t *testing.T) {
	var body string
	a := newTestApp(t, true, map[string]http.HandlerFunc{
		"PATCH /api/v1/requests/{id}": func(w http.ResponseWriter, r *http.Request) {
			b, _ := io.ReadAll(r.Body)
			body = string(b)
			_, _ = w.Write([]byte(`{"id":"r1","project_id":"p1","name":"R","method":"GET","url":"u","response_filter":".data[]"}`))
		},
	})
	base := api.RequestDraft{Method: "GET", URL: "u", Body: api.RequestBody{Type: api.BodyNone}}
	draft := base
	draft.ResponseFilter = `.data[] | select(.status=="failed")`
	if r := a.SaveRequest("r1", base, draft); r.Error != nil {
		t.Fatal(r.Error.Message)
	}
	if body != `{"response_filter":".data[] | select(.status==\"failed\")"}` {
		t.Fatalf("patch = %s", body)
	}
	// Clearing sends "" (the server clears it); unchanged sends nothing.
	cleared := draft
	cleared.ResponseFilter = ""
	a.SaveRequest("r1", draft, cleared)
	if body != `{"response_filter":""}` {
		t.Fatalf("clear patch = %s", body)
	}
	body = ""
	a.SaveRequest("r1", cleared, cleared)
	if body != "" {
		t.Fatalf("no change must send nothing, sent %s", body)
	}
}
