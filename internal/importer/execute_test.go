package importer

import (
	"context"
	"encoding/json"
	"fmt"
	"net/http"
	"net/http/httptest"
	"sort"
	"strings"
	"sync"
	"testing"
	"unicode/utf8"

	"ghostman/internal/api"
)

// fakeServer is an in-memory Ghostman server with the endpoints the import uses,
// enforcing the real name limit (100 characters) so failures look like the server's.
type fakeServer struct {
	mu           sync.Mutex
	n            int
	folders      []map[string]any
	requests     map[string]map[string]any
	order        []string // request ids in creation order
	envs         []map[string]any
	deleted      []string
	failPatchFor string // a request name whose PATCH is rejected
}

func (f *fakeServer) id() string { f.n++; return fmt.Sprintf("id-%03d", f.n) }

func reject(w http.ResponseWriter, status int, msg string) {
	w.WriteHeader(status)
	_ = json.NewEncoder(w).Encode(map[string]any{"error": map[string]string{"code": "validation_failed", "message": msg}})
}

func nameOK(w http.ResponseWriter, name string) bool {
	if n := utf8.RuneCountInString(strings.TrimSpace(name)); n < 1 || n > 100 {
		reject(w, 400, "name must be between 1 and 100 characters")
		return false
	}
	return true
}

func newFake(t *testing.T) (*fakeServer, *api.APIClient) {
	f := &fakeServer{requests: map[string]map[string]any{}}
	mux := http.NewServeMux()
	mux.HandleFunc("GET /api/v1/projects/{p}/folders", func(w http.ResponseWriter, r *http.Request) {
		f.mu.Lock()
		defer f.mu.Unlock()
		_ = json.NewEncoder(w).Encode(f.folders)
	})
	mux.HandleFunc("POST /api/v1/projects/{p}/folders", func(w http.ResponseWriter, r *http.Request) {
		var in map[string]any
		_ = json.NewDecoder(r.Body).Decode(&in)
		if !nameOK(w, in["name"].(string)) {
			return
		}
		f.mu.Lock()
		defer f.mu.Unlock()
		folder := map[string]any{"id": f.id(), "name": in["name"], "parent_id": in["parent_id"], "auth": map[string]any{"type": "inherit"}}
		f.folders = append(f.folders, folder)
		_ = json.NewEncoder(w).Encode(folder)
	})
	mux.HandleFunc("PATCH /api/v1/folders/{id}", func(w http.ResponseWriter, r *http.Request) {
		var in map[string]any
		_ = json.NewDecoder(r.Body).Decode(&in)
		f.mu.Lock()
		defer f.mu.Unlock()
		for _, folder := range f.folders {
			if folder["id"] == r.PathValue("id") {
				for k, v := range in {
					folder[k] = v
				}
				_ = json.NewEncoder(w).Encode(folder)
				return
			}
		}
		reject(w, 404, "folder not found")
	})
	mux.HandleFunc("POST /api/v1/projects/{p}/requests", func(w http.ResponseWriter, r *http.Request) {
		var in map[string]any
		_ = json.NewDecoder(r.Body).Decode(&in)
		if !nameOK(w, in["name"].(string)) {
			return
		}
		f.mu.Lock()
		defer f.mu.Unlock()
		req := map[string]any{"id": f.id(), "name": in["name"], "folder_id": in["folder_id"], "method": in["method"], "url": in["url"]}
		f.requests[req["id"].(string)] = req
		f.order = append(f.order, req["id"].(string))
		_ = json.NewEncoder(w).Encode(req)
	})
	mux.HandleFunc("PATCH /api/v1/requests/{id}", func(w http.ResponseWriter, r *http.Request) {
		var in map[string]any
		_ = json.NewDecoder(r.Body).Decode(&in)
		f.mu.Lock()
		defer f.mu.Unlock()
		req := f.requests[r.PathValue("id")]
		if req == nil {
			reject(w, 404, "request not found")
			return
		}
		if req["name"] == f.failPatchFor {
			reject(w, 400, "headers[0].value must be at most 8192 characters")
			return
		}
		for k, v := range in {
			req[k] = v
		}
		_ = json.NewEncoder(w).Encode(req)
	})
	mux.HandleFunc("DELETE /api/v1/requests/{id}", func(w http.ResponseWriter, r *http.Request) {
		f.mu.Lock()
		defer f.mu.Unlock()
		delete(f.requests, r.PathValue("id"))
		f.deleted = append(f.deleted, r.PathValue("id"))
		w.WriteHeader(http.StatusNoContent)
	})
	mux.HandleFunc("GET /api/v1/projects/{p}/environments", func(w http.ResponseWriter, r *http.Request) {
		f.mu.Lock()
		defer f.mu.Unlock()
		_ = json.NewEncoder(w).Encode(f.envs)
	})
	mux.HandleFunc("POST /api/v1/projects/{p}/environments", func(w http.ResponseWriter, r *http.Request) {
		var in map[string]any
		_ = json.NewDecoder(r.Body).Decode(&in)
		if !nameOK(w, in["name"].(string)) {
			return
		}
		f.mu.Lock()
		defer f.mu.Unlock()
		env := map[string]any{"id": f.id(), "name": in["name"]}
		f.envs = append(f.envs, env)
		_ = json.NewEncoder(w).Encode(env)
	})
	srv := httptest.NewServer(mux)
	t.Cleanup(srv.Close)
	return f, api.New(srv.URL)
}

// tree renders the fake server's folders + requests as an indented outline.
func (f *fakeServer) tree() string {
	f.mu.Lock()
	defer f.mu.Unlock()
	var b strings.Builder
	var walk func(parent any, depth int)
	walk = func(parent any, depth int) {
		for _, folder := range f.folders {
			if folder["parent_id"] == parent {
				fmt.Fprintf(&b, "%s[%s]", strings.Repeat("  ", depth), folder["name"])
				if a, ok := folder["auth"].(map[string]any); ok && a["type"] != "inherit" {
					fmt.Fprintf(&b, " auth=%s", a["type"])
				}
				b.WriteString("\n")
				walk(folder["id"], depth+1)
			}
		}
		for _, id := range f.order {
			req := f.requests[id]
			if req != nil && req["folder_id"] == parent {
				fmt.Fprintf(&b, "%s%s %s\n", strings.Repeat("  ", depth), req["method"], req["name"])
			}
		}
	}
	walk(nil, 0)
	return b.String()
}

func TestImportCollectionEndToEnd(t *testing.T) {
	f, c := newFake(t)
	var progress []string
	rep, failure, err := ImportCollection(context.Background(), c, "p1", "P1", fixture(t, "shop.postman_collection.json"),
		"shop.json", func(done, total int) { progress = append(progress, fmt.Sprintf("%d/%d", done, total)) })
	if err != nil || failure != nil {
		t.Fatal(err, failure)
	}
	want := `[Shop API] auth=bearer
  [Orders]
    [Archive]
      [Old]
        GET Get old
    POST Create order
    GET Export
  [Admin]
    DELETE Purge cache
  [Users]
    GET Get user
    POST Login
    GET Key in query
    GET Key in cookie
    GET Public
    GET Signed
  [Bodies]
    POST Search
    POST Upload avatar
    POST XML by header
    POST Plain
    PUT Binary
    POST Odd mode
    POST Muted body
    GET No redirects
  GET Ping
  GET Bare string
  GET Untitled request
`
	if got := f.tree(); got != want {
		t.Fatalf("server tree:\n%s\nwant:\n%s", got, want)
	}
	if rep.Summary != (Summary{Folders: 7, Requests: 21}) || rep.Target != "P1 / Shop API" || rep.Stopped != "" {
		t.Fatalf("summary %+v target %q stopped %q", rep.Summary, rep.Target, rep.Stopped)
	}
	if len(rep.Imported) != 28 || len(rep.Failed) != 0 {
		t.Fatalf("imported %d failed %d", len(rep.Imported), len(rep.Failed))
	}
	if progress[0] != "0/27" || progress[len(progress)-1] != "27/27" {
		t.Fatalf("progress %v", progress)
	}
	// The created request carries its contents (one PATCH): body verbatim, rows, auth.
	var create map[string]any
	for _, r := range f.requests {
		if r["name"] == "Create order" {
			create = r
		}
	}
	body := create["body"].(map[string]any)
	if body["content_type"] != "application/json" || !strings.Contains(body["content"].(string), `"qty": {{qty}}`) {
		t.Fatalf("body %v", body)
	}
	if q := create["query_params"].([]any); len(q) != 2 || q[1].(map[string]any)["enabled"] != false {
		t.Fatalf("query %v", q)
	}
	loc := ""
	for _, e := range rep.Imported {
		if e.Path == "Shop API / Orders / Create order" {
			loc = e.Location
		}
	}
	if loc != "P1 / Shop API / Orders / Create order" {
		t.Fatalf("location %q", loc)
	}
	// The plain-text report holds everything, collapsed script text included.
	for _, s := range []string{"IMPORTED WITH CHANGES", "DROPPED", "method 'PURGE'", "pm.variables.set('orderId', id);",
		"→ P1 / Shop API / Orders / Create order"} {
		if !strings.Contains(rep.Text, s) {
			t.Fatalf("report text lacks %q:\n%s", s, rep.Text)
		}
	}

	// Importing the same file again: "(2)", nothing merged.
	rep2, _, _ := ImportCollection(context.Background(), c, "p1", "P1", fixture(t, "shop.postman_collection.json"), "shop.json", nil)
	if rep2.Target != "P1 / Shop API (2)" || rep2.Summary.Requests != 21 {
		t.Fatalf("second import: %q %+v", rep2.Target, rep2.Summary)
	}
	var roots []string
	for _, folder := range f.folders {
		if folder["parent_id"] == nil {
			roots = append(roots, folder["name"].(string))
		}
	}
	sort.Strings(roots)
	if strings.Join(roots, "|") != "Shop API|Shop API (2)" {
		t.Fatalf("roots %v", roots)
	}
}

// A collection whose 3rd item has a 101-character name: the first two are created,
// the server's message is reported, the import stops with the undo banner.
func TestImportStopsAtServerFailure(t *testing.T) {
	long := strings.Repeat("n", 101)
	file := `{"info": {"name": "Big", "schema": "https://schema.getpostman.com/json/collection/v2.1.0/collection.json"},
	  "item": [
	    {"name": "F", "item": [{"name": "one", "request": {"method": "GET", "url": "https://x/1"}}]},
	    {"name": "` + long + `", "request": {"method": "GET", "url": "https://x/2"}},
	    {"name": "three", "request": {"method": "GET", "url": "https://x/3"}},
	    {"name": "four", "request": {"method": "GET", "url": "https://x/4"}}
	  ]}`
	f, c := newFake(t)
	rep, failure, err := ImportCollection(context.Background(), c, "p1", "P1", []byte(file), "big.json", nil)
	if err != nil || failure == nil {
		t.Fatalf("err %v failure %v", err, failure)
	}
	if got := f.tree(); got != "[Big]\n  [F]\n    GET one\n" {
		t.Fatalf("partial tree:\n%s", got)
	}
	if rep.Stopped != "Import stopped at item 3 of 5 after a server error. Everything above was created inside folder "+
		"'Big'; delete that folder to undo, fix the issue, re-import." {
		t.Fatalf("banner %q", rep.Stopped)
	}
	if len(rep.Failed) != 2 || rep.Failed[0].Path != "Big / "+long ||
		rep.Failed[0].Message != "server rejected creation (400: name must be between 1 and 100 characters). NOT imported." ||
		rep.Failed[1].Message != "2 more items were not imported because the import stopped." {
		t.Fatalf("failed %+v", rep.Failed)
	}
	if rep.Summary != (Summary{Folders: 2, Requests: 1}) {
		t.Fatalf("summary %+v", rep.Summary)
	}
	if !strings.Contains(rep.Text, "!! Import stopped at item 3 of 5") || !strings.Contains(rep.Text, "FAILED (2)") {
		t.Fatalf("text:\n%s", rep.Text)
	}
}

// A rejected PATCH removes the half-made request, then stops.
func TestRejectedContentsRemoveTheRequest(t *testing.T) {
	f, c := newFake(t)
	f.failPatchFor = "Create order"
	rep, failure, _ := ImportCollection(context.Background(), c, "p1", "P1", fixture(t, "shop.postman_collection.json"), "shop.json", nil)
	if failure == nil || len(f.deleted) != 1 {
		t.Fatalf("failure %v deleted %v", failure, f.deleted)
	}
	for _, r := range f.requests {
		if r["name"] == "Create order" {
			t.Fatal("the half-made request is still there")
		}
	}
	if !strings.Contains(rep.Failed[0].Message, "server rejected its headers / params / body / auth (400: headers[0].value") {
		t.Fatalf("failed %+v", rep.Failed[0])
	}
}

func TestRootFolderFailure(t *testing.T) {
	_, c := newFake(t)
	file := `{"info": {"name": "` + strings.Repeat("x", 101) + `"}, "item": [{"name": "a", "request": "https://x"}]}`
	rep, failure, _ := ImportCollection(context.Background(), c, "p1", "P1", []byte(file), "x.json", nil)
	if failure == nil || rep.Target != "" || !strings.HasPrefix(rep.Stopped, "Import stopped before anything was created") {
		t.Fatalf("%+v", rep)
	}
}

// fakeVars records variable writes (the app passes internal/envs, which routes
// secrets to local storage).
type fakeVars struct {
	created []string
	values  map[string]string
	failKey string
}

func (v *fakeVars) CreateVariable(_ context.Context, envID, key, typ string) (api.Variable, error) {
	if key == v.failKey {
		return api.Variable{}, &api.APIError{Status: 409, Message: "a variable with this key already exists"}
	}
	v.created = append(v.created, key+":"+typ)
	return api.Variable{ID: "var-" + key, Key: key, Type: typ}, nil
}

func (v *fakeVars) SetValue(_ context.Context, envID, varID, value string) error {
	v.values[varID] = value
	return nil
}

func TestImportEnvironment(t *testing.T) {
	_, c := newFake(t)
	vw := &fakeVars{values: map[string]string{}}
	rep, failure, err := ImportEnvironment(context.Background(), c, vw, "p1", "P1", fixture(t, "prod.postman_environment.json"), "prod.json", nil)
	if err != nil || failure != nil {
		t.Fatal(err, failure)
	}
	if strings.Join(vw.created, ",") != "baseUrl:regular,token:secret,apiKey:secret,legacy_url:regular,retries:regular,templated:regular" {
		t.Fatalf("created %v", vw.created)
	}
	if _, ok := vw.values["var-token"]; ok {
		t.Fatal("a secret value was written")
	}
	if vw.values["var-templated"] != "{{baseUrl}}/v2" || vw.values["var-retries"] != "3" {
		t.Fatalf("values %v", vw.values)
	}
	if rep.Summary != (Summary{Environments: 1, Variables: 6}) || rep.Target != "P1 / prod" {
		t.Fatalf("%+v %q", rep.Summary, rep.Target)
	}
	// Again: a second environment, never merged.
	rep2, _, _ := ImportEnvironment(context.Background(), c, &fakeVars{values: map[string]string{}}, "p1", "P1",
		fixture(t, "prod.postman_environment.json"), "prod.json", nil)
	if rep2.Target != "P1 / prod (2)" {
		t.Fatal(rep2.Target)
	}
	// A failing variable stops with the environment banner.
	vw3 := &fakeVars{values: map[string]string{}, failKey: "legacy_url"}
	rep3, failure3, _ := ImportEnvironment(context.Background(), c, vw3, "p1", "P1", fixture(t, "prod.postman_environment.json"), "prod.json", nil)
	if failure3 == nil || rep3.Stopped != "Import stopped at variable 4 of 6 after a server error. Everything above was created "+
		"in environment 'prod (3)'; delete that environment to undo, fix the issue, re-import." ||
		!strings.Contains(rep3.Failed[0].Message, "409: a variable with this key already exists") ||
		rep3.Failed[1].Message != "2 more variables were not imported because the import stopped." {
		t.Fatalf("%q %+v", rep3.Stopped, rep3.Failed)
	}
}
