package api

import (
	"context"
	"encoding/json"
	"errors"
	"net/http"
	"net/url"
)

// Variable types.
const (
	VarRegular = "regular"
	VarSecret  = "secret"
)

// ErrSecretValue guards the product's security promise at the lowest level: a
// request body that would carry a value for a secret variable is never sent.
var ErrSecretValue = errors.New("refusing to send a secret value to the server")

// Environment is one entry of a project's environment list.
type Environment struct {
	ID        string `json:"id"`
	Name      string `json:"name"`
	SortOrder int32  `json:"sort_order"`
	CreatedAt string `json:"created_at"`
}

// EnvironmentDetail is a single environment as returned by create/rename.
type EnvironmentDetail struct {
	ID        string `json:"id"`
	ProjectID string `json:"project_id"`
	Name      string `json:"name"`
	SortOrder int32  `json:"sort_order"`
	CreatedAt string `json:"created_at"`
}

// Variable is a server-side variable. Value is always nil for secrets: their
// values exist only on this machine.
type Variable struct {
	ID        string  `json:"id"`
	Key       string  `json:"key"`
	Type      string  `json:"type"`
	Value     *string `json:"value"`
	SortOrder int32   `json:"sort_order"`
}

// NewVariable is the input of CreateVariable. It deliberately has no value: a
// regular variable's value is set afterwards with UpdateVariable, and a secret's
// value is stored locally only.
type NewVariable struct {
	Key  string `json:"key"`
	Type string `json:"type"`
}

// VariablePatch is a partial update. Value is three-state: SetValue false leaves
// it alone; SetValue true sends Value (nil = JSON null).
type VariablePatch struct {
	Key      *string
	Type     *string
	SetValue bool
	Value    *string
}

// MarshalJSON emits only the fields being changed.
func (p VariablePatch) MarshalJSON() ([]byte, error) {
	body := map[string]any{}
	if p.Key != nil {
		body["key"] = *p.Key
	}
	if p.Type != nil {
		body["type"] = *p.Type
	}
	if p.SetValue {
		body["value"] = p.Value
	}
	return json.Marshal(body)
}

func environmentPath(id string) string { return "/api/v1/environments/" + url.PathEscape(id) }
func variablePath(id string) string    { return "/api/v1/variables/" + url.PathEscape(id) }

// CreateEnvironment creates an environment in a project.
func (c *APIClient) CreateEnvironment(ctx context.Context, projectID, name string) (EnvironmentDetail, error) {
	var out EnvironmentDetail
	err := c.do(ctx, http.MethodPost, projectPath(projectID)+"/environments", map[string]string{"name": name}, &out)
	return out, err
}

// ListEnvironments returns a project's environments in order.
func (c *APIClient) ListEnvironments(ctx context.Context, projectID string) ([]Environment, error) {
	out := []Environment{}
	err := c.do(ctx, http.MethodGet, projectPath(projectID)+"/environments", nil, &out)
	return out, err
}

// RenameEnvironment renames an environment.
func (c *APIClient) RenameEnvironment(ctx context.Context, id, name string) (EnvironmentDetail, error) {
	var out EnvironmentDetail
	err := c.do(ctx, http.MethodPatch, environmentPath(id), map[string]string{"name": name}, &out)
	return out, err
}

// DeleteEnvironment deletes an environment and its variables.
func (c *APIClient) DeleteEnvironment(ctx context.Context, id string) error {
	return c.do(ctx, http.MethodDelete, environmentPath(id), nil, nil)
}

// ReorderEnvironments sets a project's environment order (every environment, once).
func (c *APIClient) ReorderEnvironments(ctx context.Context, projectID string, ids []string) error {
	body := map[string]any{"project_id": projectID, "environment_ids": nonNil(ids)}
	return c.do(ctx, http.MethodPut, "/api/v1/environments/order", body, nil)
}

// CreateVariable creates a variable without a value.
func (c *APIClient) CreateVariable(ctx context.Context, envID string, in NewVariable) (Variable, error) {
	var out Variable
	err := c.do(ctx, http.MethodPost, environmentPath(envID)+"/variables", in, &out)
	return out, err
}

// ListVariables returns an environment's variables in order (secrets with value nil).
func (c *APIClient) ListVariables(ctx context.Context, envID string) ([]Variable, error) {
	out := []Variable{}
	err := c.do(ctx, http.MethodGet, environmentPath(envID)+"/variables", nil, &out)
	return out, err
}

// UpdateVariable applies a partial update. It refuses to send a non-empty value
// together with type "secret". (Callers that only change a value must know the
// variable is regular — internal/envs re-reads the type before every value write.)
func (c *APIClient) UpdateVariable(ctx context.Context, id string, patch VariablePatch) (Variable, error) {
	if patch.SetValue && patch.Value != nil && *patch.Value != "" && patch.Type != nil && *patch.Type == VarSecret {
		return Variable{}, ErrSecretValue
	}
	var out Variable
	err := c.do(ctx, http.MethodPatch, variablePath(id), patch, &out)
	return out, err
}

// DeleteVariable deletes a variable.
func (c *APIClient) DeleteVariable(ctx context.Context, id string) error {
	return c.do(ctx, http.MethodDelete, variablePath(id), nil, nil)
}

// ReorderVariables sets an environment's variable order (every variable, once).
func (c *APIClient) ReorderVariables(ctx context.Context, envID string, ids []string) error {
	body := map[string]any{"environment_id": envID, "variable_ids": nonNil(ids)}
	return c.do(ctx, http.MethodPut, "/api/v1/variables/order", body, nil)
}
