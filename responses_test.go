package main

import (
	"bytes"
	"context"
	"errors"
	"net/http"
	"net/http/httptest"
	"os"
	"path/filepath"
	"testing"

	"github.com/wailsapp/wails/v2/pkg/runtime"

	"ghostman/internal/api"
	"ghostman/internal/engine"
)

// bodyTarget serves a large binary body, or a small JSON one at /json.
func bodyTarget(t *testing.T, size int) *httptest.Server {
	t.Helper()
	payload := bytes.Repeat([]byte{0x01, 0xfe, 'q', 0x00}, size/4+1)[:size]
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.URL.Path == "/json" {
			w.Header().Set("Content-Type", "application/json; charset=utf-8")
			_, _ = w.Write([]byte(`{"token":"abc","n":[1,2,3]}`))
			return
		}
		w.Header().Set("Content-Type", "application/octet-stream")
		_, _ = w.Write(payload)
	}))
	t.Cleanup(srv.Close)
	return srv
}

// namedRequest answers GET /requests/{id} with a name, for the default file name.
func namedRequest(name string) map[string]http.HandlerFunc {
	return map[string]http.HandlerFunc{
		"GET /api/v1/requests/{id}": func(w http.ResponseWriter, _ *http.Request) {
			_, _ = w.Write([]byte(`{"id":"r1","project_id":"p1","name":"` + name + `","method":"GET","url":""}`))
		},
	}
}

func TestFullBodyRetainedPerTabAndReplacedOnResend(t *testing.T) {
	const size = 1 << 20 // 1 MB: past the 256 KB preview
	target := bodyTarget(t, size)
	a := newTestApp(t, true, nil)

	res := a.SendRequest("p1", "r1", api.RequestDraft{Method: "GET", URL: target.URL + "/bin"}, true)
	if res.Error != nil || !res.Data.Truncated || len(res.Data.Body) > engine.MaxBodyPreview {
		t.Fatalf("preview must stay capped: %+v", res.Error)
	}
	held, ok := a.responses.get("r1")
	if !ok || len(held.data) != size || held.capped || held.contentType != "application/octet-stream" {
		t.Fatalf("held: ok=%v len=%d capped=%v ct=%q", ok, len(held.data), held.capped, held.contentType)
	}

	// The next send replaces it.
	a.SendRequest("p1", "r1", api.RequestDraft{Method: "GET", URL: target.URL + "/json"}, true)
	held, _ = a.responses.get("r1")
	if string(held.data) != `{"token":"abc","n":[1,2,3]}` {
		t.Fatalf("not replaced: %q", held.data[:min(40, len(held.data))])
	}

	// A failed send leaves no active response.
	a.SendRequest("p1", "r1", api.RequestDraft{Method: "GET", URL: "not a url"}, true)
	if _, ok := a.responses.get("r1"); ok {
		t.Fatal("a failed send must drop the previous body")
	}
}

func TestFullBodyFreedOnTabCloseAndLogout(t *testing.T) {
	target := bodyTarget(t, 1000)
	a := newTestApp(t, true, nil)
	for _, id := range []string{"r1", "r2", "r3"} {
		a.SendRequest("p1", id, api.RequestDraft{Method: "GET", URL: target.URL}, true)
	}
	a.responses.put("o1", heldBody{projectID: "p2", data: []byte("other project")})

	a.ReleaseResponse("r1") // × on the tab
	if _, ok := a.responses.get("r1"); ok || a.responses.size() != 3 {
		t.Fatalf("ReleaseResponse: size=%d", a.responses.size())
	}
	// Close Others / Close All persist the remaining tabs: anything not listed goes.
	a.SetTabs("p1", Tabs{Open: []TabRef{{Kind: TabRequest, ID: "r3"}, {Kind: TabEnv, ID: "r2"}}})
	if _, ok := a.responses.get("r2"); ok {
		t.Fatal("r2 is no longer an open request tab")
	}
	if _, ok := a.responses.get("r3"); !ok {
		t.Fatal("r3 is still open")
	}
	if _, ok := a.responses.get("o1"); !ok {
		t.Fatal("other projects' tabs are untouched")
	}
	a.Logout()
	if a.responses.size() != 0 {
		t.Fatalf("logout must free everything, %d left", a.responses.size())
	}
}

func TestSaveResponseToFileWritesFullBytes(t *testing.T) {
	const size = 1 << 20
	target := bodyTarget(t, size)
	a := newTestApp(t, true, namedRequest(`Get: bytes/1MB?`))
	dir := t.TempDir()
	var asked runtime.SaveDialogOptions
	a.saveDialog = func(_ context.Context, opts runtime.SaveDialogOptions) (string, error) {
		asked = opts
		return filepath.Join(dir, opts.DefaultFilename), nil
	}

	a.SendRequest("p1", "r1", api.RequestDraft{Method: "GET", URL: target.URL}, true)
	res := a.SaveResponseToFile("r1")
	if res.Error != nil || res.Data == nil {
		t.Fatalf("save: %+v", res.Error)
	}
	if asked.DefaultFilename != "Get_ bytes_1MB_.bin" {
		t.Errorf("default name = %q", asked.DefaultFilename)
	}
	got, err := os.ReadFile(res.Data.Path)
	if err != nil || len(got) != size || res.Data.BytesWritten != size || res.Data.TruncatedAtCap {
		t.Fatalf("file: len=%d written=%d capped=%v err=%v", len(got), res.Data.BytesWritten, res.Data.TruncatedAtCap, err)
	}
	held, _ := a.responses.get("r1")
	if !bytes.Equal(got, held.data) {
		t.Fatal("file content differs from the response body")
	}
}

func TestSaveResponseToFileCapCancelAndErrors(t *testing.T) {
	a := newTestApp(t, true, namedRequest("big"))
	dir := t.TempDir()
	a.saveDialog = func(_ context.Context, opts runtime.SaveDialogOptions) (string, error) {
		return filepath.Join(dir, opts.DefaultFilename), nil
	}
	// Over the cap: the first 20 MB were kept and the result says so.
	a.responses.put("r1", heldBody{projectID: "p1", data: []byte("first-20MB"), capped: true, contentType: "text/plain"})
	res := a.SaveResponseToFile("r1")
	if res.Error != nil || !res.Data.TruncatedAtCap || res.Data.BytesWritten != 10 || filepath.Base(res.Data.Path) != "big.txt" {
		t.Fatalf("capped save: %+v %+v", res.Data, res.Error)
	}

	if res := a.SaveResponseToFile("nothing"); res.Error == nil || res.Data != nil {
		t.Fatalf("no response: %+v", res)
	}

	a.saveDialog = func(context.Context, runtime.SaveDialogOptions) (string, error) { return "", nil }
	if res := a.SaveResponseToFile("r1"); res.Error != nil || res.Data != nil {
		t.Fatalf("cancel must be silent: %+v", res)
	}

	a.saveDialog = func(context.Context, runtime.SaveDialogOptions) (string, error) { return "", errors.New("no window") }
	if res := a.SaveResponseToFile("r1"); res.Error == nil {
		t.Fatal("dialog failure must surface")
	}

	a.saveDialog = func(context.Context, runtime.SaveDialogOptions) (string, error) {
		return filepath.Join(dir, "missing-dir", "x.txt"), nil
	}
	if res := a.SaveResponseToFile("r1"); res.Error == nil {
		t.Fatal("write failure must surface")
	}
}

func TestResponseFileNameAndExtension(t *testing.T) {
	cases := []struct{ name, ct, want string }{
		{"Users list", "application/json; charset=utf-8", "Users list.json"},
		{"Problem", "application/problem+json", "Problem.json"},
		{"Page", "text/html; charset=utf-8", "Page.html"},
		{"Feed", "application/rss+xml", "Feed.xml"},
		{"Feed", "text/xml", "Feed.xml"},
		{"Notes", "text/plain", "Notes.txt"},
		{"CSV", "text/csv", "CSV.txt"},
		{"Blob", "application/octet-stream", "Blob.bin"},
		{"Img", "image/png", "Img.bin"},
		{"No type", "", "No type.bin"},
		{`a/b\c:d*e?"f"<g>|h`, "text/plain", "a_b_c_d_e__f__g__h.txt"},
		{"  ..  ", "application/json", "response.json"},
		{"tab\there", "text/plain", "tab_here.txt"},
	}
	for _, c := range cases {
		if got := responseFileName(c.name, c.ct); got != c.want {
			t.Errorf("responseFileName(%q, %q) = %q, want %q", c.name, c.ct, got, c.want)
		}
	}
}
