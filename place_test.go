package main

import (
	"encoding/json"
	"io"
	"net/http"
	"strings"
	"sync"
	"testing"
)

// placeServer fakes the move/reorder endpoints and records the calls in order.
type placeServer struct {
	mu      sync.Mutex
	calls   []string
	failOn  string // a call prefix that answers 400
	failMsg string
}

func (s *placeServer) record(w http.ResponseWriter, r *http.Request, name string) bool {
	s.mu.Lock()
	defer s.mu.Unlock()
	b, _ := io.ReadAll(r.Body)
	var m map[string]any
	_ = json.Unmarshal(b, &m)
	call := name + " " + compact(m)
	s.calls = append(s.calls, call)
	if s.failOn != "" && strings.HasPrefix(call, s.failOn) {
		writeEnvelope(w, http.StatusBadRequest, "invalid_parent", s.failMsg)
		return false
	}
	return true
}

func compact(m map[string]any) string {
	b, _ := json.Marshal(m)
	return string(b)
}

func (s *placeServer) routes() map[string]http.HandlerFunc {
	ok := func(name string) http.HandlerFunc {
		return func(w http.ResponseWriter, r *http.Request) {
			if !s.record(w, r, name+"("+r.PathValue("id")+")") {
				return
			}
			_, _ = w.Write([]byte(`{"id":"x"}`))
		}
	}
	noContent := func(name string) http.HandlerFunc {
		return func(w http.ResponseWriter, r *http.Request) {
			if s.record(w, r, name) {
				w.WriteHeader(http.StatusNoContent)
			}
		}
	}
	return map[string]http.HandlerFunc{
		"POST /api/v1/requests/{id}/move": ok("moveRequest"),
		"POST /api/v1/folders/{id}/move":  ok("moveFolder"),
		"PUT /api/v1/requests/order":      noContent("reorderRequests"),
		"PUT /api/v1/folders/order":       noContent("reorderFolders"),
	}
}

func TestPlaceNode_ComposesMoveAndReorder(t *testing.T) {
	cases := []struct {
		name                  string
		kind, current, target string
		ordered               []string
		want                  []string
	}{
		{
			name: "reorder within the same parent: no move",
			kind: "request", current: "f1", target: "f1", ordered: []string{"r2", "r1"},
			want: []string{`reorderRequests {"folder_id":"f1","project_id":"p1","request_ids":["r2","r1"]}`},
		},
		{
			name: "into another folder at a position: move, then reorder that folder",
			kind: "request", current: "", target: "f2", ordered: []string{"r9", "r1"},
			want: []string{
				`moveRequest(r1) {"folder_id":"f2"}`,
				`reorderRequests {"folder_id":"f2","project_id":"p1","request_ids":["r9","r1"]}`,
			},
		},
		{
			name: "onto a folder (append): move only",
			kind: "request", current: "f1", target: "f2", ordered: nil,
			want: []string{`moveRequest(r1) {"folder_id":"f2"}`},
		},
		{
			name: "folder to the root at a position",
			kind: "folder", current: "f0", target: "", ordered: []string{"r1", "fA"},
			want: []string{
				`moveFolder(r1) {"parent_id":null}`,
				`reorderFolders {"folder_ids":["r1","fA"],"parent_id":null,"project_id":"p1"}`,
			},
		},
	}
	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			srv := &placeServer{}
			a := newTestApp(t, true, srv.routes())
			if res := a.PlaceNode(tc.kind, "p1", "r1", tc.current, tc.target, tc.ordered); res.Error != nil {
				t.Fatalf("error: %+v", res.Error)
			}
			if strings.Join(srv.calls, "\n") != strings.Join(tc.want, "\n") {
				t.Fatalf("calls:\n%s\nwant:\n%s", strings.Join(srv.calls, "\n"), strings.Join(tc.want, "\n"))
			}
		})
	}
}

func TestPlaceNode_SurfacesServerErrorAndStops(t *testing.T) {
	srv := &placeServer{failOn: "moveFolder", failMsg: "a folder cannot be moved into its own subtree"}
	a := newTestApp(t, true, srv.routes())
	res := a.PlaceNode("folder", "p1", "fA", "", "fA-child", []string{"fA"})
	if res.Error == nil || res.Error.Status != 400 || res.Error.Message != "a folder cannot be moved into its own subtree" {
		t.Fatalf("want the server's 400, got %+v", res.Error)
	}
	if len(srv.calls) != 1 {
		t.Fatalf("no reorder after a failed move, got %v", srv.calls)
	}
}

func TestPlaceNode_RejectsUnknownKind(t *testing.T) {
	srv := &placeServer{}
	a := newTestApp(t, true, srv.routes())
	if res := a.PlaceNode("env", "p1", "x", "", "", nil); res.Error == nil || res.Error.Kind != "invalid" {
		t.Fatalf("got %+v", res.Error)
	}
	if len(srv.calls) != 0 {
		t.Fatalf("nothing may be called: %v", srv.calls)
	}
}
