package codegen

import (
	"strconv"
	"strings"

	"ghostman/internal/engine"
)

var pythonTarget = Target{ID: "python", Label: "Python (requests)", Language: "python", render: renderPython}

// renderPython: requests. Text bodies are sent as UTF-8 bytes (a str body would
// be encoded as Latin-1); form fields as a list of pairs (order and repeats
// kept); form-data parts all in files= (text as (None, value), files as
// (name, open(path, "rb"))). Headers are a dict:
// a repeated name keeps only its last value (noted). Timeout → timeout=N;
// redirects off → allow_redirects=False.
func renderPython(in Input, _ Options) string {
	r := in.Request
	var b strings.Builder
	b.WriteString("import requests\n\n")
	extra := []string(nil)
	if hasDuplicateHeaders(r.Headers) {
		extra = append(extra, "a header name repeats: requests sends only its last value")
	}
	b.WriteString(comment("# ", append(notes(in, false), extra...)))

	var args []string
	args = append(args, pyString(r.Method), pyString(r.URL))
	if len(r.Headers) > 0 {
		var h strings.Builder
		h.WriteString("headers={\n")
		for _, x := range r.Headers {
			h.WriteString("        " + pyString(x.Key) + ": " + pyString(x.Value) + ",\n")
		}
		h.WriteString("    }")
		args = append(args, h.String())
	}
	switch r.Body.Kind {
	case engine.BodyRaw:
		args = append(args, "data="+pyString(r.Body.Raw)+`.encode("utf-8")`)
	case engine.BodyForm:
		args = append(args, "data="+pyPairs(r.Body.Form))
	case engine.BodyMultipart:
		// Every part goes in files= (in order): a text field as (None, value) is a
		// plain form field, and requests always builds multipart from files=.
		var parts []string
		for _, p := range r.Body.Parts {
			if p.Kind == engine.PartFile {
				parts = append(parts, "("+pyString(p.Key)+", ("+pyString(fileName(p))+", open("+pyString(filePath(in, p))+", \"rb\")))")
			} else {
				parts = append(parts, "("+pyString(p.Key)+", (None, "+pyString(p.Value)+"))")
			}
		}
		args = append(args, "files=[\n        "+strings.Join(parts, ",\n        ")+",\n    ]")
	}
	if s := timeoutSeconds(in.Timeout); s > 0 {
		args = append(args, "timeout="+strconv.Itoa(s))
	}
	if !in.FollowRedirects {
		args = append(args, "allow_redirects=False")
	}
	b.WriteString("response = requests.request(\n    " + strings.Join(args, ",\n    ") + ",\n)\n")
	b.WriteString("print(response.status_code)\nprint(response.text)\n")
	return b.String()
}

func pyPairs(rows []engine.Header) string {
	if len(rows) == 0 {
		return "[]"
	}
	var b strings.Builder
	b.WriteString("[\n")
	for _, r := range rows {
		b.WriteString("        (" + pyString(r.Key) + ", " + pyString(r.Value) + "),\n")
	}
	b.WriteString("    ]")
	return b.String()
}
