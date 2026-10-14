package engine

import (
	"bytes"
	"context"
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"io"
	"mime"
	"net/http"
	"net/http/httptest"
	"os"
	"path/filepath"
	"runtime"
	"strings"
	"testing"
)

// gotPart is what the test server saw of one part.
type gotPart struct {
	Name, FileName, ContentType, Body string
	Size                              int64
	SHA                               string
}

// partsServer records every request's Content-Type and parts, streaming each
// part (hashed, never held) so a big upload costs the server no memory either.
func partsServer(t *testing.T, handler func(w http.ResponseWriter, r *http.Request) bool) (*httptest.Server, *[]string, *[][]gotPart) {
	t.Helper()
	var cts []string
	var all [][]gotPart
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if handler != nil && handler(w, r) {
			return
		}
		cts = append(cts, r.Header.Get("Content-Type"))
		var parts []gotPart
		if mr, err := r.MultipartReader(); err == nil {
			for {
				p, err := mr.NextPart()
				if err != nil {
					break
				}
				h := sha256.New()
				var head bytes.Buffer
				n, _ := io.Copy(io.MultiWriter(h, &limitedBuffer{&head, 64}), p)
				parts = append(parts, gotPart{p.FormName(), p.FileName(), p.Header.Get("Content-Type"), head.String(), n, hex.EncodeToString(h.Sum(nil))})
			}
		}
		all = append(all, parts)
		_, _ = io.WriteString(w, "ok")
	}))
	t.Cleanup(srv.Close)
	return srv, &cts, &all
}

type limitedBuffer struct {
	b   *bytes.Buffer
	max int
}

func (l *limitedBuffer) Write(p []byte) (int, error) {
	if room := l.max - l.b.Len(); room > 0 {
		l.b.Write(p[:min(room, len(p))])
	}
	return len(p), nil
}

func writeFile(t *testing.T, name string, data []byte) string {
	t.Helper()
	p := filepath.Join(t.TempDir(), name)
	if err := os.WriteFile(p, data, 0o644); err != nil {
		t.Fatal(err)
	}
	return p
}

var pngHead = []byte("\x89PNG\r\n\x1a\n\x00\x00\x00\rIHDR\x00\x00\x00\x01\x00\x00\x00\x01\x08\x02\x00\x00\x00")

func multipartSpec(url string, parts ...Part) RequestSpec {
	return RequestSpec{Method: http.MethodPost, URL: url, Body: Body{Type: BodyMultipart, Parts: parts}}
}

func TestMultipartAssembly(t *testing.T) {
	srv, cts, all := partsServer(t, nil)
	png := writeFile(t, "avatar.png", pngHead)
	txt := writeFile(t, "notes.txt", []byte("hello world"))
	bin := writeFile(t, "blob", []byte{0x00, 0x01, 0xfe, 0xff, 0x10})
	spec := multipartSpec(srv.URL,
		Part{Key: "name", Kind: PartText, Value: "alice", Enabled: true},
		Part{Key: "avatar", Kind: PartFile, FileName: "avatar.png", Path: png, Enabled: true},
		Part{Key: "tag", Kind: PartText, Value: "a", Enabled: true},
		Part{Key: "tag", Kind: PartText, Value: "b", Enabled: true}, // duplicate text keys are kept
		Part{Key: "skipped", Kind: PartText, Value: "x", Enabled: false},
		Part{Key: "", Kind: PartText, Value: "keyless"},
		Part{Key: "notes", Kind: PartFile, Path: txt, Enabled: true},
		Part{Key: "raw", Kind: PartFile, Path: bin, Enabled: true},
	)
	if _, err := New(DefaultTimeout).Send(context.Background(), spec, SendOptions{}); err != nil {
		t.Fatal(err)
	}
	mt, params, _ := mime.ParseMediaType((*cts)[0])
	if mt != "multipart/form-data" || params["boundary"] == "" {
		t.Fatalf("Content-Type = %q", (*cts)[0])
	}
	got := (*all)[0]
	var summary []string
	for _, p := range got {
		summary = append(summary, p.Name+"|"+p.FileName+"|"+p.ContentType+"|"+p.Body)
	}
	want := []string{
		"name|||alice",
		"avatar|avatar.png|image/png|" + string(pngHead),
		"tag|||a",
		"tag|||b",
		"notes|notes.txt|text/plain; charset=utf-8|hello world",
		"raw|blob|application/octet-stream|" + string([]byte{0x00, 0x01, 0xfe, 0xff, 0x10}),
	}
	if strings.Join(summary, "\n") != strings.Join(want, "\n") {
		t.Fatalf("parts:\n%s\nwant\n%s", strings.Join(summary, "\n"), strings.Join(want, "\n"))
	}
}

func TestMultipartUserContentTypeWins(t *testing.T) {
	srv, cts, _ := partsServer(t, nil)
	spec := multipartSpec(srv.URL, Part{Key: "a", Kind: PartText, Value: "1", Enabled: true})
	spec.Headers = []Header{{Key: "content-type", Value: "multipart/mixed; boundary=mine", Enabled: true}}
	if _, err := New(DefaultTimeout).Send(context.Background(), spec, SendOptions{}); err != nil {
		t.Fatal(err)
	}
	if (*cts)[0] != "multipart/mixed; boundary=mine" {
		t.Fatalf("Content-Type = %q", (*cts)[0])
	}
}

func TestMultipartMissingFileAbortsBeforeSending(t *testing.T) {
	hits := 0
	srv := httptest.NewServer(http.HandlerFunc(func(http.ResponseWriter, *http.Request) { hits++ }))
	t.Cleanup(srv.Close)
	gone := filepath.Join(t.TempDir(), "avatar.png")
	for _, tt := range []struct {
		part Part
		want string
	}{
		{Part{Key: "avatar", Kind: PartFile, FileName: "avatar.png", Path: gone, Enabled: true}, "file for field 'avatar' not found: avatar.png"},
		{Part{Key: "avatar", Kind: PartFile, FileName: "avatar.png", Enabled: true}, "file for field 'avatar' is not on this machine: avatar.png — choose it again"},
		{Part{Key: "avatar", Kind: PartFile, Enabled: true}, "no file chosen for field 'avatar'"},
		{Part{Key: "dir", Kind: PartFile, FileName: "x", Path: t.TempDir(), Enabled: true}, "file for field 'dir' is a folder: x"},
	} {
		_, err := New(DefaultTimeout).Send(context.Background(), multipartSpec(srv.URL, tt.part), SendOptions{})
		if err == nil || err.Error() != tt.want {
			t.Errorf("err = %v, want %q", err, tt.want)
		}
	}
	// A disabled file row is not checked (and not sent).
	off := Part{Key: "avatar", Kind: PartFile, FileName: "avatar.png", Path: gone, Enabled: false}
	if _, err := New(DefaultTimeout).Send(context.Background(), multipartSpec(srv.URL, off), SendOptions{}); err != nil {
		t.Fatalf("disabled missing file: %v", err)
	}
	if hits != 1 {
		t.Fatalf("server hits = %d, want 1 (only the disabled-row send)", hits)
	}
}

func TestMultipart307ReStreamsTheFile(t *testing.T) {
	data := bytes.Repeat([]byte("0123456789"), 100_000) // 1 MB
	path := writeFile(t, "big.bin", data)
	sum := sha256.Sum256(data)
	srv, _, all := partsServer(t, func(w http.ResponseWriter, r *http.Request) bool {
		if r.URL.Path == "/start" {
			_, _ = io.Copy(io.Discard, r.Body)
			http.Redirect(w, r, "/final", http.StatusTemporaryRedirect)
			return true
		}
		return false
	})
	spec := multipartSpec(srv.URL+"/start", Part{Key: "f", Kind: PartFile, Path: path, Enabled: true})
	resp, err := New(DefaultTimeout).Send(context.Background(), spec, SendOptions{FollowRedirects: true})
	if err != nil {
		t.Fatal(err)
	}
	if len(resp.Hops) != 2 || len(*all) != 1 {
		t.Fatalf("hops %d, final requests %d", len(resp.Hops), len(*all))
	}
	p := (*all)[0][0]
	if p.Size != int64(len(data)) || p.SHA != hex.EncodeToString(sum[:]) {
		t.Fatalf("re-sent part: %d bytes, sha %s", p.Size, p.SHA)
	}
}

// A ~50 MB file is streamed, not loaded: the allocations of the whole send stay
// far below its size.
func TestMultipartStreamsLargeFiles(t *testing.T) {
	if testing.Short() {
		t.Skip("large upload")
	}
	const size = 50 << 20
	path := filepath.Join(t.TempDir(), "big.bin")
	f, err := os.Create(path)
	if err != nil {
		t.Fatal(err)
	}
	chunk := bytes.Repeat([]byte{0xAB}, 1<<20)
	for range size >> 20 {
		_, _ = f.Write(chunk)
	}
	_ = f.Close()
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		n, _ := io.Copy(io.Discard, r.Body) // counting only
		_ = json.NewEncoder(w).Encode(map[string]int64{"received": n, "declared": r.ContentLength})
	}))
	t.Cleanup(srv.Close)

	var before, after runtime.MemStats
	runtime.GC()
	runtime.ReadMemStats(&before)
	resp, err := New(DefaultTimeout).Send(context.Background(), multipartSpec(srv.URL, Part{Key: "f", Kind: PartFile, Path: path, Enabled: true}), SendOptions{})
	runtime.ReadMemStats(&after)
	if err != nil {
		t.Fatal(err)
	}
	var got map[string]int64
	_ = json.Unmarshal([]byte(resp.Body), &got)
	if got["received"] <= size || got["received"] != got["declared"] {
		t.Fatalf("server got %d bytes (declared %d)", got["received"], got["declared"])
	}
	if alloc := after.TotalAlloc - before.TotalAlloc; alloc > 8<<20 {
		t.Fatalf("sending a 50 MB file allocated %d MB: it was not streamed", alloc>>20)
	}
}

func TestMultipartSummary(t *testing.T) {
	path := writeFile(t, "avatar.png", pngHead)
	got := MultipartSummary([]Part{
		{Key: "name", Kind: PartText, Value: "alice", Enabled: true},
		{Key: "avatar", Kind: PartFile, FileName: "avatar.png", Path: path, Enabled: true},
		{Key: "doc", Kind: PartFile, FileName: "cv.pdf", Enabled: true},
		{Key: "off", Kind: PartText, Value: "x"},
	})
	want := "name: alice\navatar: [file avatar.png, 29 bytes]\ndoc: [file cv.pdf, not on this machine]"
	if got != want {
		t.Fatalf("summary =\n%s\nwant\n%s", got, want)
	}
	text, ct := SentBody(Body{Type: BodyMultipart, Parts: []Part{{Key: "avatar", Kind: PartFile, FileName: "avatar.png", Path: path, Enabled: true}}})
	if strings.Contains(text, "PNG") || ct != "multipart/form-data" {
		t.Fatalf("sent body = %q (%s): file bytes must never be recorded", text, ct)
	}
}

func TestResolveMultipart(t *testing.T) {
	spec := multipartSpec("http://x",
		Part{Key: "{{k}}", Kind: PartText, Value: "{{user}}", Enabled: true},
		Part{Key: "avatar", Kind: PartFile, FileName: "{{user}}.png", Path: "/tmp/a.png", Enabled: true},
	)
	out, unresolved := ResolveSpec(spec, map[string]string{"k": "name", "user": "alice"})
	p := out.Body.Parts
	if p[0].Key != "name" || p[0].Value != "alice" || p[1].Path != "/tmp/a.png" || p[1].FileName != "{{user}}.png" || len(unresolved) != 0 {
		t.Fatalf("resolved = %+v (unresolved %v)", p, unresolved)
	}
	if spec.Body.Parts[0].Value != "{{user}}" {
		t.Fatal("ResolveSpec modified the template")
	}
}
