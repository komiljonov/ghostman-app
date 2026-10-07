package main

import (
	"io"
	"net/http"
	"testing"
)

func TestBoundTreeMethods(t *testing.T) {
	var moveBody, createBody string
	a := newTestApp(t, true, map[string]http.HandlerFunc{
		"GET /api/v1/projects/{project_id}/folders": func(w http.ResponseWriter, _ *http.Request) {
			_, _ = w.Write([]byte(`[{"id":"f1","parent_id":null,"name":"A","follow_redirects":"off","sort_order":0,"created_at":"x"}]`))
		},
		"POST /api/v1/projects/{project_id}/requests": func(w http.ResponseWriter, r *http.Request) {
			raw, _ := io.ReadAll(r.Body)
			createBody = string(raw)
			w.WriteHeader(http.StatusCreated)
			_, _ = w.Write([]byte(`{"id":"r1","project_id":"p1","folder_id":null,"name":"R","method":"GET","url":"","sort_order":0,"created_at":"x","updated_at":"x"}`))
		},
		"POST /api/v1/folders/{id}/move": func(w http.ResponseWriter, r *http.Request) {
			raw, _ := io.ReadAll(r.Body)
			moveBody = string(raw)
			writeEnvelope(w, http.StatusBadRequest, "bad_request", "a folder cannot be moved into itself or its own subfolder")
		},
	})

	if got, want := toJSON(t, a.ListFolders("p1")),
		`{"data":[{"id":"f1","parent_id":null,"name":"A","follow_redirects":"off","sort_order":0,"created_at":"x"}]}`; got != want {
		t.Errorf("ListFolders = %s\nwant %s", got, want)
	}

	// "" from the UI means the project root: sent as null.
	res := a.CreateRequest("p1", " R ", "")
	if res.Error != nil || createBody != `{"folder_id":null,"name":"R"}` {
		t.Errorf("CreateRequest = %s, body %s", toJSON(t, res), createBody)
	}

	got := toJSON(t, a.MoveFolder("fA", "fB"))
	want := `{"data":null,"error":{"kind":"server","status":400,"code":"bad_request","message":"a folder cannot be moved into itself or its own subfolder"}}`
	if got != want || moveBody != `{"parent_id":"fB"}` {
		t.Errorf("MoveFolder = %s (body %s)\nwant %s", got, moveBody, want)
	}
}

func TestTreeStateRoundtrip(t *testing.T) {
	a := newTestApp(t, true, nil)
	if got := toJSON(t, a.GetTreeState("p1")); got != `[]` {
		t.Fatalf("empty state = %s", got)
	}
	if res := a.SetTreeState("p1", []string{"f1", "f2"}); res.Error != nil {
		t.Fatal(res.Error.Message)
	}
	if got := toJSON(t, a.GetTreeState("p1")); got != `["f1","f2"]` {
		t.Fatalf("state = %s", got)
	}
	if got := toJSON(t, a.GetTreeState("p2")); got != `[]` {
		t.Fatalf("other project state = %s", got)
	}
	// Corrupt JSON is ignored rather than breaking the tree.
	if err := a.store.PutSetting(a.ctx, treeStateKey("p1"), "{nope"); err != nil {
		t.Fatal(err)
	}
	if got := toJSON(t, a.GetTreeState("p1")); got != `[]` {
		t.Fatalf("corrupt state = %s", got)
	}
}
