package main

import (
	"bytes"
	"context"
	"encoding/json"
	"io"
	"net/http"
	"net/http/httptest"
	"os"
	"path/filepath"
	"strings"
	"sync"
	"testing"

	"github.com/wailsapp/wails/v2/pkg/runtime"

	"ghostman/internal/api"
	"ghostman/internal/engine"
	"ghostman/internal/session"
)

// fakeExamples is the server's examples API in memory; every write's JSON body
// is recorded.
type fakeExamples struct {
	mu      sync.Mutex
	byID    map[string]*api.Example
	order   map[string][]string // request id -> example ids
	writes  []string            // "METHOD path body"
	missing map[string]bool     // request ids answered with 404
}

func (f *fakeExamples) routes() map[string]http.HandlerFunc {
	f.byID, f.order = map[string]*api.Example{}, map[string][]string{}
	write := func(w http.ResponseWriter, v any) { _ = json.NewEncoder(w).Encode(v) }
	rec := func(r *http.Request) []byte {
		b, _ := io.ReadAll(r.Body)
		f.writes = append(f.writes, r.Method+" "+r.URL.Path+" "+string(b))
		return b
	}
	return map[string]http.HandlerFunc{
		"POST /api/v1/requests/{rid}/examples": func(w http.ResponseWriter, r *http.Request) {
			f.mu.Lock()
			defer f.mu.Unlock()
			b := rec(r)
			rid := r.PathValue("rid")
			if f.missing[rid] {
				w.WriteHeader(http.StatusNotFound)
				_, _ = io.WriteString(w, `{"error":{"code":"not_found","message":"request not found"}}`)
				return
			}
			var in api.NewExample
			_ = json.Unmarshal(b, &in)
			id := "e" + itoa(len(f.byID)+1)
			e := &api.Example{ID: id, RequestID: rid, Name: in.Name, Status: in.Status, Headers: in.Headers,
				ContentType: in.ContentType, Body: in.Body, BodySize: int32(len(in.Body)), UpdatedAt: "t1"}
			f.byID[id] = e
			f.order[rid] = append(f.order[rid], id)
			w.WriteHeader(http.StatusCreated)
			write(w, e)
		},
		"GET /api/v1/requests/{rid}/examples": func(w http.ResponseWriter, r *http.Request) {
			f.mu.Lock()
			defer f.mu.Unlock()
			out := []api.ExampleSummary{}
			for i, id := range f.order[r.PathValue("rid")] {
				e := f.byID[id]
				out = append(out, api.ExampleSummary{ID: id, Name: e.Name, Status: e.Status, ContentType: e.ContentType,
					BodySize: int32(len(e.Body)), SortOrder: int32(i), UpdatedAt: e.UpdatedAt})
			}
			write(w, out)
		},
		"GET /api/v1/examples/{id}": func(w http.ResponseWriter, r *http.Request) {
			f.mu.Lock()
			defer f.mu.Unlock()
			write(w, f.byID[r.PathValue("id")])
		},
		"PATCH /api/v1/examples/{id}": func(w http.ResponseWriter, r *http.Request) {
			f.mu.Lock()
			defer f.mu.Unlock()
			b := rec(r)
			e := f.byID[r.PathValue("id")]
			var p api.ExamplePatch
			_ = json.Unmarshal(b, &p)
			if p.Name != nil {
				e.Name = *p.Name
			}
			if p.Status != nil {
				e.Status = *p.Status
			}
			if p.Headers != nil {
				e.Headers = *p.Headers
			}
			if p.ContentType != nil {
				e.ContentType = *p.ContentType
			}
			if p.Body != nil {
				e.Body = *p.Body
			}
			e.UpdatedAt += "+"
			write(w, e)
		},
		"PUT /api/v1/examples/order": func(w http.ResponseWriter, r *http.Request) {
			f.mu.Lock()
			defer f.mu.Unlock()
			b := rec(r)
			var in struct {
				RequestID  string   `json:"request_id"`
				ExampleIDs []string `json:"example_ids"`
			}
			_ = json.Unmarshal(b, &in)
			f.order[in.RequestID] = in.ExampleIDs
			w.WriteHeader(http.StatusNoContent)
		},
		"DELETE /api/v1/examples/{id}": func(w http.ResponseWriter, r *http.Request) {
			f.mu.Lock()
			defer f.mu.Unlock()
			rec(r)
			delete(f.byID, r.PathValue("id"))
			w.WriteHeader(http.StatusNoContent)
		},
	}
}

func itoa(n int) string { b, _ := json.Marshal(n); return string(b) }

func examplesApp(t *testing.T) (*App, *fakeExamples) {
	t.Helper()
	f := &fakeExamples{missing: map[string]bool{}}
	return newTestApp(t, true, f.routes()), f
}

func TestSaveExampleFromTheHeldResponse(t *testing.T) {
	a, f := examplesApp(t)
	body := []byte(`{"slideshow":{"title":"Sample"}}`)
	a.responses.put("r1", heldBody{projectID: "p1", data: body, contentType: "application/json", status: 200,
		headers: []engine.Header{{Key: "Content-Type", Value: "application/json"}, {Key: "X-Trace", Value: "abc"}}})
	src := ExampleSource{Kind: "response", TabID: "r1"}

	d := a.PrepareExample(src)
	if d.Error != nil || d.Data.DefaultName != "200 response" || d.Data.RequestID != "r1" || d.Data.Size != int64(len(body)) {
		t.Fatalf("prepare = %+v %+v", d.Data, d.Error)
	}
	if r := a.SaveExample(src, "  "); r.Error == nil {
		t.Fatal("an empty name must be refused")
	}
	r := a.SaveExample(src, " Happy path ")
	if r.Error != nil || r.Data.Name != "Happy path" {
		t.Fatalf("save = %+v %+v", r.Data, r.Error)
	}
	e := f.byID[r.Data.ID]
	if !bytes.Equal(e.Body, body) || e.Status != 200 || e.ContentType != "application/json" || len(e.Headers) != 2 ||
		!e.Headers[1].Enabled || e.Headers[1].Key != "X-Trace" {
		t.Fatalf("stored = %+v", e)
	}

	// Nothing held for the tab (never sent, failed send, closed).
	if p := a.PrepareExample(ExampleSource{Kind: "response", TabID: "nope"}); p.Error == nil {
		t.Fatal("no response must be refused")
	}
	// The request is gone on the server.
	f.missing["r2"] = true
	a.responses.put("r2", heldBody{data: []byte("x"), status: 200})
	if r := a.SaveExample(ExampleSource{Kind: "response", TabID: "r2"}, "x"); r.Error == nil || !strings.Contains(r.Error.Message, "no longer exists") {
		t.Fatalf("gone request: %+v", r.Error)
	}
}

func TestExampleCapRefusals(t *testing.T) {
	a, f := examplesApp(t)
	a.responses.put("big", heldBody{data: bytes.Repeat([]byte("x"), api.MaxExampleBody+1), status: 200})
	a.responses.put("cut", heldBody{data: []byte("x"), capped: true, status: 200}) // cut at the retention cap
	a.responses.put("exact", heldBody{data: bytes.Repeat([]byte("y"), api.MaxExampleBody), status: 200})
	for _, tab := range []string{"big", "cut"} {
		src := ExampleSource{Kind: "response", TabID: tab}
		for _, p := range []*session.Problem{a.PrepareExample(src).Error, a.SaveExample(src, "n").Error} {
			if p == nil || p.Code != CodeExampleTooLarge || p.Message != "response too large for an example (1MB limit) — use Save to file" {
				t.Errorf("%s: %+v", tab, p)
			}
		}
	}
	if len(f.writes) != 0 {
		t.Fatalf("a refused body reached the server: %d writes", len(f.writes))
	}
	if r := a.SaveExample(ExampleSource{Kind: "response", TabID: "exact"}, "n"); r.Error != nil {
		t.Fatalf("exactly 1 MB must save: %v", r.Error.Message)
	}
}

func TestSaveExampleFromHistory(t *testing.T) {
	a, f := examplesApp(t)
	png := append([]byte("\x89PNG\r\n\x1a\n"), bytes.Repeat([]byte{0}, 64)...)
	target := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.URL.Path == "/big" {
			_, _ = w.Write(bytes.Repeat([]byte("z"), 2<<20))
			return
		}
		w.Header().Set("Content-Type", "image/png")
		w.WriteHeader(http.StatusCreated)
		_, _ = w.Write(png)
	}))
	defer target.Close()
	draft := api.RequestDraft{Method: "GET", URL: target.URL + "/img", Body: api.RequestBody{Type: api.BodyNone}}
	if res := a.SendRequest("p1", "r1", draft, SendOptions{RequestName: "R"}); res.Error != nil {
		t.Fatal(res.Error.Message)
	}
	h := historyRows(t, a)[0].ID
	d := a.PrepareExample(ExampleSource{Kind: "history", HistoryID: h})
	if d.Error != nil || d.Data.DefaultName != "201 response" || d.Data.RequestID != "r1" {
		t.Fatalf("prepare = %+v %+v", d.Data, d.Error)
	}
	r := a.SaveExample(ExampleSource{Kind: "history", HistoryID: h}, "Logo")
	if r.Error != nil || !bytes.Equal(f.byID[r.Data.ID].Body, png) || f.byID[r.Data.ID].ContentType != "image/png" {
		t.Fatalf("save = %+v %+v", r.Data, r.Error)
	}

	// A history body cut at history_max_response_bytes is refused like an over-cap one.
	if p := a.SetHistoryMaxResponseBytes(1 << 20); p.Error != nil {
		t.Fatal(p.Error.Message)
	}
	big := draft
	big.URL = target.URL + "/big"
	a.SendRequest("p1", "r1", big, SendOptions{})
	if p := a.PrepareExample(ExampleSource{Kind: "history", HistoryID: historyRows(t, a)[0].ID}); p.Error == nil || p.Error.Code != CodeExampleTooLarge {
		t.Fatalf("truncated history body: %+v", p.Error)
	}
	// A failed send has no response.
	bad := draft
	bad.URL = "http://127.0.0.1:1/"
	a.SendRequest("p1", "r1", bad, SendOptions{})
	if p := a.PrepareExample(ExampleSource{Kind: "history", HistoryID: historyRows(t, a)[0].ID}); p.Error == nil {
		t.Fatal("a failed send must be refused")
	}
}

func TestExampleDetailEditAndOrder(t *testing.T) {
	a, f := examplesApp(t)
	// Two sends of the same request, each saved: a JSON and a PNG example.
	a.responses.put("r1", heldBody{data: []byte(`{"a":1}`), contentType: "application/json", status: 200})
	j := a.SaveExample(ExampleSource{Kind: "response", TabID: "r1"}, "json").Data
	a.responses.put("r1", heldBody{data: append([]byte("\x89PNG\r\n\x1a\n"), 0, 1, 2), contentType: "image/png", status: 200})
	img := a.SaveExample(ExampleSource{Kind: "response", TabID: "r1"}, "img").Data

	a.examples.clear() // as after a restart: the detail fetches it
	d := a.GetExampleDetail(j.ID).Data
	if d == nil || !d.Formatted || !strings.Contains(d.Body, "\n  \"a\": 1") || d.RawBody != `{"a":1}` || !d.Text || d.Media != "" {
		t.Fatalf("json detail = %+v", d)
	}
	m := a.GetExampleDetail(img.ID).Data
	if m.Media != engine.MediaImage || m.Body != "" || m.Text || !strings.HasPrefix(m.MediaURL, "/example-media/"+img.ID+"?v=") {
		t.Fatalf("media detail = %+v", m)
	}
	// The media route streams the opened example.
	rec := httptest.NewRecorder()
	a.mediaMiddleware(http.NotFoundHandler()).ServeHTTP(rec, httptest.NewRequest(http.MethodGet, m.MediaURL, nil))
	if rec.Code != http.StatusOK || rec.Header().Get("Content-Type") != "image/png" || !bytes.HasPrefix(rec.Body.Bytes(), []byte("\x89PNG")) {
		t.Fatalf("media route: %d %q", rec.Code, rec.Header().Get("Content-Type"))
	}
	if b := a.GetExampleEditBody(img.ID); b.Error == nil {
		t.Fatal("a binary body is not editable as text")
	}
	if b := a.GetExampleEditBody(j.ID); b.Error != nil || b.Data.Text != `{"a":1}` {
		t.Fatalf("edit body = %+v", b)
	}

	// Edit: only what changed goes out; the body only when given and different.
	f.writes = nil
	next := ExampleInput{Name: "json", Status: 201, Headers: []api.KeyValue{}, ContentType: "application/json"}
	if r := a.UpdateExample(j.ID, next); r.Error != nil || r.Data.Status != 201 {
		t.Fatalf("status edit: %+v", r)
	}
	text := `{"a":2}`
	next.Body = &text
	next.Headers = []api.KeyValue{{Key: "X-A", Value: "1", Enabled: true}, {Key: " ", Value: "keyless"}}
	a.UpdateExample(j.ID, next)
	a.UpdateExample(j.ID, next) // unchanged: no request
	if len(f.writes) != 2 || !strings.HasSuffix(f.writes[0], `{"status":201}`) ||
		!strings.HasSuffix(f.writes[1], `{"headers":[{"key":"X-A","value":"1","enabled":true}],"body":"eyJhIjoyfQ=="}`) {
		t.Fatalf("patches = %v", f.writes)
	}
	if string(f.byID[j.ID].Body) != text {
		t.Fatalf("body = %s", f.byID[j.ID].Body)
	}
	// A binary example's body is never touched by an edit (Body nil).
	f.writes = nil
	a.UpdateExample(img.ID, ExampleInput{Name: "img2", Status: 200, Headers: []api.KeyValue{}, ContentType: "image/png"})
	if len(f.writes) != 1 || !strings.HasSuffix(f.writes[0], `{"name":"img2"}`) {
		t.Fatalf("binary edit = %v", f.writes)
	}
	for _, bad := range []ExampleInput{{Name: " ", Status: 200, ContentType: "image/png"}, {Name: "img2", Status: 99, ContentType: "image/png"}} {
		if r := a.UpdateExample(img.ID, bad); r.Error == nil {
			t.Errorf("invalid input accepted: %+v", bad)
		}
	}

	// Reorder: one place, from the server's current order; edges are no-ops.
	if r := a.MoveExample("r1", img.ID, -1); r.Error != nil {
		t.Fatal(r.Error.Message)
	}
	if strings.Join(f.order["r1"], ",") != img.ID+","+j.ID {
		t.Fatalf("order = %v", f.order["r1"])
	}
	n := len(f.writes)
	a.MoveExample("r1", img.ID, -1)
	if len(f.writes) != n {
		t.Fatal("moving the first one up must not call the server")
	}
	if r := a.DeleteExample(j.ID); r.Error != nil {
		t.Fatal(r.Error.Message)
	}
	if _, ok := a.examples.get(j.ID); ok {
		t.Fatal("a deleted example must leave the cache")
	}
}

func TestSaveExampleBodyToFile(t *testing.T) {
	a, _ := examplesApp(t)
	png := append([]byte("\x89PNG\r\n\x1a\n"), 9, 8, 7)
	a.responses.put("r1", heldBody{data: png, contentType: "image/png", status: 200})
	e := a.SaveExample(ExampleSource{Kind: "response", TabID: "r1"}, "Logo").Data
	a.examples.clear() // the file comes from the server copy, fetched on demand
	path := filepath.Join(t.TempDir(), "out.png")
	var offered string
	a.saveDialog = func(_ context.Context, opts runtime.SaveDialogOptions) (string, error) {
		offered = opts.DefaultFilename
		return path, nil
	}
	r := a.SaveExampleBodyToFile(e.ID)
	got, err := os.ReadFile(path)
	if r.Error != nil || err != nil || !bytes.Equal(got, png) || r.Data.BytesWritten != int64(len(png)) || offered != "Logo.png" {
		t.Fatalf("save = %+v %v, offered %q", r, err, offered)
	}
	a.saveDialog = func(context.Context, runtime.SaveDialogOptions) (string, error) { return "", nil }
	if r := a.SaveExampleBodyToFile(e.ID); r.Error != nil || r.Data != nil {
		t.Fatalf("cancel = %+v", r)
	}
}
