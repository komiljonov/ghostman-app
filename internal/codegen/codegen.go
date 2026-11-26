// Package codegen renders a request as a ready-to-paste snippet (curl, fetch,
// Python requests, Go net/http). The input is the WIRE form of the request
// (engine.Prepared: what Send would put on the wire — auth applied, {{vars}}
// resolved or kept, the query merged, the body's implied Content-Type) plus the
// send settings (timeout, redirects, proxy). Every target is ONE template over
// that input, registered in targets: adding a language is one new file with one
// Target, nothing else. Quoting is per target (quote.go) and tested by executing
// the snippets against an echo server.
package codegen

import (
	"fmt"
	"net/url"
	"path/filepath"
	"regexp"
	"strings"
	"time"

	"ghostman/internal/engine"
)

// Input is everything a snippet shows.
type Input struct {
	Request         engine.Prepared
	Timeout         time.Duration // 0 = no timeout flag
	FollowRedirects bool
	Proxy           *Proxy   // the resolved proxy; nil = direct
	Notes           []string // one-line comments above the code ("pre/post scripts are not represented", …)
	// FilePaths: file parts carry their real local path (resolved snippets);
	// otherwise a placeholder (template snippets).
	FilePaths bool
}

// Proxy is the resolved proxy as a snippet can name it (never its password).
type Proxy struct {
	URL            string // scheme://host:port
	Label          string
	HasCredentials bool
}

// Options are the per-target choices (curl only for now).
type Options struct {
	OneLine      bool // curl: the whole command on one line, no newline characters at all
	IncludeProxy bool // curl: -x scheme://host:port
}

// Target is one language.
type Target struct {
	ID       string `json:"id"`
	Label    string `json:"label"`
	Language string `json:"language"` // the preview's highlighting: shell | javascript | python | go
	render   func(in Input, opts Options) string
}

// targets in picker order.
var targets = []Target{curlTarget, fetchTarget, pythonTarget, goTarget}

// Targets lists the languages (picker order).
func Targets() []Target { return append([]Target(nil), targets...) }

// Find returns the target with that id.
func Find(id string) (Target, bool) {
	for _, t := range targets {
		if t.ID == id {
			return t, true
		}
	}
	return Target{}, false
}

// Generate renders in as the target's snippet.
func Generate(target string, in Input, opts Options) (string, error) {
	t, ok := Find(target)
	if !ok {
		return "", fmt.Errorf("unknown code target %q", target)
	}
	return t.render(in, opts), nil
}

// encodedToken is a {{token}} as Send's URL / form encoding writes it.
var encodedToken = regexp.MustCompile(`(?i)%7B%7B(.*?)%7D%7D`)

// KeepVarTokens is for TEMPLATE snippets: the wire encoding percent-escapes the
// braces of a {{token}} in the URL and an urlencoded body; a template snippet
// shows the token as written ({{API_TOKEN}}, not %7B%7BAPI_TOKEN%7D%7D).
func KeepVarTokens(p engine.Prepared) engine.Prepared {
	restore := func(s string) string {
		return encodedToken.ReplaceAllStringFunc(s, func(m string) string {
			inner := encodedToken.FindStringSubmatch(m)[1]
			if u, err := url.PathUnescape(inner); err == nil {
				inner = u
			}
			return "{{" + inner + "}}"
		})
	}
	p.URL = restore(p.URL)
	if p.Body.Kind == engine.BodyForm {
		p.Body.Raw = restore(p.Body.Raw)
	}
	return p
}

// ProxyNote is the comment / warning for a resolved proxy a snippet does not use.
func ProxyNote(p *Proxy) string {
	return fmt.Sprintf("sent through the proxy %s (%s) — not represented in this snippet", p.Label, p.URL)
}

// notes are the comments of a snippet: the caller's, plus the proxy when the
// target does not use it.
func notes(in Input, proxyUsed bool) []string {
	out := append([]string(nil), in.Notes...)
	if in.Proxy != nil && !proxyUsed {
		out = append(out, ProxyNote(in.Proxy))
		if in.Proxy.HasCredentials {
			out = append(out, "the proxy needs credentials (stored on this machine only, never in snippets)")
		}
	} else if in.Proxy != nil && in.Proxy.HasCredentials {
		out = append(out, "the proxy's credentials are not included (stored on this machine only)")
	}
	return out
}

// filePath is what a snippet names for a file part: its local path in resolved
// snippets, else a placeholder naming the file.
func filePath(in Input, p engine.Part) string {
	if in.FilePaths && p.Path != "" {
		return p.Path
	}
	name := p.FileName
	if name == "" {
		name = "file"
	}
	return "<path to " + name + ">"
}

// fileName is the file name a part is sent with (its display name, else the path's base).
func fileName(p engine.Part) string {
	if p.FileName != "" {
		return p.FileName
	}
	if p.Path != "" {
		return filepath.Base(p.Path)
	}
	return "file"
}

// comment renders notes as line comments with prefix ("# " / "// ").
func comment(prefix string, lines []string) string {
	var b strings.Builder
	for _, l := range lines {
		b.WriteString(prefix + l + "\n")
	}
	return b.String()
}

// hasDuplicateHeaders reports a header name used twice (case-insensitive).
func hasDuplicateHeaders(hs []engine.Header) bool {
	seen := map[string]bool{}
	for _, h := range hs {
		k := strings.ToLower(h.Key)
		if seen[k] {
			return true
		}
		seen[k] = true
	}
	return false
}

// timeoutSeconds is a timeout in whole seconds (rounded up; 0 = none).
func timeoutSeconds(d time.Duration) int {
	if d <= 0 {
		return 0
	}
	return int((d + time.Second - 1) / time.Second)
}
