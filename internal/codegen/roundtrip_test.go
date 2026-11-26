package codegen

import (
	"bytes"
	"context"
	"io"
	"net/http"
	"net/http/httptest"
	"os"
	"os/exec"
	"path/filepath"
	"runtime"
	"strings"
	"sync"
	"testing"
	"time"

	"ghostman/internal/engine"
)

// Round trips: each target's snippet is EXECUTED against a local echo server and
// the server must receive exactly what Send would send — byte-identical bodies
// (', ", $, `, \, CR/LF, tab, unicode), form fields, form-data text fields and
// file bytes. A tool that is not installed skips its target (logged):
//   curl via bash (Git Bash on Windows), Python 3 with requests (GHOSTMAN_TEST_PYTHON
//   picks the interpreter), Go (go run), JavaScript via node (18+).

type received struct {
	method, query, contentType string
	headers                    http.Header
	body                       []byte
	form                       map[string][]string // urlencoded / multipart text fields
	files                      map[string]string   // multipart file field → name + ":" + content
}

func echoServer(t *testing.T) (*httptest.Server, func() received) {
	t.Helper()
	var mu sync.Mutex
	var last received
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		body, _ := io.ReadAll(r.Body)
		rec := received{method: r.Method, query: r.URL.RawQuery, contentType: r.Header.Get("Content-Type"), headers: r.Header.Clone(), body: body}
		ct := r.Header.Get("Content-Type")
		r.Body = io.NopCloser(bytes.NewReader(body))
		switch {
		case strings.HasPrefix(ct, "multipart/form-data"):
			if err := r.ParseMultipartForm(1 << 20); err == nil {
				rec.form = r.MultipartForm.Value
				rec.files = map[string]string{}
				for k, fhs := range r.MultipartForm.File {
					f, _ := fhs[0].Open()
					b, _ := io.ReadAll(f)
					f.Close()
					rec.files[k] = fhs[0].Filename + ":" + string(b)
				}
			}
		case strings.HasPrefix(ct, "application/x-www-form-urlencoded"):
			if err := r.ParseForm(); err == nil {
				rec.form = r.PostForm
			}
		}
		mu.Lock()
		last = rec
		mu.Unlock()
		_, _ = w.Write([]byte("ok"))
	}))
	t.Cleanup(srv.Close)
	return srv, func() received {
		mu.Lock()
		defer mu.Unlock()
		return last
	}
}

// runner executes a snippet; ok=false skips (tool missing).
type runner struct {
	name string
	run  func(t *testing.T, snippet string) (ok bool)
}

func writeTemp(t *testing.T, name, content string) string {
	t.Helper()
	p := filepath.Join(t.TempDir(), name)
	if err := os.WriteFile(p, []byte(content), 0o644); err != nil {
		t.Fatal(err)
	}
	return p
}

func execOK(t *testing.T, dir string, name string, args ...string) {
	t.Helper()
	ctx, cancel := context.WithTimeout(context.Background(), 2*time.Minute)
	defer cancel()
	cmd := exec.CommandContext(ctx, name, args...)
	cmd.Dir = dir
	out, err := cmd.CombinedOutput()
	if err != nil {
		t.Fatalf("%s %v: %v\n%s", name, args, err, out)
	}
}

func runners(t *testing.T) map[string]runner {
	t.Helper()
	have := func(tool string) bool {
		_, err := exec.LookPath(tool)
		return err == nil
	}
	python := os.Getenv("GHOSTMAN_TEST_PYTHON")
	if python == "" {
		python = "python3"
		if !have(python) {
			python = "python"
		}
	}
	pythonOK := have(python) && exec.Command(python, "-c", "import requests").Run() == nil
	return map[string]runner{
		"curl": {"bash+curl", func(t *testing.T, s string) bool {
			bash := findBash()
			if bash == "" || !have("curl") {
				return false
			}
			f := writeTemp(t, "snippet.sh", s+"\n")
			execOK(t, filepath.Dir(f), bash, f)
			return true
		}},
		"python": {"python+requests", func(t *testing.T, s string) bool {
			if !pythonOK {
				return false
			}
			f := writeTemp(t, "snippet.py", s)
			execOK(t, filepath.Dir(f), python, f)
			return true
		}},
		"go": {"go run", func(t *testing.T, s string) bool {
			if !have("go") {
				return false
			}
			f := writeTemp(t, "main.go", s)
			execOK(t, filepath.Dir(f), "go", "run", f)
			return true
		}},
		"fetch": {"node", func(t *testing.T, s string) bool {
			if !have("node") {
				return false
			}
			f := writeTemp(t, "snippet.mjs", s)
			execOK(t, filepath.Dir(f), "node", f)
			return true
		}},
	}
}

// findBash is a real bash: GHOSTMAN_TEST_BASH, else bash on PATH — but on Windows
// never System32's bash.exe (the WSL launcher, which fails without a distro):
// then Git for Windows' bash next to git.exe. "" = none (the curl cases skip).
func findBash() string {
	if p := os.Getenv("GHOSTMAN_TEST_BASH"); p != "" {
		return p
	}
	p, err := exec.LookPath("bash")
	if err == nil && (runtime.GOOS != "windows" || !strings.Contains(strings.ToLower(p), `\windows\system32\`)) {
		return p
	}
	if runtime.GOOS == "windows" {
		if git, err := exec.LookPath("git"); err == nil {
			// <Git>\cmd\git.exe → <Git>\bin\bash.exe
			if b := filepath.Join(filepath.Dir(filepath.Dir(git)), "bin", "bash.exe"); fileExists(b) {
				return b
			}
		}
	}
	return ""
}

func fileExists(p string) bool {
	_, err := os.Stat(p)
	return err == nil
}

// each runs fn for every target (and curl one-line), skipping missing tools.
func each(t *testing.T, fn func(t *testing.T, target string, opts Options, run func(string) bool)) {
	rs := runners(t)
	for _, target := range Targets() {
		variants := []Options{{}}
		if target.ID == "curl" {
			variants = append(variants, Options{OneLine: true})
		}
		for _, opts := range variants {
			name := target.ID
			if opts.OneLine {
				name += "-oneline"
			}
			t.Run(name, func(t *testing.T) {
				r := rs[target.ID]
				fn(t, target.ID, opts, func(s string) bool {
					if !r.run(t, s) {
						t.Skipf("%s not available", r.name)
					}
					return true
				})
			})
		}
	}
}

func TestRoundTripTortureBody(t *testing.T) {
	srv, last := echoServer(t)
	spec := engine.RequestSpec{
		Method: "POST", URL: srv.URL + "/echo?x=1",
		// Header values ASCII: fetch and Python's http.client refuse others (and
		// HTTP headers are not UTF-8 text); unicode is tested in the body.
		Headers:     []engine.Header{hdr("X-Quote", `it's "q" $HOME `+"`id`"), hdr("X-Path", `C:\x\y`)},
		QueryParams: []engine.Header{hdr("tag", "a b"), hdr("tag", "c&d")},
		Body:        engine.Body{Type: engine.BodyRaw, ContentType: "application/json; charset=utf-8", Content: TortureBody},
		Auth:        &engine.Auth{Type: engine.AuthBearer, BearerToken: "tok'\"$`"},
	}
	p := prepared(t, spec)
	each(t, func(t *testing.T, target string, opts Options, run func(string) bool) {
		snippet, _ := Generate(target, Input{Request: p, Timeout: 30 * time.Second, FollowRedirects: true}, opts)
		run(snippet)
		got := last()
		if string(got.body) != TortureBody {
			t.Errorf("body:\n got %q\nwant %q", got.body, TortureBody)
		}
		if got.method != "POST" || got.query != "x=1&tag=a+b&tag=c%26d" {
			t.Errorf("method / query: %s %s", got.method, got.query)
		}
		for k, want := range map[string]string{
			"X-Quote": `it's "q" $HOME ` + "`id`", "X-Path": `C:\x\y`, "Authorization": "Bearer tok'\"$`",
			"Content-Type": "application/json; charset=utf-8",
		} {
			if g := got.headers.Get(k); g != want {
				t.Errorf("header %s = %q, want %q", k, g, want)
			}
		}
	})
}

func TestRoundTripForm(t *testing.T) {
	srv, last := echoServer(t)
	p := prepared(t, engine.RequestSpec{
		Method: "POST", URL: srv.URL + "/form",
		Body: engine.Body{Type: engine.BodyForm, Fields: []engine.Header{hdr("user", "a b&c=d"), hdr("pass", "p'w\"$`\\"), hdr("user", "ü2")}},
	})
	each(t, func(t *testing.T, target string, opts Options, run func(string) bool) {
		snippet, _ := Generate(target, Input{Request: p, FollowRedirects: true}, opts)
		run(snippet)
		got := last()
		if strings.Join(got.form["user"], "|") != "a b&c=d|ü2" || strings.Join(got.form["pass"], "|") != "p'w\"$`\\" {
			t.Errorf("form = %v", got.form)
		}
	})
}

func TestRoundTripMultipart(t *testing.T) {
	srv, last := echoServer(t)
	dir := t.TempDir()
	path := filepath.Join(dir, "my pic's.bin")
	content := "\x00\x01binary 'q' \"dq\" $x\r\n\xff"
	if err := os.WriteFile(path, []byte(content), 0o644); err != nil {
		t.Fatal(err)
	}
	p := prepared(t, engine.RequestSpec{Method: "POST", URL: srv.URL + "/up", Body: engine.Body{Type: engine.BodyMultipart, Parts: []engine.Part{
		{Key: "title", Kind: engine.PartText, Value: "@not-a-file <neither 'q' \"dq\" $x `id` \\", Enabled: true},
		{Key: "uni", Kind: engine.PartText, Value: "üñí ✓", Enabled: true},
		{Key: "avatar", Kind: engine.PartFile, FileName: "avatar.bin", Path: path, Enabled: true},
	}}})
	each(t, func(t *testing.T, target string, opts Options, run func(string) bool) {
		snippet, _ := Generate(target, Input{Request: p, FollowRedirects: true, FilePaths: true}, opts)
		run(snippet)
		got := last()
		if strings.Join(got.form["title"], "|") != "@not-a-file <neither 'q' \"dq\" $x `id` \\" {
			t.Errorf("text field = %v", got.form)
		}
		// Known limit (curl.go): form-data text is an argument, and Windows curl.exe
		// reads its arguments in the ANSI code page.
		if target == "curl" && runtime.GOOS == "windows" {
			t.Logf("skipping the non-ASCII form-data field with Windows curl.exe (got %q)", got.form["uni"])
		} else if strings.Join(got.form["uni"], "|") != "üñí ✓" {
			t.Errorf("non-ASCII text field = %v", got.form["uni"])
		}
		if got.files["avatar"] != "avatar.bin:"+content {
			t.Errorf("file = %q", got.files["avatar"])
		}
	})
}
