package codegen

import (
	"sort"
	"strconv"
	"strings"

	"ghostman/internal/engine"
)

var goTarget = Target{ID: "go", Label: "Go (net/http)", Language: "go", render: renderGo}

// renderGo: a complete program (package main), imports computed from what it
// uses, so it compiles as is. Text bodies are one string literal; form fields a
// url.Values (Encode sorts them by key); form-data a mime/multipart writer with
// files streamed from disk. A Host header sets req.Host, as Send does. Timeout →
// context.WithTimeout; redirects off → CheckRedirect returning ErrUseLastResponse.
func renderGo(in Input, _ Options) string {
	r := in.Request
	imports := map[string]bool{"fmt": true, "io": true, "net/http": true}
	var body strings.Builder // statements building the body, inside main
	bodyExpr := "nil"
	switch r.Body.Kind {
	case engine.BodyRaw:
		imports["strings"] = true
		bodyExpr = "strings.NewReader(" + goString(r.Body.Raw) + ")"
	case engine.BodyForm:
		imports["strings"], imports["net/url"] = true, true
		body.WriteString("\tform := url.Values{}\n")
		for _, f := range r.Body.Form {
			body.WriteString("\tform.Add(" + goString(f.Key) + ", " + goString(f.Value) + ")\n")
		}
		bodyExpr = "strings.NewReader(form.Encode())"
	case engine.BodyMultipart:
		imports["bytes"], imports["mime/multipart"] = true, true
		body.WriteString("\tvar buf bytes.Buffer\n\tmw := multipart.NewWriter(&buf)\n")
		for _, p := range r.Body.Parts {
			if p.Kind != engine.PartFile {
				body.WriteString("\tif err := mw.WriteField(" + goString(p.Key) + ", " + goString(p.Value) + "); err != nil {\n\t\tpanic(err)\n\t}\n")
				continue
			}
			imports["os"] = true
			body.WriteString("\t{\n")
			body.WriteString("\t\tf, err := os.Open(" + goString(filePath(in, p)) + ")\n\t\tif err != nil {\n\t\t\tpanic(err)\n\t\t}\n")
			body.WriteString("\t\tfw, err := mw.CreateFormFile(" + goString(p.Key) + ", " + goString(fileName(p)) + ")\n\t\tif err != nil {\n\t\t\tpanic(err)\n\t\t}\n")
			body.WriteString("\t\tif _, err := io.Copy(fw, f); err != nil {\n\t\t\tpanic(err)\n\t\t}\n\t\tf.Close()\n\t}\n")
		}
		body.WriteString("\tif err := mw.Close(); err != nil {\n\t\tpanic(err)\n\t}\n")
		bodyExpr = "&buf"
	}

	var m strings.Builder
	m.WriteString(comment("\t// ", notes(in, false)))
	m.WriteString(body.String())
	newReq := "http.NewRequest(" + goString(r.Method) + ", " + goString(r.URL) + ", " + bodyExpr + ")"
	if s := timeoutSeconds(in.Timeout); s > 0 {
		imports["context"], imports["time"] = true, true
		m.WriteString("\tctx, cancel := context.WithTimeout(context.Background(), " + strconv.Itoa(s) + "*time.Second)\n\tdefer cancel()\n")
		newReq = "http.NewRequestWithContext(ctx, " + goString(r.Method) + ", " + goString(r.URL) + ", " + bodyExpr + ")"
	}
	m.WriteString("\treq, err := " + newReq + "\n\tif err != nil {\n\t\tpanic(err)\n\t}\n")
	userType := false
	for _, h := range r.Headers {
		if strings.EqualFold(h.Key, "Host") {
			m.WriteString("\treq.Host = " + goString(h.Value) + "\n")
			continue
		}
		if strings.EqualFold(h.Key, "Content-Type") {
			userType = true
		}
		m.WriteString("\treq.Header.Add(" + goString(h.Key) + ", " + goString(h.Value) + ")\n")
	}
	if r.Body.Kind == engine.BodyMultipart && !userType {
		m.WriteString("\treq.Header.Set(\"Content-Type\", mw.FormDataContentType())\n")
	}
	if in.FollowRedirects {
		m.WriteString("\tclient := &http.Client{}\n")
	} else {
		m.WriteString("\tclient := &http.Client{\n\t\t// Do not follow redirects: the 3xx is the response.\n" +
			"\t\tCheckRedirect: func(*http.Request, []*http.Request) error { return http.ErrUseLastResponse },\n\t}\n")
	}
	m.WriteString("\tresp, err := client.Do(req)\n\tif err != nil {\n\t\tpanic(err)\n\t}\n\tdefer resp.Body.Close()\n")
	m.WriteString("\tout, err := io.ReadAll(resp.Body)\n\tif err != nil {\n\t\tpanic(err)\n\t}\n")
	m.WriteString("\tfmt.Println(resp.Status)\n\tfmt.Println(string(out))\n")

	names := make([]string, 0, len(imports))
	for k := range imports {
		names = append(names, k)
	}
	sort.Strings(names)
	var b strings.Builder
	b.WriteString("package main\n\nimport (\n")
	for _, n := range names {
		b.WriteString("\t" + strconv.Quote(n) + "\n")
	}
	b.WriteString(")\n\nfunc main() {\n" + m.String() + "}\n")
	return b.String()
}
