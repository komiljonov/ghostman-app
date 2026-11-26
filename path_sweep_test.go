package main

import (
	"context"
	"database/sql"
	"encoding/json"
	"io"
	"net/http"
	"os"
	"sync"
	"testing"

	"ghostman/internal/store"
)

// The one-time sweep of retired path variables (path_sweep.go): values from the
// local history cache, else {{key}}; gone requests skipped; marked done only when
// every rewrite was saved; idempotent.
func TestPathVariableSweep(t *testing.T) {
	var mu sync.Mutex
	urls := map[string]string{
		"r1": "{{base_url}}/api/v1/products/:product_id/prices", // cached value {{product_id}}
		"r2": "https://api.test/users/:id",                      // cached literal "123"
		"r3": "https://api.test/orders/:order_id?x=:q",          // nothing cached → {{order_id}}
		"r4": "https://api.test/plain",                          // nothing to do
		"r5": "https://api.test/gone/:id",                       // 404 on save: skipped
	}
	failR3 := true
	patches := 0
	a := newTestApp(t, true, map[string]http.HandlerFunc{
		"GET /api/v1/projects/{project_id}/requests": func(w http.ResponseWriter, _ *http.Request) {
			mu.Lock()
			defer mu.Unlock()
			var out []map[string]any
			for _, id := range []string{"r1", "r2", "r3", "r4", "r5"} {
				out = append(out, map[string]any{"id": id, "project_id": "p1", "name": id, "method": "GET", "url": urls[id]})
			}
			_ = json.NewEncoder(w).Encode(out)
		},
		"PATCH /api/v1/requests/{id}": func(w http.ResponseWriter, r *http.Request) {
			mu.Lock()
			defer mu.Unlock()
			id := r.PathValue("id")
			raw, _ := io.ReadAll(r.Body)
			var body map[string]any
			_ = json.Unmarshal(raw, &body)
			if len(body) != 1 || body["url"] == nil {
				t.Errorf("the sweep must PATCH the url only, got %s", raw)
			}
			patches++
			if id == "r5" {
				writeEnvelope(w, 404, "not_found", "request not found")
				return
			}
			if id == "r3" && failR3 {
				writeEnvelope(w, 500, "internal", "boom")
				return
			}
			urls[id] = body["url"].(string)
			_ = json.NewEncoder(w).Encode(map[string]any{"id": id, "url": urls[id]})
		},
	})
	ctx := context.Background()
	// The cache: an older and a newer history row for r1 (newest wins), one for r2.
	for i, h := range []struct{ req, params string }{
		{"r1", `[{"key":"product_id","value":"stale"}]`},
		{"r1", `[{"key":"product_id","value":"{{product_id}}"}]`},
		{"r2", `[{"key":"id","value":"123"}]`},
	} {
		id, err := a.store.AddHistory(ctx, store.InsertHistoryParams{CreatedAt: int64(1000 + i), Method: "GET", UrlTemplate: "x",
			ProjectID: sql.NullString{String: "p1", Valid: true}, RequestID: sql.NullString{String: h.req, Valid: true}})
		if err != nil {
			t.Fatal(err)
		}
		setPathParamsColumn(t, id, h.params)
	}

	c := a.client
	a.sweepPathVariables(ctx, c, "p1")
	if urls["r1"] != "{{base_url}}/api/v1/products/{{product_id}}/prices" || urls["r2"] != "https://api.test/users/123" {
		t.Fatalf("after the first sweep: %v", urls)
	}
	if v, _ := a.setting(settingPathSweptPrefix + "p1"); v == "1" {
		t.Fatal("a failed save must leave the project unmarked (retried next load)")
	}

	failR3 = false
	a.sweepPathVariables(ctx, c, "p1")
	if urls["r3"] != "https://api.test/orders/{{order_id}}?x=:q" || urls["r4"] != "https://api.test/plain" {
		t.Fatalf("after the retry: %v", urls)
	}
	if v, _ := a.setting(settingPathSweptPrefix + "p1"); v != "1" {
		t.Fatal("all saved (404 skipped): the project is marked swept")
	}

	before := patches
	a.sweepPathVariables(ctx, c, "p1") // marked: nothing happens
	if patches != before {
		t.Fatal("a swept project is not swept again")
	}

	// Parallel workspace calls at startup (another project, fresh URLs): ONE
	// sweep does the work, the others wait and see the flag.
	mu.Lock()
	urls["r1"], urls["r2"], urls["r3"] = "https://a.test/:x", "https://a.test/:y", "https://a.test/:z"
	before = patches
	mu.Unlock()
	var wg sync.WaitGroup
	for range 3 {
		wg.Add(1)
		go func() { defer wg.Done(); a.sweepPathVariables(ctx, c, "p2") }()
	}
	wg.Wait()
	if got := patches - before; got != 4 { // r1–r3 + the 404 of r5, once each
		t.Fatalf("parallel sweeps sent %d PATCHes, want 4", got)
	}
}

// setPathParamsColumn writes the retired column directly (nothing writes it any more).
func setPathParamsColumn(t *testing.T, id int64, params string) {
	t.Helper()
	db, err := sql.Open("sqlite", os.Getenv("GHOSTMAN_DB"))
	if err != nil {
		t.Fatal(err)
	}
	defer db.Close()
	if _, err := db.Exec(`UPDATE history SET req_path_params_json = ? WHERE id = ?`, params, id); err != nil {
		t.Fatal(err)
	}
}
