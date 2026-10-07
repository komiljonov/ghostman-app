package main

import (
	"bytes"
	"context"
	"io"
	"net/http"
	"net/http/httptest"
	"os"
	"path/filepath"
	"testing"

	"github.com/wailsapp/wails/v2/pkg/runtime"

	"ghostman/internal/api"
	"ghostman/internal/engine"
)

// A real 1x1 PNG, plus fake media payloads (any bytes; only types matter here).
var (
	pngBytes = []byte("\x89PNG\r\n\x1a\n\x00\x00\x00\rIHDR\x00\x00\x00\x01\x00\x00\x00\x01\x08\x06\x00\x00\x00\x1f\x15\xc4\x89\x00\x00\x00\rIDATx\x9cc\xf8\xcf\xc0\xf0\x1f\x00\x05\x00\x01\xff\x89\x99=\x1d\x00\x00\x00\x00IEND\xaeB`\x82")
	mp4Bytes = append([]byte("\x00\x00\x00\x18ftypmp42"), bytes.Repeat([]byte{0x00, 0xff, 0x10}, 50_000)...)
	pdfBytes = []byte("%PDF-1.4\n%\xe2\xe3\xcf\xd3\n1 0 obj<<>>endobj\ntrailer<<>>\n%%EOF")
	binBytes = []byte{0x00, 0x01, 0x02, 0xfe, 0xff}
)

func mediaServer(t *testing.T) *httptest.Server {
	t.Helper()
	routes := map[string]struct {
		ct   string
		body []byte
	}{
		"/logo.png": {"image/png", pngBytes},
		"/clip.mp4": {"video/mp4", mp4Bytes},
		"/doc.pdf":  {"application/pdf", pdfBytes},
		"/blob":     {"", binBytes}, // no Content-Type: sniffed as binary
		"/page":     {"text/html", []byte("<h1>hi</h1>")},
	}
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		rt := routes[r.URL.Path]
		if rt.ct != "" {
			w.Header().Set("Content-Type", rt.ct)
		} else {
			w.Header()["Content-Type"] = nil // stop net/http from sniffing one
		}
		_, _ = w.Write(rt.body)
	}))
	t.Cleanup(srv.Close)
	return srv
}

func TestMediaKind(t *testing.T) {
	cases := []struct {
		ct   string
		body []byte
		want string
	}{
		{"image/png", pngBytes, engine.MediaImage},
		{"image/svg+xml; charset=utf-8", []byte("<svg/>"), engine.MediaImage},
		{"image/tiff", nil, engine.MediaBinary},
		{"audio/mpeg", nil, engine.MediaAudio},
		{"video/mp4", nil, engine.MediaVideo},
		{"application/pdf", pdfBytes, engine.MediaPDF},
		{"application/octet-stream", []byte("text-ish"), engine.MediaBinary},
		{"", binBytes, engine.MediaBinary},
		{"", []byte("plain text"), engine.MediaNone},
		{"application/json", []byte(`{"a":"é"}`), engine.MediaNone},
		{"text/plain", []byte("caf\xc3"), engine.MediaNone}, // cut mid-rune is still text
	}
	for _, c := range cases {
		if got := engine.MediaKind(c.ct, c.body); got != c.want {
			t.Errorf("MediaKind(%q) = %q, want %q", c.ct, got, c.want)
		}
	}
}

func TestMediaResponsesAreStoredAndServed(t *testing.T) {
	srv := mediaServer(t)
	a := newTestApp(t, true, nil)
	send := func(path, name string) HistoryEntry {
		t.Helper()
		a.SendRequest("p1", "r-"+name, api.RequestDraft{Method: "GET", URL: srv.URL + path}, SendOptions{RequestName: name})
		e := a.GetHistoryEntry(historyRows(t, a)[0].ID)
		if e.Error != nil {
			t.Fatal(e.Error.Message)
		}
		return *e.Data
	}
	cases := []struct {
		path, name, media string
		body              []byte
		served            bool
	}{
		{"/logo.png", "Logo", engine.MediaImage, pngBytes, true},
		{"/clip.mp4", "Clip", engine.MediaVideo, mp4Bytes, true},
		{"/doc.pdf", "Doc", engine.MediaPDF, pdfBytes, false},
		{"/blob", "Blob", engine.MediaBinary, binBytes, false},
	}
	handler := a.mediaMiddleware(http.HandlerFunc(func(w http.ResponseWriter, _ *http.Request) {
		w.WriteHeader(299) // "the frontend assets"
	}))
	get := func(url string, hdr map[string]string) *httptest.ResponseRecorder {
		req := httptest.NewRequest(http.MethodGet, url, nil)
		for k, v := range hdr {
			req.Header.Set(k, v)
		}
		rec := httptest.NewRecorder()
		handler.ServeHTTP(rec, req)
		return rec
	}
	for _, c := range cases {
		e := send(c.path, c.name)
		r := e.Response
		if r == nil || r.Media != c.media || r.StoredBytes != int64(len(c.body)) || r.BodySize != int64(len(c.body)) || r.StoredTruncated {
			t.Fatalf("%s: response = %+v", c.name, r)
		}
		// Never sent as text over the bridge.
		if r.Body != "" || r.RawBody != "" || r.Formatted {
			t.Errorf("%s: media body crossed the bridge as text (%d chars)", c.name, len(r.Body))
		}
		if (r.MediaURL != "") != c.served {
			t.Errorf("%s: media url %q", c.name, r.MediaURL)
		}
		// The route serves exactly the stored bytes for image/audio/video only.
		rec := get(historyMediaURL(e.Summary.ID), nil)
		if c.served {
			if rec.Code != http.StatusOK || !bytes.Equal(rec.Body.Bytes(), c.body) ||
				rec.Header().Get("Content-Type") != map[string]string{"Logo": "image/png", "Clip": "video/mp4"}[c.name] ||
				rec.Header().Get("X-Content-Type-Options") != "nosniff" || rec.Header().Get("Cache-Control") != "no-store" {
				t.Errorf("%s: served %d %q %d bytes", c.name, rec.Code, rec.Header().Get("Content-Type"), rec.Body.Len())
			}
		} else if rec.Code != http.StatusNotFound {
			t.Errorf("%s: must not be served, got %d", c.name, rec.Code)
		}
	}

	// Video seeks: Range requests get 206 with the slice.
	clip := historyRows(t, a)[2].ID // newest first: Blob, Doc, Clip, Logo
	rec := get(historyMediaURL(clip), map[string]string{"Range": "bytes=4-11"})
	if rec.Code != http.StatusPartialContent || rec.Body.String() != "ftypmp42" {
		t.Errorf("range: %d %q", rec.Code, rec.Body.String())
	}

	// Text (HTML) is never served by the route; unknown ids / paths are 404; other paths pass through.
	page := send("/page", "Page")
	if page.Response.Media != engine.MediaNone || page.Response.Body != "<h1>hi</h1>" {
		t.Errorf("html entry: %+v", page.Response)
	}
	for _, url := range []string{historyMediaURL(page.Summary.ID), historyMediaURL(99999), "/history-media/x"} {
		if rec := get(url, nil); rec.Code != http.StatusNotFound {
			t.Errorf("%s: %d", url, rec.Code)
		}
	}
	if rec := get("/assets/index.js", nil); rec.Code != 299 {
		t.Errorf("other paths must reach the assets: %d", rec.Code)
	}
}

func TestMediaTruncatedByHistoryCap(t *testing.T) {
	big := bytes.Repeat([]byte{0xff, 0x00}, 700_000) // 1.4 MB of binary
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, _ *http.Request) {
		w.Header().Set("Content-Type", "image/png")
		_, _ = w.Write(big)
	}))
	defer srv.Close()
	a := newTestApp(t, true, nil)
	if r := a.SetHistoryMaxResponseBytes(1 << 20); r.Error != nil {
		t.Fatal(r.Error.Message)
	}
	a.SendRequest("p1", "r1", api.RequestDraft{Method: "GET", URL: srv.URL}, SendOptions{})
	r := a.GetHistoryEntry(historyRows(t, a)[0].ID).Data.Response
	if r.Media != engine.MediaImage || r.StoredBytes != 1<<20 || r.BodySize != int64(len(big)) || !r.StoredTruncated {
		t.Fatalf("truncated media: %+v", r)
	}
}

func TestSaveHistoryResponseToFile(t *testing.T) {
	srv := mediaServer(t)
	a := newTestApp(t, true, nil)
	a.SendRequest("p1", "r1", api.RequestDraft{Method: "GET", URL: srv.URL + "/logo.png"}, SendOptions{RequestName: "Logo"})
	id := historyRows(t, a)[0].ID
	dir := t.TempDir()
	var offered string
	a.saveDialog = func(_ context.Context, opts runtime.SaveDialogOptions) (string, error) {
		offered = opts.DefaultFilename
		return filepath.Join(dir, opts.DefaultFilename), nil
	}
	res := a.SaveHistoryResponseToFile(id)
	if res.Error != nil || res.Data == nil || offered != "Logo.png" || res.Data.BytesWritten != int64(len(pngBytes)) || res.Data.TruncatedAtCap {
		t.Fatalf("save = %+v %+v (offered %q)", res.Data, res.Error, offered)
	}
	f, _ := os.Open(res.Data.Path)
	got, _ := io.ReadAll(f)
	_ = f.Close()
	if !bytes.Equal(got, pngBytes) {
		t.Fatal("file content differs from the response")
	}
	// Cancel: nothing; failed send / missing entry: an error.
	a.saveDialog = func(context.Context, runtime.SaveDialogOptions) (string, error) { return "", nil }
	if r := a.SaveHistoryResponseToFile(id); r.Data != nil || r.Error != nil {
		t.Fatalf("cancel = %+v", r)
	}
	a.SendRequest("p1", "r1", api.RequestDraft{Method: "GET", URL: "http://127.0.0.1:1/x"}, SendOptions{})
	if r := a.SaveHistoryResponseToFile(historyRows(t, a)[0].ID); r.Error == nil {
		t.Fatal("a failed send has nothing to save")
	}
	if r := a.SaveHistoryResponseToFile(99999); r.Error == nil {
		t.Fatal("missing entry must fail")
	}
}

func TestLiveResponseMediaPreview(t *testing.T) {
	srv := mediaServer(t)
	a := newTestApp(t, true, nil)
	handler := a.mediaMiddleware(http.NotFoundHandler())
	get := func(url string) *httptest.ResponseRecorder {
		rec := httptest.NewRecorder()
		handler.ServeHTTP(rec, httptest.NewRequest(http.MethodGet, url, nil))
		return rec
	}

	res := a.SendRequest("p1", "r1", api.RequestDraft{Method: "GET", URL: srv.URL + "/logo.png"}, SendOptions{})
	if res.Error != nil || res.Data.Media != engine.MediaImage || res.Data.Body != "" || res.Data.MediaURL == "" {
		t.Fatalf("image response = media %q url %q body %d", res.Data.Media, res.Data.MediaURL, len(res.Data.Body))
	}
	rec := get(res.Data.MediaURL)
	if rec.Code != http.StatusOK || !bytes.Equal(rec.Body.Bytes(), pngBytes) || rec.Header().Get("Content-Type") != "image/png" {
		t.Fatalf("served %d %q", rec.Code, rec.Header().Get("Content-Type"))
	}
	// A re-send gets a new URL (no stale image in the webview).
	again := a.SendRequest("p1", "r1", api.RequestDraft{Method: "GET", URL: srv.URL + "/logo.png"}, SendOptions{})
	if again.Data.MediaURL == res.Data.MediaURL {
		t.Fatalf("media url must change per response: %q", again.Data.MediaURL)
	}
	// Video is served too; PDF / binary / text are not (no URL, 404).
	if v := a.SendRequest("p1", "r2", api.RequestDraft{Method: "GET", URL: srv.URL + "/clip.mp4"}, SendOptions{}); v.Data.Media != engine.MediaVideo || get(v.Data.MediaURL).Code != http.StatusOK {
		t.Fatalf("video: %+v", v.Data.Media)
	}
	pdf := a.SendRequest("p1", "r3", api.RequestDraft{Method: "GET", URL: srv.URL + "/doc.pdf"}, SendOptions{})
	if pdf.Data.Media != engine.MediaPDF || pdf.Data.MediaURL != "" || pdf.Data.Body != "" || get(responseMediaURL("r3", 1)).Code != http.StatusNotFound {
		t.Fatalf("pdf: %+v", pdf.Data)
	}
	page := a.SendRequest("p1", "r4", api.RequestDraft{Method: "GET", URL: srv.URL + "/page"}, SendOptions{})
	if page.Data.Media != "" || page.Data.Body != "<h1>hi</h1>" || page.Data.MediaURL != "" {
		t.Fatalf("html: %+v", page.Data)
	}
	// Closing the tab drops the body: the URL is gone.
	a.ReleaseResponse("r1")
	if rec := get(again.Data.MediaURL); rec.Code != http.StatusNotFound {
		t.Fatalf("released tab still served: %d", rec.Code)
	}
}
