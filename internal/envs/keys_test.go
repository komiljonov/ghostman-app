package envs

import (
	"context"
	"encoding/json"
	"strings"
	"testing"

	"ghostman/internal/api"
)

func TestWithKeysIndexesEveryEnvironmentWithoutValues(t *testing.T) {
	ctx := context.Background()
	m, _, _, c := setup(t)
	base := mustCreate(t, m, c, "dev", "BASE_URL", api.VarRegular)
	tok := mustCreate(t, m, c, "dev", "API_TOKEN", api.VarSecret)
	pbase := mustCreate(t, m, c, "prod", "BASE_URL", api.VarRegular)
	ponly := mustCreate(t, m, c, "prod", "PROD_ONLY", api.VarRegular)
	_ = m.SetValue(ctx, c, "dev", base.ID, "https://dev.example")
	_ = m.SetValue(ctx, c, "dev", tok.ID, "local-token")
	_ = m.SetValue(ctx, c, "prod", pbase.ID, "https://prod.example")
	_ = m.SetValue(ctx, c, "prod", ponly.ID, "prod-only-value")

	check := func(ec EnvContext) {
		t.Helper()
		got := map[string]string{}
		for _, k := range ec.Keys {
			got[k.Key] = strings.Join(k.Envs, ",")
			if k.Key == "API_TOKEN" && !k.Secret {
				t.Error("API_TOKEN must be marked secret")
			}
		}
		want := map[string]string{"BASE_URL": "dev,prod", "API_TOKEN": "dev", "PROD_ONLY": "prod"}
		if len(got) != len(want) {
			t.Fatalf("keys = %v", got)
		}
		for k, v := range want {
			if got[k] != v {
				t.Errorf("%s in %q, want %q", k, got[k], v)
			}
		}
		raw, _ := json.Marshal(ec.Keys)
		for _, v := range []string{"prod.example", "prod-only-value", "local-token", "dev.example"} {
			if strings.Contains(string(raw), v) {
				t.Errorf("key index carries a value %q: %s", v, raw)
			}
		}
	}

	// No active environment: every env's keys are still indexed.
	ec, err := m.Context(ctx, c, "p1")
	if err != nil {
		t.Fatal(err)
	}
	check(m.WithKeys(ctx, c, ec))

	ec, err = m.SetActive(ctx, c, "p1", "dev")
	if err != nil {
		t.Fatal(err)
	}
	ec = m.WithKeys(ctx, c, ec)
	check(ec)
	// Only the ACTIVE env's values are in the context (previews).
	raw, _ := json.Marshal(ec)
	if strings.Contains(string(raw), "prod-only-value") || strings.Contains(string(raw), "prod.example") {
		t.Errorf("another environment's values reached the context: %s", raw)
	}
	// Plain Context (used by sends) does not pay for the index.
	if plain, _ := m.Context(ctx, c, "p1"); len(plain.Keys) != 0 {
		t.Errorf("Context must not index keys: %+v", plain.Keys)
	}
}

func TestMergeKeysDedupesInEnvOrder(t *testing.T) {
	envs := []api.Environment{{ID: "a", Name: "dev"}, {ID: "b", Name: "prod"}}
	got := MergeKeys(envs, [][]KeyInfo{
		{{Key: "X"}, {Key: "X"}, {Key: "S", Secret: false}},
		{{Key: "S", Secret: true}, {Key: "X"}},
	})
	raw, _ := json.Marshal(got)
	if string(raw) != `[{"key":"X","envs":["dev","prod"],"env_ids":["a","b"],"secret":false},{"key":"S","envs":["dev","prod"],"env_ids":["a","b"],"secret":true}]` {
		t.Fatalf("%s", raw)
	}
	if out := MergeKeys(nil, nil); out == nil || len(out) != 0 {
		t.Fatal("empty must be [] not nil")
	}
}
