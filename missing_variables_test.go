package main

import (
	"encoding/json"
	"io"
	"net/http"
	"reflect"
	"sync"
	"testing"
)

// Add missing variables: the server's used keys minus the environment's (a
// secret counts), then each chosen key created regular with "" — one failure
// does not stop the rest.
func TestMissingVariables(t *testing.T) {
	var mu sync.Mutex
	vars := []map[string]any{
		{"id": "v1", "key": "base_url", "type": "regular", "value": "https://x", "sort_order": 0},
		{"id": "v2", "key": "password", "type": "secret", "value": nil, "sort_order": 1},
	}
	var valueWrites []string
	a := newTestApp(t, true, map[string]http.HandlerFunc{
		"GET /api/v1/projects/{project_id}/variable-keys": func(w http.ResponseWriter, _ *http.Request) {
			_, _ = w.Write([]byte(`{"keys":["access_token","base_url","password","product_id","taken"]}`))
		},
		"GET /api/v1/environments/{id}/variables": func(w http.ResponseWriter, _ *http.Request) {
			mu.Lock()
			defer mu.Unlock()
			_ = json.NewEncoder(w).Encode(vars)
		},
		"POST /api/v1/environments/{id}/variables": func(w http.ResponseWriter, r *http.Request) {
			mu.Lock()
			defer mu.Unlock()
			var in map[string]any
			raw, _ := io.ReadAll(r.Body)
			_ = json.Unmarshal(raw, &in)
			if in["key"] == "taken" {
				writeEnvelope(w, 409, "conflict", "a variable with this key already exists")
				return
			}
			v := map[string]any{"id": "n-" + in["key"].(string), "key": in["key"], "type": in["type"], "value": nil, "sort_order": len(vars)}
			vars = append(vars, v)
			_ = json.NewEncoder(w).Encode(v)
		},
		"PATCH /api/v1/variables/{id}": func(w http.ResponseWriter, r *http.Request) {
			mu.Lock()
			defer mu.Unlock()
			raw, _ := io.ReadAll(r.Body)
			valueWrites = append(valueWrites, r.PathValue("id")+" "+string(raw))
			for _, v := range vars {
				if v["id"] == r.PathValue("id") {
					_ = json.NewEncoder(w).Encode(v)
					return
				}
			}
			writeEnvelope(w, 404, "not_found", "variable not found")
		},
	})
	m := a.MissingVariables("p1", "e1")
	if m.Error != nil || !reflect.DeepEqual(m.Data, []string{"access_token", "product_id", "taken"}) {
		t.Fatalf("missing = %v %v", m.Data, m.Error)
	}
	res := a.CreateMissingVariables("e1", []string{"access_token", "taken", "product_id"})
	if res.Error != nil || !reflect.DeepEqual(res.Data.Created, []string{"access_token", "product_id"}) ||
		len(res.Data.Failed) != 1 || res.Data.Failed[0].Key != "taken" || res.Data.Failed[0].Message == "" {
		t.Fatalf("created = %+v %v", res.Data, res.Error)
	}
	if !reflect.DeepEqual(valueWrites, []string{`n-access_token {"value":""}`, `n-product_id {"value":""}`}) {
		t.Fatalf("value writes = %q (regular variables get the value \"\")", valueWrites)
	}
	if again := a.MissingVariables("p1", "e1"); !reflect.DeepEqual(again.Data, []string{"taken"}) {
		t.Fatalf("after creating: %v", again.Data)
	}
}
