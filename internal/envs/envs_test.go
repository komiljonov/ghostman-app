package envs

import (
	"context"
	"encoding/json"
	"fmt"
	"io"
	"net/http"
	"net/http/httptest"
	"path/filepath"
	"strings"
	"sync"
	"testing"

	"ghostman/internal/api"
	"ghostman/internal/store"
)

// fakeServer implements the server's environment/variable rules in memory and
// records every request body, so tests can prove secrets never left the machine.
type fakeServer struct {
	mu     sync.Mutex
	envs   map[string][]string // project -> env ids
	names  map[string]string   // env id -> name
	vars   map[string]*api.Variable
	order  map[string][]string // env id -> var ids
	nextID int
	bodies []string // "METHOD path body"
}

func newFakeServer(t *testing.T) (*fakeServer, *api.APIClient) {
	f := &fakeServer{envs: map[string][]string{}, names: map[string]string{}, vars: map[string]*api.Variable{}, order: map[string][]string{}}
	mux := http.NewServeMux()
	writeErr := func(w http.ResponseWriter, status int, msg string) {
		w.WriteHeader(status)
		_ = json.NewEncoder(w).Encode(map[string]any{"error": map[string]string{"code": "x", "message": msg}})
	}
	mux.HandleFunc("GET /api/v1/projects/{p}/environments", func(w http.ResponseWriter, r *http.Request) {
		out := []api.Environment{}
		for _, id := range f.envs[r.PathValue("p")] {
			out = append(out, api.Environment{ID: id, Name: f.names[id]})
		}
		_ = json.NewEncoder(w).Encode(out)
	})
	mux.HandleFunc("DELETE /api/v1/environments/{id}", func(w http.ResponseWriter, r *http.Request) {
		id := r.PathValue("id")
		for p, ids := range f.envs {
			f.envs[p] = remove(ids, id)
		}
		w.WriteHeader(http.StatusNoContent)
	})
	mux.HandleFunc("GET /api/v1/environments/{e}/variables", func(w http.ResponseWriter, r *http.Request) {
		out := []api.Variable{}
		for _, id := range f.order[r.PathValue("e")] {
			out = append(out, *f.vars[id])
		}
		_ = json.NewEncoder(w).Encode(out)
	})
	mux.HandleFunc("POST /api/v1/environments/{e}/variables", func(w http.ResponseWriter, r *http.Request) {
		var in map[string]any
		_ = json.NewDecoder(r.Body).Decode(&in)
		if in["type"] == api.VarSecret && in["value"] != nil {
			writeErr(w, 400, "secret values are never stored on the server")
			return
		}
		f.nextID++
		v := &api.Variable{ID: fmt.Sprintf("v%d", f.nextID), Key: in["key"].(string), Type: in["type"].(string)}
		f.vars[v.ID] = v
		f.order[r.PathValue("e")] = append(f.order[r.PathValue("e")], v.ID)
		_ = json.NewEncoder(w).Encode(v)
	})
	mux.HandleFunc("PATCH /api/v1/variables/{id}", func(w http.ResponseWriter, r *http.Request) {
		v := f.vars[r.PathValue("id")]
		var in map[string]json.RawMessage
		_ = json.NewDecoder(r.Body).Decode(&in)
		next := *v
		if raw, ok := in["key"]; ok {
			_ = json.Unmarshal(raw, &next.Key)
		}
		if raw, ok := in["type"]; ok {
			_ = json.Unmarshal(raw, &next.Type)
		}
		if raw, ok := in["value"]; ok {
			next.Value = nil
			_ = json.Unmarshal(raw, &next.Value)
		}
		if next.Type == api.VarSecret {
			if _, sent := in["value"]; sent && next.Value != nil && *next.Value != "" {
				writeErr(w, 400, "secret values are never stored on the server")
				return
			}
			next.Value = nil // becoming (or being) secret discards the value
		}
		*v = next
		_ = json.NewEncoder(w).Encode(v)
	})
	mux.HandleFunc("DELETE /api/v1/variables/{id}", func(w http.ResponseWriter, r *http.Request) {
		id := r.PathValue("id")
		delete(f.vars, id)
		for e, ids := range f.order {
			f.order[e] = remove(ids, id)
		}
		w.WriteHeader(http.StatusNoContent)
	})
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		f.mu.Lock()
		defer f.mu.Unlock()
		raw, _ := io.ReadAll(r.Body)
		f.bodies = append(f.bodies, r.Method+" "+r.URL.Path+" "+string(raw))
		r.Body = io.NopCloser(strings.NewReader(string(raw)))
		mux.ServeHTTP(w, r)
	}))
	t.Cleanup(srv.Close)
	c := api.New(srv.URL)
	c.SetToken("tok")
	return f, c
}

func remove(ids []string, id string) []string {
	out := []string{}
	for _, x := range ids {
		if x != id {
			out = append(out, x)
		}
	}
	return out
}

func (f *fakeServer) addEnv(project, id, name string) {
	f.envs[project] = append(f.envs[project], id)
	f.names[id] = name
}

// sawAnywhere reports whether s appeared in any request body.
func (f *fakeServer) sawAnywhere(s string) bool {
	for _, b := range f.bodies {
		if strings.Contains(b, s) {
			return true
		}
	}
	return false
}

func setup(t *testing.T) (*Manager, *store.Store, *fakeServer, *api.APIClient) {
	t.Helper()
	st, err := store.Open(context.Background(), filepath.Join(t.TempDir(), "app.db"))
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() { _ = st.Close() })
	f, c := newFakeServer(t)
	f.addEnv("p1", "dev", "dev")
	f.addEnv("p1", "prod", "prod")
	return New(st), st, f, c
}

func mustCreate(t *testing.T, m *Manager, c Client, env, key, typ string) api.Variable {
	t.Helper()
	v, err := m.CreateVariable(context.Background(), c, env, key, typ)
	if err != nil {
		t.Fatal(err)
	}
	return v
}

func TestSecretValueNeverReachesTheServer(t *testing.T) {
	ctx := context.Background()
	m, st, f, c := setup(t)
	tok := mustCreate(t, m, c, "dev", "API_TOKEN", api.VarSecret)

	if err := m.SetValue(ctx, c, "dev", tok.ID, "hunter2-secret"); err != nil {
		t.Fatal(err)
	}
	if f.sawAnywhere("hunter2-secret") {
		t.Fatalf("secret value was sent to the server: %q", f.bodies)
	}
	for _, b := range f.bodies {
		if strings.HasPrefix(b, "PATCH") {
			t.Fatalf("setting a secret value must not PATCH at all: %q", b)
		}
	}
	if v, ok, _ := st.Secret(ctx, "dev", "API_TOKEN"); !ok || v != "hunter2-secret" {
		t.Fatalf("local secret = %q %v", v, ok)
	}
	if f.vars[tok.ID].Value != nil {
		t.Fatal("server holds a value for the secret")
	}
	// The create request itself carried no value field.
	if !f.sawAnywhere(`POST /api/v1/environments/dev/variables {"key":"API_TOKEN","type":"secret"}`) {
		t.Fatalf("create body: %q", f.bodies)
	}

	// Clearing removes the local value ("not set on this machine").
	if err := m.SetValue(ctx, c, "dev", tok.ID, ""); err != nil {
		t.Fatal(err)
	}
	if _, ok, _ := st.Secret(ctx, "dev", "API_TOKEN"); ok {
		t.Fatal("local secret not removed")
	}
}

func TestStaleUIStillCannotUploadASecret(t *testing.T) {
	ctx := context.Background()
	m, st, f, c := setup(t)
	v := mustCreate(t, m, c, "dev", "K", api.VarRegular)
	// Someone else made it secret on the server; this client still thinks it is regular.
	f.vars[v.ID].Type = api.VarSecret
	if err := m.SetValue(ctx, c, "dev", v.ID, "typed-as-regular"); err != nil {
		t.Fatal(err)
	}
	if f.sawAnywhere("typed-as-regular") {
		t.Fatal("value sent although the variable is secret on the server")
	}
	if got, _, _ := st.Secret(ctx, "dev", "K"); got != "typed-as-regular" {
		t.Fatalf("local = %q", got)
	}
}

func TestRegularValueGoesToServer(t *testing.T) {
	ctx := context.Background()
	m, st, f, c := setup(t)
	v := mustCreate(t, m, c, "dev", "BASE_URL", api.VarRegular)
	if err := m.SetValue(ctx, c, "dev", v.ID, "https://dev.example"); err != nil {
		t.Fatal(err)
	}
	if f.vars[v.ID].Value == nil || *f.vars[v.ID].Value != "https://dev.example" {
		t.Fatal("regular value not on the server")
	}
	if _, ok, _ := st.Secret(ctx, "dev", "BASE_URL"); ok {
		t.Fatal("regular value stored locally")
	}
}

func TestTypeChangesMigrateTheValue(t *testing.T) {
	ctx := context.Background()
	m, st, f, c := setup(t)
	v := mustCreate(t, m, c, "dev", "TOKEN", api.VarRegular)
	if err := m.SetValue(ctx, c, "dev", v.ID, "abc"); err != nil {
		t.Fatal(err)
	}
	before := len(f.bodies)

	// regular -> secret: server drops the value, it is kept locally.
	if err := m.SetType(ctx, c, "dev", v.ID, api.VarSecret); err != nil {
		t.Fatal(err)
	}
	if f.vars[v.ID].Type != api.VarSecret || f.vars[v.ID].Value != nil {
		t.Fatalf("server var = %+v", f.vars[v.ID])
	}
	if got, ok, _ := st.Secret(ctx, "dev", "TOKEN"); !ok || got != "abc" {
		t.Fatalf("local = %q %v", got, ok)
	}
	for _, b := range f.bodies[before:] {
		if strings.Contains(b, "abc") {
			t.Fatalf("making it secret re-sent the value: %q", b)
		}
	}

	// The local value changes while secret; then secret -> regular uploads it.
	if err := m.SetValue(ctx, c, "dev", v.ID, "local-only"); err != nil {
		t.Fatal(err)
	}
	if err := m.SetType(ctx, c, "dev", v.ID, api.VarRegular); err != nil {
		t.Fatal(err)
	}
	if f.vars[v.ID].Type != api.VarRegular || f.vars[v.ID].Value == nil || *f.vars[v.ID].Value != "local-only" {
		t.Fatalf("server var = %+v", f.vars[v.ID])
	}
	if !f.sawAnywhere(`{"type":"regular","value":"local-only"}`) {
		t.Fatalf("upload body: %q", f.bodies)
	}
	if _, ok, _ := st.Secret(ctx, "dev", "TOKEN"); ok {
		t.Fatal("local secret kept after making it regular")
	}

	// Same type: no request.
	n := len(f.bodies)
	if err := m.SetType(ctx, c, "dev", v.ID, api.VarRegular); err != nil || len(f.bodies) != n+1 { // only the GET
		t.Fatalf("no-op type change: err=%v requests=%q", err, f.bodies[n:])
	}
}

func TestSecretToRegularWithoutLocalValueSendsNull(t *testing.T) {
	ctx := context.Background()
	m, _, f, c := setup(t)
	v := mustCreate(t, m, c, "dev", "S", api.VarSecret)
	if err := m.SetType(ctx, c, "dev", v.ID, api.VarRegular); err != nil {
		t.Fatal(err)
	}
	if !f.sawAnywhere(`{"type":"regular","value":null}`) || f.vars[v.ID].Value != nil {
		t.Fatalf("bodies %q", f.bodies)
	}
}

func TestKeyRenameMovesLocalSecret(t *testing.T) {
	ctx := context.Background()
	m, st, _, c := setup(t)
	v := mustCreate(t, m, c, "dev", "OLD", api.VarSecret)
	if err := m.SetValue(ctx, c, "dev", v.ID, "s"); err != nil {
		t.Fatal(err)
	}
	if err := m.SetKey(ctx, c, "dev", v.ID, "NEW"); err != nil {
		t.Fatal(err)
	}
	if _, ok, _ := st.Secret(ctx, "dev", "OLD"); ok {
		t.Fatal("old key still has a value")
	}
	if got, _, _ := st.Secret(ctx, "dev", "NEW"); got != "s" {
		t.Fatalf("new key = %q", got)
	}
}

func TestDeletedVariableRecreatedWithSameKeyKeepsSecret(t *testing.T) {
	ctx := context.Background()
	m, _, _, c := setup(t)
	v := mustCreate(t, m, c, "dev", "TOKEN", api.VarSecret)
	if err := m.SetValue(ctx, c, "dev", v.ID, "keep-me"); err != nil {
		t.Fatal(err)
	}
	if err := m.DeleteVariable(ctx, c, v.ID); err != nil {
		t.Fatal(err)
	}
	mustCreate(t, m, c, "dev", "TOKEN", api.VarSecret)
	vars, err := m.Variables(ctx, c, "dev")
	if err != nil || len(vars) != 1 || vars[0].Value != "keep-me" || !vars[0].HasValue {
		t.Fatalf("vars = %+v, %v", vars, err)
	}
}

func TestActiveEnvironmentAndVarMapOverlay(t *testing.T) {
	ctx := context.Background()
	m, st, f, c := setup(t)
	base := mustCreate(t, m, c, "dev", "BASE_URL", api.VarRegular)
	tok := mustCreate(t, m, c, "dev", "API_TOKEN", api.VarSecret)
	mustCreate(t, m, c, "dev", "UNSET_SECRET", api.VarSecret)
	mustCreate(t, m, c, "dev", "EMPTY", api.VarRegular)
	_ = m.SetValue(ctx, c, "dev", base.ID, "https://dev.example")
	_ = m.SetValue(ctx, c, "dev", tok.ID, "local-token")
	// A stray local row for a key that is not a secret variable is ignored.
	_ = st.PutSecret(ctx, "dev", "BASE_URL", "stale-local")

	// No active environment: empty map.
	vars, ec, err := m.VarMap(ctx, c, "p1")
	if err != nil || len(vars) != 0 || ec.ActiveID != "" || len(ec.Environments) != 2 {
		t.Fatalf("no env: %v %+v %v", vars, ec, err)
	}

	if _, err := m.SetActive(ctx, c, "p1", "dev"); err != nil {
		t.Fatal(err)
	}
	vars, ec, err = m.VarMap(ctx, c, "p1")
	if err != nil {
		t.Fatal(err)
	}
	want := map[string]string{"BASE_URL": "https://dev.example", "API_TOKEN": "local-token", "EMPTY": ""}
	if fmt.Sprint(vars) != fmt.Sprint(want) || ec.ActiveName != "dev" {
		t.Fatalf("map = %v (env %q), want %v", vars, ec.ActiveName, want)
	}

	// Active environment deleted elsewhere: falls back to none, and stays none.
	f.envs["p1"] = remove(f.envs["p1"], "dev")
	if _, ec, _ = m.VarMap(ctx, c, "p1"); ec.ActiveID != "" {
		t.Fatalf("deleted active env still active: %+v", ec)
	}
	if v, ok, _ := st.Setting(ctx, "active_env_p1"); ok {
		t.Fatalf("stale active setting kept: %q", v)
	}
}

func TestDeleteEnvironmentRemovesLocalSecrets(t *testing.T) {
	ctx := context.Background()
	m, st, _, c := setup(t)
	v := mustCreate(t, m, c, "dev", "T", api.VarSecret)
	_ = m.SetValue(ctx, c, "dev", v.ID, "x")
	_ = st.PutSecret(ctx, "prod", "T", "y")
	if _, err := m.SetActive(ctx, c, "p1", "dev"); err != nil {
		t.Fatal(err)
	}
	if err := m.DeleteEnvironment(ctx, c, "p1", "dev"); err != nil {
		t.Fatal(err)
	}
	if left, _ := st.SecretMap(ctx, "dev"); len(left) != 0 {
		t.Fatalf("dev secrets left: %d", len(left))
	}
	if other, _ := st.SecretMap(ctx, "prod"); other["T"] != "y" {
		t.Fatal("other environment's secrets touched")
	}
	if _, ok, _ := st.Setting(ctx, "active_env_p1"); ok {
		t.Fatal("deleted env still active")
	}
}

func TestMove(t *testing.T) {
	ids := []string{"a", "b", "c"}
	tests := []struct {
		id     string
		offset int
		want   string
		ok     bool
	}{
		{"b", -1, "b,a,c", true}, {"b", 1, "a,c,b", true}, {"a", -1, "a,b,c", false},
		{"c", 1, "a,b,c", false}, {"zz", 1, "a,b,c", false},
	}
	for _, tt := range tests {
		got, ok := Move(ids, tt.id, tt.offset)
		if strings.Join(got, ",") != tt.want || ok != tt.ok {
			t.Errorf("Move(%s,%d) = %v %v", tt.id, tt.offset, got, ok)
		}
	}
	if strings.Join(ids, ",") != "a,b,c" {
		t.Error("input mutated")
	}
}
