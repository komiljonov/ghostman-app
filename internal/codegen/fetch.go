package codegen

import (
	"strconv"
	"strings"

	"ghostman/internal/engine"
)

var fetchTarget = Target{ID: "fetch", Label: "JavaScript (fetch)", Language: "javascript", render: renderFetch}

// renderFetch: an ES module for Node 18+ (top-level await; works in a browser
// console too, except file parts). Headers as an object, or as [name, value]
// pairs when a name repeats (an object would merge them). Text bodies are one
// string literal; form fields URLSearchParams pairs; form-data a FormData with
// files read from disk (node:fs). Timeout → AbortSignal.timeout(ms); redirects
// off → redirect: "manual".
func renderFetch(in Input, _ Options) string {
	r := in.Request
	var b strings.Builder
	usesFiles := false
	for _, p := range r.Body.Parts {
		if p.Kind == engine.PartFile {
			usesFiles = true
		}
	}
	if usesFiles {
		b.WriteString("import { readFileSync } from \"node:fs\";\n\n")
	}
	b.WriteString(comment("// ", notes(in, false)))

	headers := r.Headers // a multipart body's implied type is not in them (FormData sets it)
	if r.Body.Kind == engine.BodyMultipart {
		b.WriteString("const form = new FormData();\n")
		for _, p := range r.Body.Parts {
			if p.Kind == engine.PartFile {
				b.WriteString("form.append(" + jsString(p.Key) + ", new Blob([readFileSync(" + jsString(filePath(in, p)) + ")]), " +
					jsString(fileName(p)) + ");\n")
			} else {
				b.WriteString("form.append(" + jsString(p.Key) + ", " + jsString(p.Value) + ");\n")
			}
		}
		b.WriteString("\n")
	}

	b.WriteString("const response = await fetch(" + jsString(r.URL) + ", {\n")
	b.WriteString("  method: " + jsString(r.Method) + ",\n")
	if len(headers) > 0 {
		if hasDuplicateHeaders(headers) {
			b.WriteString("  headers: [\n")
			for _, h := range headers {
				b.WriteString("    [" + jsString(h.Key) + ", " + jsString(h.Value) + "],\n")
			}
			b.WriteString("  ],\n")
		} else {
			b.WriteString("  headers: {\n")
			for _, h := range headers {
				b.WriteString("    " + jsString(h.Key) + ": " + jsString(h.Value) + ",\n")
			}
			b.WriteString("  },\n")
		}
	}
	switch r.Body.Kind {
	case engine.BodyRaw:
		b.WriteString("  body: " + jsString(r.Body.Raw) + ",\n")
	case engine.BodyForm:
		b.WriteString("  body: new URLSearchParams([\n")
		for _, f := range r.Body.Form {
			b.WriteString("    [" + jsString(f.Key) + ", " + jsString(f.Value) + "],\n")
		}
		b.WriteString("  ]),\n")
	case engine.BodyMultipart:
		b.WriteString("  body: form,\n")
	}
	if !in.FollowRedirects {
		b.WriteString("  redirect: \"manual\",\n")
	}
	if ms := timeoutSeconds(in.Timeout) * 1000; ms > 0 {
		b.WriteString("  signal: AbortSignal.timeout(" + strconv.Itoa(ms) + "),\n")
	}
	b.WriteString("});\n")
	b.WriteString("console.log(response.status, await response.text());\n")
	return b.String()
}
