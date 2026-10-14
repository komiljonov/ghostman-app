package main

import (
	"context"
	"io"
	"net/http"
	"net/http/httptest"
	"os"
	"path/filepath"
	"strings"
	"testing"

	"github.com/wailsapp/wails/v2/pkg/runtime"

	"ghostman/internal/api"
)

func pick(a *App, path string) {
	a.openDialog = func(context.Context, runtime.OpenDialogOptions) (string, error) { return path, nil }
}

func TestRequestFilesChooseRenameClear(t *testing.T) {
	a := newTestApp(t, false, nil)
	file := filepath.Join(t.TempDir(), "avatar.png")
	if err := os.WriteFile(file, []byte("png!"), 0o644); err != nil {
		t.Fatal(err)
	}
	pick(a, file)
	r := a.ChooseRequestFile("r1", " avatar ")
	if r.Error != nil || r.Data == nil || r.Data.Key != "avatar" || r.Data.FileName != "avatar.png" || r.Data.Size != 4 || !r.Data.Exists {
		t.Fatalf("choose = %+v %+v", r.Data, r.Error)
	}
	pick(a, "") // cancelled: no data, no error, nothing changes
	if c := a.ChooseRequestFile("r1", "avatar"); c.Data != nil || c.Error != nil {
		t.Fatalf("cancel = %+v", c)
	}
	if c := a.ChooseRequestFile("r1", "  "); c.Error == nil {
		t.Fatal("a keyless field got a file")
	}

	if e := a.RenameRequestFileKey("r1", "avatar", "photo"); e.Error != nil {
		t.Fatal(e.Error.Message)
	}
	list := a.ListRequestFiles("r1").Data
	if len(list) != 1 || list[0].Key != "photo" || list[0].Path != file {
		t.Fatalf("after rename = %+v", list)
	}
	// A rename onto a key that has a file never overwrites it.
	other := filepath.Join(t.TempDir(), "doc.txt")
	_ = os.WriteFile(other, []byte("doc"), 0o644)
	pick(a, other)
	a.ChooseRequestFile("r1", "doc")
	a.RenameRequestFileKey("r1", "doc", "photo")
	byKey := map[string]string{}
	for _, f := range a.ListRequestFiles("r1").Data {
		byKey[f.Key] = f.Path
	}
	if byKey["photo"] != file || byKey["doc"] != other {
		t.Fatalf("a rename clobbered a path: %+v", byKey)
	}
	a.ClearRequestFile("r1", "doc")
	if other := a.ListRequestFiles("r2").Data; len(other) != 0 {
		t.Fatal("paths are per request")
	}

	// The file disappears from disk: still listed, not existing (the amber state).
	_ = os.Remove(file)
	if list := a.ListRequestFiles("r1").Data; list[0].Exists {
		t.Fatal("a deleted file is reported as present")
	}
	if e := a.ClearRequestFile("r1", "photo"); e.Error != nil {
		t.Fatal(e.Error.Message)
	}
	if list := a.ListRequestFiles("r1").Data; len(list) != 0 {
		t.Fatalf("after clear = %+v", list)
	}
}

func TestSendMultipartStreamsTheLocalFile(t *testing.T) {
	var gotCT, gotName, gotFile, gotFileName, gotFileCT string
	target := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		gotCT = r.Header.Get("Content-Type")
		if err := r.ParseMultipartForm(1 << 20); err != nil {
			t.Error(err)
			return
		}
		gotName = r.FormValue("name")
		f, h, err := r.FormFile("avatar")
		if err == nil {
			b, _ := io.ReadAll(f)
			gotFile, gotFileName, gotFileCT = string(b), h.Filename, h.Header.Get("Content-Type")
		}
	}))
	defer target.Close()
	a := authEnvApp(t, target.URL, nil)
	dir := t.TempDir()
	file := filepath.Join(dir, "avatar.png")
	png := "\x89PNG\r\n\x1a\n-not-really"
	if err := os.WriteFile(file, []byte(png), 0o644); err != nil {
		t.Fatal(err)
	}
	pick(a, file)
	if r := a.ChooseRequestFile("r1", "avatar"); r.Error != nil {
		t.Fatal(r.Error.Message)
	}
	draft := api.RequestDraft{Method: "POST", URL: "{{BASE_URL}}/post", Body: api.RequestBody{Type: api.BodyMultipart, Parts: []api.MultipartField{
		{Key: "name", Kind: api.PartText, Value: "{{API_TOKEN}}", Enabled: true},
		{Key: "avatar", Kind: api.PartFile, FileName: "avatar.png", Enabled: true},
	}}}
	res := a.SendRequest("p1", "r1", draft, SendOptions{})
	if res.Error != nil {
		t.Fatal(res.Error.Message)
	}
	if !strings.HasPrefix(gotCT, "multipart/form-data; boundary=") || gotName != "local-secret-9" || gotFile != png ||
		gotFileName != "avatar.png" || gotFileCT != "image/png" {
		t.Fatalf("server saw ct=%q name=%q file=%q (%s, %s)", gotCT, gotName, gotFile, gotFileName, gotFileCT)
	}

	// History: the file is a placeholder in both forms, never its bytes.
	e := a.GetHistoryEntry(historyRows(t, a)[0].ID).Data
	if e.Template.Body != "name: {{API_TOKEN}}\navatar: [file avatar.png]" {
		t.Fatalf("template body = %q", e.Template.Body)
	}
	if e.Resolved.Body != "name: local-secret-9\navatar: [file avatar.png, 19 bytes]" {
		t.Fatalf("resolved body = %q", e.Resolved.Body)
	}
	row, err := a.store.GetHistoryEntry(a.ctx, historyRows(t, a)[0].ID)
	if err != nil {
		t.Fatal(err)
	}
	rawBody := row.ReqBodyJson.String + row.ReqBodyResolved.String
	if strings.Contains(rawBody, "not-really") || strings.Contains(rawBody, dir) {
		t.Fatalf("history holds file bytes or the path: %s", rawBody)
	}

	// The file is gone: the send aborts before anything is sent, naming the field.
	_ = os.Remove(file)
	gotName = ""
	res = a.SendRequest("p1", "r1", draft, SendOptions{})
	if res.Error == nil || res.Error.Message != "file for field 'avatar' not found: avatar.png" || gotName != "" {
		t.Fatalf("missing file: %+v (server saw %q)", res.Error, gotName)
	}
}
