package envs

import (
	"context"
	"strings"

	"ghostman/internal/api"
)

// MissingKeys returns the used keys an environment does not define, in the
// order given. A secret counts as present (its key exists; the value is local).
// Presence compares case-insensitively, like the server's unique keys: "Token"
// and "token" cannot both exist, so offering one next to the other would only
// fail. Keys starting with "$" are generated variables, never missing.
func MissingKeys(used []string, have []api.Variable) []string {
	present := map[string]bool{}
	for _, v := range have {
		present[strings.ToLower(v.Key)] = true
	}
	out := []string{}
	seen := map[string]bool{}
	for _, k := range used {
		l := strings.ToLower(k)
		if strings.TrimSpace(k) == "" || strings.HasPrefix(k, "$") || present[l] || seen[l] {
			continue
		}
		seen[l] = true
		out = append(out, k)
	}
	return out
}

// CreateEmpty creates a regular variable with the value "" (the "Add missing
// variables" path: the user fills values in afterwards). Through the normal
// create + value writes, so the "$" rule and the secret routing apply.
func (m *Manager) CreateEmpty(ctx context.Context, c Client, envID, key string) (api.Variable, error) {
	v, err := m.CreateVariable(ctx, c, envID, key, api.VarRegular)
	if err != nil {
		return v, err
	}
	return v, m.SetValue(ctx, c, envID, v.ID, "")
}
