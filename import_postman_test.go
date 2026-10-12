package main

import (
	"context"
	"encoding/json"
	"net/http"
	"os"
	"path/filepath"
	"strings"
	"sync"
	"testing"

	"github.com/wailsapp/wails/v2/pkg/runtime"
)

// importServer: the endpoints an import uses, recording what was written.
func importServer(t *testing.T) (map[string]http.HandlerFunc, *[]string) {
	var mu sync.Mutex
	var log []string
	rec := func(s string) { mu.Lock(); log = append(log, s); mu.Unlock() }
	vars := []map[string]any{}
	n := 0
	id := func() string { n++; return "id" + string(rune('a'+n)) }
	body := func(r *http.Request) map[string]any {
		var m map[string]any
		_ = json.NewDecoder(r.Body).Decode(&m)
		return m
	}
	return map[string]http.HandlerFunc{
		"GET /api/v1/projects/{project_id}": func(w http.ResponseWriter, _ *http.Request) {
			_, _ = w.Write([]byte(`{"id":"p1","name":"P1"}`))
		},
		"GET /api/v1/projects/{project_id}/folders": func(w http.ResponseWriter, _ *http.Request) {
			_, _ = w.Write([]byte(`[{"id":"old","name":"Tiny","parent_id":null}]`))
		},
		"POST /api/v1/projects/{project_id}/folders": func(w http.ResponseWriter, r *http.Request) {
			m := body(r)
			rec("folder " + m["name"].(string))
			_ = json.NewEncoder(w).Encode(map[string]any{"id": id(), "name": m["name"]})
		},
		"POST /api/v1/projects/{project_id}/requests": func(w http.ResponseWriter, r *http.Request) {
			m := body(r)
			rec("request " + m["name"].(string) + " " + m["method"].(string))
			_ = json.NewEncoder(w).Encode(map[string]any{"id": id(), "name": m["name"]})
		},
		"PATCH /api/v1/requests/{id}": func(w http.ResponseWriter, r *http.Request) {
			b, _ := json.Marshal(body(r))
			rec("patch " + string(b))
			_, _ = w.Write([]byte(`{"id":"x"}`))
		},
		"POST /api/v1/projects/{project_id}/environments": func(w http.ResponseWriter, r *http.Request) {
			m := body(r)
			rec("env " + m["name"].(string))
			_, _ = w.Write([]byte(`{"id":"env1","name":"` + m["name"].(string) + `"}`))
		},
		"POST /api/v1/environments/{id}/variables": func(w http.ResponseWriter, r *http.Request) {
			m := body(r)
			rec("var " + m["key"].(string) + " " + m["type"].(string))
			v := map[string]any{"id": "v-" + m["key"].(string), "key": m["key"], "type": m["type"]}
			vars = append(vars, v)
			_ = json.NewEncoder(w).Encode(v)
		},
		"GET /api/v1/environments/{id}/variables": func(w http.ResponseWriter, _ *http.Request) {
			_ = json.NewEncoder(w).Encode(vars)
		},
		"PATCH /api/v1/variables/{id}": func(w http.ResponseWriter, r *http.Request) {
			b, _ := json.Marshal(body(r))
			rec("value " + r.PathValue("id") + " " + string(b))
			_, _ = w.Write([]byte(`{"id":"` + r.PathValue("id") + `"}`))
		},
	}, &log
}

func writeFile(t *testing.T, name, content string) string {
	t.Helper()
	p := filepath.Join(t.TempDir(), name)
	if err := os.WriteFile(p, []byte(content), 0o600); err != nil {
		t.Fatal(err)
	}
	return p
}

const tinyCollection = `{"info": {"name": "Tiny", "schema": "https://schema.getpostman.com/json/collection/v2.1.0/collection.json"},
  "item": [{"name": "Get", "request": {"method": "GET", "url": "{{base}}/get?a=1",
    "auth": {"type": "bearer", "bearer": [{"key": "token", "value": "{{tok}}"}]}}}, {"name": "Weird", "request": {"method": "PURGE", "url": "x"}}]}`

func TestChooseImportFile(t *testing.T) {
	a := newTestApp(t, true, nil)
	picked := ""
	a.openDialog = func(_ context.Context, o runtime.OpenDialogOptions) (string, error) {
		if len(o.Filters) != 1 || o.Filters[0].Pattern != "*.json" {
			t.Fatalf("filters %+v", o.Filters)
		}
		return picked, nil
	}
	if r := a.ChooseImportFile(); r.Data != nil || r.Error != nil {
		t.Fatalf("cancel: %+v", r)
	}
	picked = writeFile(t, "tiny.json", tinyCollection)
	r := a.ChooseImportFile()
	if r.Error != nil || r.Data.Kind != "collection" || r.Data.Name != "Tiny" || r.Data.Requests != 2 || r.Data.FileName != "tiny.json" {
		t.Fatalf("collection: %+v %+v", r.Data, r.Error)
	}
	picked = writeFile(t, "old.json", `{"name":"x","order":[],"requests":[]}`)
	if r := a.ChooseImportFile(); r.Error == nil || !strings.HasPrefix(r.Error.Message, "This is a Postman Collection v1 file") {
		t.Fatalf("v1: %+v", r.Error)
	}
	picked = writeFile(t, "openapi.json", `{"openapi":"3.0.0"}`)
	if r := a.ChooseImportFile(); r.Error == nil || !strings.Contains(r.Error.Message, "collection") ||
		!strings.Contains(r.Error.Message, "environment") {
		t.Fatalf("other: %+v", r.Error)
	}
}

func TestImportPostmanCollectionBound(t *testing.T) {
	routes, log := importServer(t)
	a := newTestApp(t, true, routes)
	var events []ImportProgress
	a.emit = func(_ context.Context, name string, data ...any) {
		if name == ImportProgressEvent {
			events = append(events, data[0].(ImportProgress))
		}
	}
	res := a.ImportPostmanCollection("p1", writeFile(t, "tiny.json", tinyCollection))
	if res.Error != nil {
		t.Fatal(res.Error.Message)
	}
	rep := res.Data
	if rep.Target != "P1 / Tiny (2)" || rep.Summary.Requests != 2 || len(rep.Changed) != 1 {
		t.Fatalf("report %+v", rep)
	}
	got := strings.Join(*log, "\n")
	for _, want := range []string{"folder Tiny (2)", "request Get GET", "request Weird GET", `"query_params":[{"enabled":true,"key":"a","value":"1"}]`,
		`"bearer_token":"{{tok}}"`} {
		if !strings.Contains(got, want) {
			t.Fatalf("server log lacks %q:\n%s", want, got)
		}
	}
	if len(events) != 3 || events[2] != (ImportProgress{Done: 2, Total: 2}) {
		t.Fatalf("progress %+v", events)
	}
	// The wrong method for the file's kind.
	if r := a.ImportPostmanEnvironment("p1", writeFile(t, "tiny.json", tinyCollection)); r.Error == nil ||
		r.Error.Message != "This file is a Postman collection, not an environment." {
		t.Fatalf("mismatch: %+v", r.Error)
	}
}

func TestImportPostmanEnvironmentBound(t *testing.T) {
	routes, log := importServer(t)
	a := newTestApp(t, true, routes)
	a.emit = func(context.Context, string, ...any) {}
	env := `{"name": "prod", "_postman_variable_scope": "environment", "values": [
	  {"key": "base", "value": "https://httpbin.org", "type": "default", "enabled": true},
	  {"key": "tok", "value": "TOP-SECRET", "type": "secret", "enabled": true}]}`
	res := a.ImportPostmanEnvironment("p1", writeFile(t, "prod.json", env))
	if res.Error != nil {
		t.Fatal(res.Error.Message)
	}
	got := strings.Join(*log, "\n")
	if !strings.Contains(got, "env prod") || !strings.Contains(got, "var tok secret") || !strings.Contains(got, `"value":"https://httpbin.org"`) {
		t.Fatalf("server log:\n%s", got)
	}
	if strings.Contains(got, "TOP-SECRET") {
		t.Fatal("a secret value reached the server")
	}
	if res.Data.Summary.Variables != 2 || len(res.Data.Changed) != 1 {
		t.Fatalf("report %+v", res.Data)
	}
}

func TestImportNotLoggedIn(t *testing.T) {
	a := newTestApp(t, false, nil)
	if r := a.ImportPostmanCollection("p1", writeFile(t, "tiny.json", tinyCollection)); r.Error != problemNotLoggedIn {
		t.Fatalf("%+v", r.Error)
	}
}
