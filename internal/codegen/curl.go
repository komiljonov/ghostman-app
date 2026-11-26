package codegen

import (
	"net/http"
	"strconv"
	"strings"

	"ghostman/internal/engine"
)

var curlTarget = Target{ID: "curl", Label: "curl", Language: "shell", render: renderCurl}

// renderCurl: bash. Multiline (default): one option per line, "\" continuations,
// notes as # comments above. One line: the whole command on a single line, no
// newline character anywhere (no comments; a value with a line break is $'…').
//   - text bodies go in --data-raw (never "@file" interpretation); a body with
//     non-ASCII text or a CR is PIPED in instead (printf '%s' … | curl
//     --data-binary @-): bash's builtin printf writes the bytes as they are, while
//     an argument would reach Windows curl.exe in the ANSI code page (ü, ✓ lost).
//     Form-data text fields go in --form-string (never "@" / "<"), files in
//     -F 'name=@"path"'. Non-ASCII in header values / form-data text stays an
//     argument: fine in bash on Linux / macOS, lossy with Windows curl.exe.
//   - an empty header value is written "Name;" (curl drops "Name:")
//   - the method: -X only when curl would not pick it itself; HEAD is --head
//   - redirects on → -L; off → --max-redirs 0. Timeout → --max-time N.
//   - the proxy (-x) only when asked for; otherwise a note.
func renderCurl(in Input, opts Options) string {
	q := func(s string) string { return shQuote(s, opts.OneLine) }
	r := in.Request
	hasBody := r.Body.Kind != engine.BodyNone
	var args []string
	switch {
	case r.Method == http.MethodHead:
		args = append(args, "--head")
	case r.Method == http.MethodGet && !hasBody, r.Method == http.MethodPost && hasBody:
	default:
		args = append(args, "-X "+r.Method)
	}
	args = append(args, q(r.URL))
	for _, h := range r.Headers {
		if h.Value == "" {
			args = append(args, "-H "+q(h.Key+";"))
		} else {
			args = append(args, "-H "+q(h.Key+": "+h.Value))
		}
	}
	pipe := ""
	switch r.Body.Kind {
	case engine.BodyRaw, engine.BodyForm:
		if needsPipe(r.Body.Raw) {
			pipe = "printf '%s' " + q(r.Body.Raw) + " | "
			args = append(args, "--data-binary @-")
		} else {
			args = append(args, "--data-raw "+q(r.Body.Raw))
		}
	case engine.BodyMultipart:
		for _, p := range r.Body.Parts {
			if p.Kind == engine.PartFile {
				spec := p.Key + `=@"` + curlFormEscape(filePath(in, p)) + `"`
				if name := fileName(p); p.Path == "" || name != baseName(p.Path) {
					spec += `;filename="` + curlFormEscape(name) + `"`
				}
				args = append(args, "-F "+q(spec))
			} else {
				args = append(args, "--form-string "+q(p.Key+"="+p.Value))
			}
		}
	}
	if s := timeoutSeconds(in.Timeout); s > 0 {
		args = append(args, "--max-time "+strconv.Itoa(s))
	}
	if in.FollowRedirects {
		args = append(args, "-L")
	} else {
		args = append(args, "--max-redirs 0")
	}
	proxyUsed := opts.IncludeProxy && in.Proxy != nil
	if proxyUsed {
		args = append(args, "-x "+q(in.Proxy.URL))
	}
	if opts.OneLine {
		return pipe + "curl " + strings.Join(args, " ")
	}
	return comment("# ", notes(in, proxyUsed)) + pipe + "curl " + strings.Join(args, " \\\n  ")
}

// needsPipe: a body that is not plain ASCII (or has a CR) goes through stdin.
func needsPipe(s string) bool {
	for i := 0; i < len(s); i++ {
		if s[i] >= 0x80 || s[i] == '\r' {
			return true
		}
	}
	return false
}

// curlFormEscape escapes a double-quoted -F value (a file path / name): \ and ".
func curlFormEscape(s string) string {
	return strings.NewReplacer(`\`, `\\`, `"`, `\"`).Replace(s)
}

func baseName(path string) string {
	path = strings.ReplaceAll(path, `\`, "/")
	if i := strings.LastIndex(path, "/"); i >= 0 {
		return path[i+1:]
	}
	return path
}
