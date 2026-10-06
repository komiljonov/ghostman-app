package main

import (
	"encoding/json"
	"io"
	"net/http"
	"sync"
	"testing"
)

const origRequest = `{"id":"r1","project_id":"p1","folder_id":"f1","name":"req1","method":"POST",
"url":"{{BASE}}/x","sort_order":0,"created_at":"","updated_at":"",
"headers":[{"key":"X-A","value":"1","enabled":true},{"key":"X-B","value":"2","enabled":false}],
"query_params":[{"key":"q","value":"v","enabled":true}],
"body":{"type":"raw","content_type":"application/json","content":"{\"a\":1}"}}`

// dupServer fakes the request endpoints and records what the client sent.
type dupServer struct {
	mu       sync.Mutex
	created  map[string]any
	patched  map[string]any
	deleted  []string
	patchErr bool
	makeErr  bool
}

func (s *dupServer) routes() map[string]http.HandlerFunc {
	decode := func(r *http.Request) map[string]any {
		var m map[string]any
		b, _ := io.ReadAll(r.Body)
		_ = json.Unmarshal(b, &m)
		return m
	}
	return map[string]http.HandlerFunc{
		"GET /api/v1/requests/{id}": func(w http.ResponseWriter, r *http.Request) {
			if r.PathValue("id") != "r1" {
				writeEnvelope(w, 404, "not_found", "request not found")
				return
			}
			_, _ = w.Write([]byte(origRequest))
		},
		"POST /api/v1/projects/{project_id}/requests": func(w http.ResponseWriter, r *http.Request) {
			s.mu.Lock()
			defer s.mu.Unlock()
			if s.makeErr {
				writeEnvelope(w, 403, "forbidden", "no access to this project")
				return
			}
			s.created = decode(r)
			s.created["project_id"] = r.PathValue("project_id")
			w.WriteHeader(http.StatusCreated)
			_, _ = w.Write([]byte(`{"id":"r2","project_id":"p1","folder_id":"f1","name":"req1 copy","method":"POST","url":"{{BASE}}/x"}`))
		},
		"PATCH /api/v1/requests/{id}": func(w http.ResponseWriter, r *http.Request) {
			s.mu.Lock()
			defer s.mu.Unlock()
			if s.patchErr {
				writeEnvelope(w, 422, "validation_failed", "header key is too long")
				return
			}
			s.patched = decode(r)
			s.patched["id"] = r.PathValue("id")
			_, _ = w.Write([]byte(`{"id":"r2","project_id":"p1","folder_id":"f1","name":"req1 copy","method":"POST","url":"{{BASE}}/x"}`))
		},
		"DELETE /api/v1/requests/{id}": func(w http.ResponseWriter, r *http.Request) {
			s.mu.Lock()
			defer s.mu.Unlock()
			s.deleted = append(s.deleted, r.PathValue("id"))
			w.WriteHeader(http.StatusNoContent)
		},
	}
}

func TestDuplicateRequest_ComposesCopy(t *testing.T) {
	srv := &dupServer{}
	a := newTestApp(t, true, srv.routes())

	res := a.DuplicateRequest("r1")
	if res.Error != nil || res.Data == nil || res.Data.ID != "r2" || res.Data.Name != "req1 copy" {
		t.Fatalf("result = %+v / %+v", res.Data, res.Error)
	}
	c := srv.created
	if c["project_id"] != "p1" || c["name"] != "req1 copy" || c["folder_id"] != "f1" || c["method"] != "POST" || c["url"] != "{{BASE}}/x" {
		t.Errorf("create body = %v", c)
	}
	p := srv.patched
	if p["id"] != "r2" {
		t.Fatalf("patched %v, want the copy r2", p["id"])
	}
	want := map[string]string{
		"headers":      `[{"enabled":true,"key":"X-A","value":"1"},{"enabled":false,"key":"X-B","value":"2"}]`,
		"query_params": `[{"enabled":true,"key":"q","value":"v"}]`,
		"body":         `{"content":"{\"a\":1}","content_type":"application/json","type":"raw"}`,
		"method":       `"POST"`,
		"url":          `"{{BASE}}/x"`,
	}
	for k, w := range want {
		if got := toJSON(t, p[k]); got != w {
			t.Errorf("patch %s = %s, want %s", k, got, w)
		}
	}
	if len(srv.deleted) != 0 {
		t.Errorf("nothing must be deleted on success, got %v", srv.deleted)
	}
}

func TestDuplicateRequest_RollsBackHalfMadeCopy(t *testing.T) {
	srv := &dupServer{patchErr: true}
	a := newTestApp(t, true, srv.routes())

	res := a.DuplicateRequest("r1")
	if res.Data != nil || res.Error == nil || res.Error.Message != "header key is too long" || res.Error.Status != 422 {
		t.Fatalf("want the patch's problem, got %+v / %+v", res.Data, res.Error)
	}
	if len(srv.deleted) != 1 || srv.deleted[0] != "r2" {
		t.Fatalf("the partial copy must be deleted, got %v", srv.deleted)
	}
}

func TestDuplicateRequest_EarlyFailuresCreateNothing(t *testing.T) {
	srv := &dupServer{makeErr: true}
	a := newTestApp(t, true, srv.routes())
	if res := a.DuplicateRequest("r1"); res.Error == nil || res.Error.Status != 403 {
		t.Fatalf("create failure: %+v", res.Error)
	}
	if res := a.DuplicateRequest("missing"); res.Error == nil || res.Error.Status != 404 {
		t.Fatalf("get failure: %+v", res.Error)
	}
	if len(srv.deleted) != 0 || srv.patched != nil {
		t.Fatalf("no follow-up calls expected: deleted=%v patched=%v", srv.deleted, srv.patched)
	}
}
