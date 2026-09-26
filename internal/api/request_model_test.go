package api

import (
	"encoding/json"
	"testing"
)

func TestRequestBodyMarshalsOnlyItsVariant(t *testing.T) {
	all := RequestBody{ContentType: "application/json", Content: `{"a":1}`, Fields: []KeyValue{{Key: "f", Value: "1", Enabled: true}}}
	tests := []struct {
		typ  string
		want string
	}{
		{BodyNone, `{"type":"none"}`},
		{"", `{"type":"none"}`},
		{BodyRaw, `{"type":"raw","content_type":"application/json","content":"{\"a\":1}"}`},
		{BodyForm, `{"type":"form","fields":[{"key":"f","value":"1","enabled":true}]}`},
	}
	for _, tt := range tests {
		b := all
		b.Type = tt.typ
		got, err := json.Marshal(b)
		if err != nil || string(got) != tt.want {
			t.Errorf("type %q: %s, %v; want %s", tt.typ, got, err, tt.want)
		}
	}
}

func TestBuildRequestPatch(t *testing.T) {
	base := RequestDraft{
		Method:      "GET",
		URL:         "https://x.io",
		Headers:     []KeyValue{{Key: "A", Value: "1", Enabled: true}},
		QueryParams: []KeyValue{},
		Body:        RequestBody{Type: BodyNone},
	}
	patchJSON := func(d RequestDraft) (string, bool) {
		p, changed := BuildRequestPatch(base, d)
		raw, err := json.Marshal(p)
		if err != nil {
			t.Fatal(err)
		}
		return string(raw), changed
	}

	tests := []struct {
		name        string
		edit        func(d *RequestDraft)
		wantChanged bool
		want        string
	}{
		{"nothing changed", func(*RequestDraft) {}, false, `{}`},
		{
			// The editor's trailing empty row and keyless rows are not changes.
			"only empty rows added", func(d *RequestDraft) {
				d.Headers = append(d.Headers, KeyValue{Enabled: true}, KeyValue{Value: "orphan", Enabled: true})
				d.QueryParams = []KeyValue{{Key: "  "}}
			}, false, `{}`,
		},
		{"method only", func(d *RequestDraft) { d.Method = "POST" }, true, `{"method":"POST"}`},
		{"url only", func(d *RequestDraft) { d.URL = "https://y.io" }, true, `{"url":"https://y.io"}`},
		{
			"headers keep order, duplicates and disabled rows; empty rows dropped", func(d *RequestDraft) {
				d.Headers = []KeyValue{{Key: "A", Value: "1", Enabled: true}, {Key: "B", Value: "x", Enabled: false},
					{Key: "A", Value: "2", Enabled: true}, {Enabled: true}}
			}, true,
			`{"headers":[{"key":"A","value":"1","enabled":true},{"key":"B","value":"x","enabled":false},{"key":"A","value":"2","enabled":true}]}`,
		},
		{
			"toggling enabled is a change", func(d *RequestDraft) {
				d.Headers = []KeyValue{{Key: "A", Value: "1", Enabled: false}}
			}, true, `{"headers":[{"key":"A","value":"1","enabled":false}]}`,
		},
		{
			"query params", func(d *RequestDraft) { d.QueryParams = []KeyValue{{Key: "q", Value: "1", Enabled: true}} },
			true, `{"query_params":[{"key":"q","value":"1","enabled":true}]}`,
		},
		{
			"raw body with empty content type gets the default", func(d *RequestDraft) {
				d.Body = RequestBody{Type: BodyRaw, Content: "hi", Fields: []KeyValue{{Key: "ignored"}}}
			}, true, `{"body":{"type":"raw","content_type":"text/plain","content":"hi"}}`,
		},
		{
			"form body drops keyless fields", func(d *RequestDraft) {
				d.Body = RequestBody{Type: BodyForm, Content: "ignored", Fields: []KeyValue{{Key: "a", Value: "1", Enabled: true}, {}}}
			}, true, `{"body":{"type":"form","fields":[{"key":"a","value":"1","enabled":true}]}}`,
		},
		{
			// Content kept for other variants while the type is none is not a change.
			"hidden variant data is not a change", func(d *RequestDraft) {
				d.Body = RequestBody{Type: BodyNone, Content: "draft text"}
			}, false, `{}`,
		},
	}
	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			d := base
			d.Headers = append([]KeyValue{}, base.Headers...)
			tt.edit(&d)
			got, changed := patchJSON(d)
			if changed != tt.wantChanged || got != tt.want {
				t.Errorf("got %s (changed=%v)\nwant %s (changed=%v)", got, changed, tt.want, tt.wantChanged)
			}
		})
	}
}
