// Package envs owns environments as the desktop client sees them: the active
// environment per project, and variables whose secret values live only in local
// SQLite.
//
// The security promise: a secret variable's value never reaches the server. Every
// value write re-reads the variable's current type from the server first and
// routes secret values to local storage; the API client additionally refuses to
// send a value together with type "secret".
package envs

import (
	"context"
	"errors"
	"fmt"
	"log/slog"
	"sync"

	"ghostman/internal/api"
)

// Client is the part of *api.APIClient this package needs.
type Client interface {
	ListEnvironments(ctx context.Context, projectID string) ([]api.Environment, error)
	DeleteEnvironment(ctx context.Context, id string) error
	ListVariables(ctx context.Context, envID string) ([]api.Variable, error)
	CreateVariable(ctx context.Context, envID string, in api.NewVariable) (api.Variable, error)
	UpdateVariable(ctx context.Context, id string, patch api.VariablePatch) (api.Variable, error)
	DeleteVariable(ctx context.Context, id string) error
}

// Store is local storage (implemented by *store.Store).
type Store interface {
	Setting(ctx context.Context, key string) (string, bool, error)
	PutSetting(ctx context.Context, key, value string) error
	DeleteSetting(ctx context.Context, key string) error
	SecretMap(ctx context.Context, environmentID string) (map[string]string, error)
	Secret(ctx context.Context, environmentID, key string) (string, bool, error)
	PutSecret(ctx context.Context, environmentID, key, value string) error
	DeleteSecret(ctx context.Context, environmentID, key string) error
	DeleteSecrets(ctx context.Context, environmentID string) error
	RenameSecret(ctx context.Context, environmentID, oldKey, newKey string) error
}

// VariableView is a variable as the manage view shows it. For a secret, Value is
// the local value ("" when HasValue is false: not set on this machine).
type VariableView struct {
	ID        string `json:"id"`
	Key       string `json:"key"`
	Type      string `json:"type"`
	Value     string `json:"value"`
	HasValue  bool   `json:"has_value"`
	SortOrder int32  `json:"sort_order"`
}

// EnvContext is everything the env switcher, highlighting and hover need for a
// project: its environments, the active one, and that one's variables.
type EnvContext struct {
	Environments []api.Environment `json:"environments"`
	ActiveID     string            `json:"active_id"`
	ActiveName   string            `json:"active_name"`
	Variables    []VariableView    `json:"variables"`
	// Keys indexes the variable KEYS of every environment of the project (for
	// {{var}} autocompletion across environments). No values: other environments'
	// values never cross the bridge. Filled by WithKeys (UI calls only).
	Keys []KeyInfo `json:"keys"`
}

// KeyInfo is one variable key and the environments defining it (in environment
// order). Secret is set when it is a secret in any of them.
type KeyInfo struct {
	Key    string   `json:"key"`
	Envs   []string `json:"envs"`    // environment names
	EnvIDs []string `json:"env_ids"` // the same environments' ids
	Secret bool     `json:"secret"`
}

// WithKeys adds the project's key index to ec: the active environment's keys
// from ec.Variables, every other environment's from ListVariables (fetched
// concurrently, values dropped right away). An environment that cannot be listed
// is skipped (logged), so completion degrades instead of failing the context.
func (m *Manager) WithKeys(ctx context.Context, c Client, ec EnvContext) EnvContext {
	perEnv := make([][]KeyInfo, len(ec.Environments))
	var wg sync.WaitGroup
	for i, e := range ec.Environments {
		if e.ID == ec.ActiveID {
			for _, v := range ec.Variables {
				perEnv[i] = append(perEnv[i], KeyInfo{Key: v.Key, Secret: v.Type == api.VarSecret})
			}
			continue
		}
		wg.Add(1)
		go func(i int, id string) {
			defer wg.Done()
			vars, err := c.ListVariables(ctx, id)
			if err != nil {
				slog.Warn("list variable keys", "env", id, "err", err)
				return
			}
			for _, v := range vars {
				perEnv[i] = append(perEnv[i], KeyInfo{Key: v.Key, Secret: v.Type == api.VarSecret})
			}
		}(i, e.ID)
	}
	wg.Wait()
	ec.Keys = MergeKeys(ec.Environments, perEnv)
	return ec
}

// MergeKeys merges per-environment keys (perEnv[i] belongs to envs[i]) into one
// entry per key, in first-seen order; Envs lists each environment once.
func MergeKeys(envs []api.Environment, perEnv [][]KeyInfo) []KeyInfo {
	out := []KeyInfo{}
	index := map[string]int{}
	for i, keys := range perEnv {
		for _, k := range keys {
			j, ok := index[k.Key]
			if !ok {
				j = len(out)
				index[k.Key] = j
				out = append(out, KeyInfo{Key: k.Key, Envs: []string{}, EnvIDs: []string{}})
			}
			if n := len(out[j].EnvIDs); n == 0 || out[j].EnvIDs[n-1] != envs[i].ID {
				out[j].Envs = append(out[j].Envs, envs[i].Name)
				out[j].EnvIDs = append(out[j].EnvIDs, envs[i].ID)
			}
			out[j].Secret = out[j].Secret || k.Secret
		}
	}
	return out
}

// ErrNotFound is returned when a variable id is not in the environment.
var ErrNotFound = &api.APIError{Status: 404, Code: "not_found", Message: "variable not found"}

// Manager implements the operations. It holds no state besides its store.
type Manager struct {
	store Store
}

func New(store Store) *Manager { return &Manager{store: store} }

func activeKey(projectID string) string { return "active_env_" + projectID }

// Context returns the project's environments and the active one with its
// variables. A stored active environment that no longer exists falls back to none.
func (m *Manager) Context(ctx context.Context, c Client, projectID string) (EnvContext, error) {
	envs, err := c.ListEnvironments(ctx, projectID)
	if err != nil {
		return EnvContext{}, err
	}
	out := EnvContext{Environments: envs, Variables: []VariableView{}, Keys: []KeyInfo{}}
	stored, _, err := m.store.Setting(ctx, activeKey(projectID))
	if err != nil {
		slog.Error("load active environment", "err", err)
	}
	for _, e := range envs {
		if e.ID == stored && stored != "" {
			out.ActiveID, out.ActiveName = e.ID, e.Name
		}
	}
	if stored != "" && out.ActiveID == "" {
		m.clearActive(ctx, projectID) // deleted elsewhere: fall back to "No environment"
	}
	if out.ActiveID == "" {
		return out, nil
	}
	out.Variables, err = m.Variables(ctx, c, out.ActiveID)
	return out, err
}

// SetActive selects the project's active environment ("" = none) and returns the
// new context. An id that is not one of the project's environments selects none.
func (m *Manager) SetActive(ctx context.Context, c Client, projectID, envID string) (EnvContext, error) {
	if envID == "" {
		m.clearActive(ctx, projectID)
	} else if err := m.store.PutSetting(ctx, activeKey(projectID), envID); err != nil {
		return EnvContext{}, err
	}
	return m.Context(ctx, c, projectID)
}

func (m *Manager) clearActive(ctx context.Context, projectID string) {
	if err := m.store.DeleteSetting(ctx, activeKey(projectID)); err != nil {
		slog.Error("clear active environment", "err", err)
	}
}

// Variables lists an environment's variables with local secret values filled in.
func (m *Manager) Variables(ctx context.Context, c Client, envID string) ([]VariableView, error) {
	vars, err := c.ListVariables(ctx, envID)
	if err != nil {
		return nil, err
	}
	secrets, err := m.store.SecretMap(ctx, envID)
	if err != nil {
		return nil, fmt.Errorf("load local secrets: %w", err)
	}
	out := make([]VariableView, 0, len(vars))
	for _, v := range vars {
		view := VariableView{ID: v.ID, Key: v.Key, Type: v.Type, SortOrder: v.SortOrder}
		if v.Type == api.VarSecret {
			view.Value, view.HasValue = secrets[v.Key]
		} else if v.Value != nil {
			view.Value, view.HasValue = *v.Value, true
		}
		out = append(out, view)
	}
	return out, nil
}

// VarMap builds the resolution map for the project's active environment: regular
// values from the server, overlaid with local secret values. Secrets without a
// local value are left out, so their tokens stay unresolved. No active
// environment gives an empty map (everything literal).
func (m *Manager) VarMap(ctx context.Context, c Client, projectID string) (map[string]string, EnvContext, error) {
	ec, err := m.Context(ctx, c, projectID)
	if err != nil {
		return nil, EnvContext{}, err
	}
	return BuildMap(ec.Variables), ec, nil
}

// BuildMap turns variable views into the map the resolver uses.
func BuildMap(vars []VariableView) map[string]string {
	out := make(map[string]string, len(vars))
	for _, v := range vars {
		switch {
		case v.Type == api.VarSecret && !v.HasValue:
			// not set on this machine: unresolved
		default:
			out[v.Key] = v.Value // regular (a null value counts as defined and empty) or local secret
		}
	}
	return out
}

func (m *Manager) find(ctx context.Context, c Client, envID, varID string) (api.Variable, error) {
	vars, err := c.ListVariables(ctx, envID)
	if err != nil {
		return api.Variable{}, err
	}
	for _, v := range vars {
		if v.ID == varID {
			return v, nil
		}
	}
	return api.Variable{}, ErrNotFound
}

// CreateVariable adds a variable (no value yet).
func (m *Manager) CreateVariable(ctx context.Context, c Client, envID, key, typ string) (api.Variable, error) {
	return c.CreateVariable(ctx, envID, api.NewVariable{Key: key, Type: typ})
}

// SetValue sets a variable's value: on the server for a regular variable, in local
// storage only for a secret ("" removes the local value: not set on this machine).
// The type is re-read from the server first, so a stale UI can never upload a secret.
func (m *Manager) SetValue(ctx context.Context, c Client, envID, varID, value string) error {
	v, err := m.find(ctx, c, envID, varID)
	if err != nil {
		return err
	}
	if v.Type == api.VarSecret {
		if value == "" {
			return m.store.DeleteSecret(ctx, envID, v.Key)
		}
		return m.store.PutSecret(ctx, envID, v.Key, value)
	}
	_, err = c.UpdateVariable(ctx, varID, api.VariablePatch{SetValue: true, Value: &value})
	return err
}

// SetKey renames a variable; a secret's local value moves to the new key.
func (m *Manager) SetKey(ctx context.Context, c Client, envID, varID, key string) error {
	v, err := m.find(ctx, c, envID, varID)
	if err != nil {
		return err
	}
	updated, err := c.UpdateVariable(ctx, varID, api.VariablePatch{Key: &key})
	if err != nil {
		return err
	}
	if v.Type == api.VarSecret && updated.Key != v.Key {
		return m.store.RenameSecret(ctx, envID, v.Key, updated.Key)
	}
	return nil
}

// SetType switches a variable between regular and secret, keeping its value:
//   - regular → secret: the server drops the value; it is kept in local storage.
//   - secret → regular: the local value is uploaded as the server value (the UI
//     confirms this with the user first), then removed locally.
func (m *Manager) SetType(ctx context.Context, c Client, envID, varID, typ string) error {
	if typ != api.VarRegular && typ != api.VarSecret {
		return &api.APIError{Status: 400, Code: "bad_request", Message: `type must be "regular" or "secret"`}
	}
	v, err := m.find(ctx, c, envID, varID)
	if err != nil || v.Type == typ {
		return err
	}
	if typ == api.VarSecret {
		if _, err := c.UpdateVariable(ctx, varID, api.VariablePatch{Type: &typ}); err != nil {
			return err
		}
		if v.Value != nil && *v.Value != "" {
			return m.store.PutSecret(ctx, envID, v.Key, *v.Value)
		}
		return nil
	}

	local, ok, err := m.store.Secret(ctx, envID, v.Key)
	if err != nil {
		return err
	}
	patch := api.VariablePatch{Type: &typ, SetValue: true}
	if ok {
		patch.Value = &local
	}
	if _, err := c.UpdateVariable(ctx, varID, patch); err != nil {
		return err
	}
	return m.store.DeleteSecret(ctx, envID, v.Key)
}

// DeleteVariable deletes a variable on the server. A secret's local value is kept
// on purpose: re-creating a variable with the same key gets it back.
func (m *Manager) DeleteVariable(ctx context.Context, c Client, varID string) error {
	return c.DeleteVariable(ctx, varID)
}

// DeleteEnvironment deletes an environment and every local secret value stored for it.
func (m *Manager) DeleteEnvironment(ctx context.Context, c Client, projectID, envID string) error {
	if err := c.DeleteEnvironment(ctx, envID); err != nil {
		var apiErr *api.APIError
		if !errors.As(err, &apiErr) || apiErr.Status != 404 {
			return err
		}
	}
	if stored, _, _ := m.store.Setting(ctx, activeKey(projectID)); stored == envID {
		m.clearActive(ctx, projectID)
	}
	return m.store.DeleteSecrets(ctx, envID)
}

// Move returns ids with id moved one place up (-1) or down (+1), and whether
// anything changed (false at the edges or for an unknown id). Reorder endpoints
// want the full list, so callers read it fresh and send the result.
func Move(ids []string, id string, offset int) ([]string, bool) {
	from := -1
	for i, x := range ids {
		if x == id {
			from = i
		}
	}
	to := from + offset
	if from < 0 || to < 0 || to >= len(ids) || offset == 0 {
		return ids, false
	}
	out := append([]string{}, ids...)
	out[from], out[to] = out[to], out[from]
	return out, true
}
