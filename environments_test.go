package main

import (
	"context"
	"encoding/json"
	"io"
	"net/http"
	"strings"
	"sync"
	"testing"
)

// The variables table's append row commits key + type + value in one call: a
// regular value goes to the server, a secret's value only to this machine (the
// server sees the create, never the value), and "" writes nothing.
func TestCreateVariableWithValue(t *testing.T) {
	var mu sync.Mutex
	vars := map[string]map[string]any{} // id -> variable as the server holds it
	var bodies []string                 // every request body the server received
	routes := map[string]http.HandlerFunc{
		"POST /api/v1/environments/e1/variables": func(w http.ResponseWriter, r *http.Request) {
			mu.Lock()
			defer mu.Unlock()
			b, _ := io.ReadAll(r.Body)
			bodies = append(bodies, string(b))
			var in map[string]any
			_ = json.Unmarshal(b, &in)
			id := "v" + in["key"].(string)
			vars[id] = map[string]any{"id": id, "key": in["key"], "type": in["type"], "value": nil, "sort_order": len(vars)}
			_ = json.NewEncoder(w).Encode(vars[id])
		},
		"GET /api/v1/environments/e1/variables": func(w http.ResponseWriter, _ *http.Request) {
			mu.Lock()
			defer mu.Unlock()
			out := []map[string]any{}
			for _, v := range vars {
				out = append(out, v)
			}
			_ = json.NewEncoder(w).Encode(out)
		},
		"PATCH /api/v1/variables/{id}": func(w http.ResponseWriter, r *http.Request) {
			mu.Lock()
			defer mu.Unlock()
			b, _ := io.ReadAll(r.Body)
			bodies = append(bodies, string(b))
			v := vars[r.PathValue("id")]
			var in map[string]any
			_ = json.Unmarshal(b, &in)
			v["value"] = in["value"]
			_ = json.NewEncoder(w).Encode(v)
		},
	}
	a := newTestApp(t, true, routes)

	reg := a.CreateVariableWithValue("e1", " BASE_URL ", "regular", "https://api.example.com")
	if reg.Error != nil || reg.Data == nil || reg.Data.Key != "BASE_URL" {
		t.Fatalf("regular: %+v %+v", reg.Data, reg.Error)
	}
	if got := vars["vBASE_URL"]["value"]; got != "https://api.example.com" {
		t.Errorf("regular value on the server = %v", got)
	}

	sec := a.CreateVariableWithValue("e1", "TOKEN", "secret", "s3cr3t-value")
	if sec.Error != nil || sec.Data == nil {
		t.Fatalf("secret: %+v %+v", sec.Data, sec.Error)
	}
	for _, b := range bodies {
		if strings.Contains(b, "s3cr3t-value") {
			t.Fatalf("the secret value reached the server: %s", b)
		}
	}
	if v, ok, err := a.store.Secret(context.Background(), "e1", "TOKEN"); err != nil || !ok || v != "s3cr3t-value" {
		t.Errorf("local secret = %q %v %v", v, ok, err)
	}

	n := len(bodies)
	empty := a.CreateVariableWithValue("e1", "EMPTY", "regular", "")
	if empty.Error != nil || len(bodies) != n+1 { // the create only, no value PATCH
		t.Errorf("empty value: err %v, %d requests", empty.Error, len(bodies)-n)
	}
}
