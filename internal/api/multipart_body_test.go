package api

import (
	"encoding/json"
	"reflect"
	"strings"
	"testing"
)

func TestMultipartBodyWireShape(t *testing.T) {
	b := RequestBody{Type: BodyMultipart, Fields: []KeyValue{{Key: "kept", Value: "for the form view", Enabled: true}}, Parts: []MultipartField{
		{Key: "name", Kind: PartText, Value: "{{user}}", FileName: "stale.png", Enabled: true},
		{Key: "avatar", Kind: PartFile, Value: "stale", FileName: "avatar.png", Enabled: true},
		{Key: "off", Kind: PartFile, Enabled: false},
	}}
	got, err := json.Marshal(b)
	if err != nil {
		t.Fatal(err)
	}
	// Exactly the server's per-kind field sets; no path, no bytes, no form rows.
	want := `{"type":"multipart","fields":[{"key":"name","kind":"text","value":"{{user}}","enabled":true},` +
		`{"key":"avatar","kind":"file","file_name":"avatar.png","enabled":true},` +
		`{"key":"off","kind":"file","file_name":"","enabled":false}]}`
	if string(got) != want {
		t.Fatalf("wire =\n%s\nwant\n%s", got, want)
	}
	if strings.Contains(string(got), "path") {
		t.Fatal("a path reached the wire")
	}
}

func TestMultipartBodyDecodesBothShapes(t *testing.T) {
	// The server's: multipart rows arrive as "fields".
	var server RequestBody
	if err := json.Unmarshal([]byte(`{"type":"multipart","fields":[{"key":"a","kind":"file","file_name":"x.png","enabled":true}]}`), &server); err != nil {
		t.Fatal(err)
	}
	if len(server.Parts) != 1 || server.Parts[0].FileName != "x.png" || len(server.Fields) != 0 {
		t.Fatalf("server shape = %+v", server)
	}
	// The editor's: both lists side by side (switching type keeps the other).
	var editor RequestBody
	if err := json.Unmarshal([]byte(`{"type":"multipart","fields":[{"key":"f","value":"1","enabled":true}],"parts":[{"key":"p","kind":"text","value":"2","enabled":true}]}`), &editor); err != nil {
		t.Fatal(err)
	}
	if len(editor.Fields) != 1 || editor.Fields[0].Key != "f" || len(editor.Parts) != 1 || editor.Parts[0].Key != "p" {
		t.Fatalf("editor shape = %+v", editor)
	}
	var form RequestBody
	if err := json.Unmarshal([]byte(`{"type":"form","fields":[{"key":"f","value":"1","enabled":true}]}`), &form); err != nil {
		t.Fatal(err)
	}
	if len(form.Fields) != 1 || form.Parts != nil {
		t.Fatalf("form = %+v", form)
	}
}

func TestMultipartPatch(t *testing.T) {
	base := RequestDraft{Body: RequestBody{Type: BodyMultipart, Parts: []MultipartField{{Key: "avatar", Kind: PartFile, Enabled: true}}}}
	draft := base
	draft.Body.Parts = []MultipartField{{Key: "avatar", Kind: PartFile, FileName: "avatar.png", Enabled: true}, {Key: "", Kind: PartText, Value: "half"}}
	p, changed := BuildRequestPatch(base, draft)
	if !changed || p.Body == nil {
		t.Fatal("choosing a file must patch the body's file_name")
	}
	want := []MultipartField{{Key: "avatar", Kind: PartFile, FileName: "avatar.png", Enabled: true}}
	if !reflect.DeepEqual(p.Body.Parts, want) {
		t.Fatalf("patched parts = %+v", p.Body.Parts)
	}
	// Switching to form keeps the parts in the draft but sends only the form.
	draft.Body.Type = BodyForm
	p, _ = BuildRequestPatch(base, draft)
	raw, _ := json.Marshal(p.Body)
	if string(raw) != `{"type":"form","fields":[]}` {
		t.Fatalf("form patch = %s", raw)
	}
}
