package main

import (
	"context"
	"strings"

	"ghostman/internal/api"
	"ghostman/internal/envs"
	"ghostman/internal/session"
)

// Bound environment methods: thin {data, error} wrappers over internal/envs (which
// keeps secret values local) and the API client.

type EnvContextResult struct {
	Data  *envs.EnvContext `json:"data"`
	Error *session.Problem `json:"error,omitempty"`
}

type EnvironmentResult struct {
	Data  *api.EnvironmentDetail `json:"data"`
	Error *session.Problem       `json:"error,omitempty"`
}

type VariableViewListResult struct {
	Data  []envs.VariableView `json:"data"`
	Error *session.Problem    `json:"error,omitempty"`
}

type VariableResult struct {
	Data  *api.Variable    `json:"data"`
	Error *session.Problem `json:"error,omitempty"`
}

// GetEnvContext returns a project's environments, the active one and its variables
// (secret values from this machine). A deleted active environment falls back to none.
func (a *App) GetEnvContext(projectID string) EnvContextResult {
	v, p := call(a, func(ctx context.Context, c *api.APIClient) (envs.EnvContext, error) {
		ec, err := a.envs.Context(ctx, c, projectID)
		if err != nil {
			return ec, err
		}
		return a.envs.WithKeys(ctx, c, ec), nil // the UI's context also indexes every env's keys
	})
	return EnvContextResult{Data: ptr(v, p), Error: p}
}

// SetActiveEnvironment selects the project's environment ("" = No environment).
func (a *App) SetActiveEnvironment(projectID, envID string) EnvContextResult {
	v, p := call(a, func(ctx context.Context, c *api.APIClient) (envs.EnvContext, error) {
		ec, err := a.envs.SetActive(ctx, c, projectID, envID)
		if err != nil {
			return ec, err
		}
		return a.envs.WithKeys(ctx, c, ec), nil
	})
	return EnvContextResult{Data: ptr(v, p), Error: p}
}

// CreateEnvironment creates an environment.
func (a *App) CreateEnvironment(projectID, name string) EnvironmentResult {
	v, p := call(a, func(ctx context.Context, c *api.APIClient) (api.EnvironmentDetail, error) {
		return c.CreateEnvironment(ctx, projectID, strings.TrimSpace(name))
	})
	return EnvironmentResult{Data: ptr(v, p), Error: p}
}

// RenameEnvironment renames an environment.
func (a *App) RenameEnvironment(envID, name string) EnvironmentResult {
	v, p := call(a, func(ctx context.Context, c *api.APIClient) (api.EnvironmentDetail, error) {
		return c.RenameEnvironment(ctx, envID, strings.TrimSpace(name))
	})
	return EnvironmentResult{Data: ptr(v, p), Error: p}
}

// DeleteEnvironment deletes an environment and this machine's secret values for it.
func (a *App) DeleteEnvironment(projectID, envID string) EmptyResult {
	return callEmpty(a, func(ctx context.Context, c *api.APIClient) error {
		return a.envs.DeleteEnvironment(ctx, c, projectID, envID)
	})
}

// ReorderEnvironments sets the project's environment order (the env list's drag and
// drop; the server wants every environment id, in the new order).
func (a *App) ReorderEnvironments(projectID string, ids []string) EmptyResult {
	return callEmpty(a, func(ctx context.Context, c *api.APIClient) error {
		return c.ReorderEnvironments(ctx, projectID, ids)
	})
}

// ListVariables returns an environment's variables for the manage view.
func (a *App) ListVariables(envID string) VariableViewListResult {
	v, p := call(a, func(ctx context.Context, c *api.APIClient) ([]envs.VariableView, error) {
		return a.envs.Variables(ctx, c, envID)
	})
	return VariableViewListResult{Data: v, Error: p}
}

// CreateVariable adds a variable (regular or secret) without a value.
func (a *App) CreateVariable(envID, key, typ string) VariableResult {
	v, p := call(a, func(ctx context.Context, c *api.APIClient) (api.Variable, error) {
		return a.envs.CreateVariable(ctx, c, envID, strings.TrimSpace(key), typ)
	})
	return VariableResult{Data: ptr(v, p), Error: p}
}

// CreateVariableWithValue is the variables table's append row, committed as a whole:
// create the variable, then set the typed value through envs (a secret's value stays
// on this machine). A failed value write keeps the created variable and reports the
// problem with it (Data and Error both set); "" sets nothing.
func (a *App) CreateVariableWithValue(envID, key, typ, value string) VariableResult {
	res := a.CreateVariable(envID, key, typ)
	if res.Error != nil || res.Data == nil || value == "" {
		return res
	}
	if r := a.SetVariableValue(envID, res.Data.ID, value); r.Error != nil {
		res.Error = r.Error
	}
	return res
}

// SetVariableValue sets a value: on the server for regular variables, only on this
// machine for secrets.
func (a *App) SetVariableValue(envID, varID, value string) EmptyResult {
	return callEmpty(a, func(ctx context.Context, c *api.APIClient) error {
		return a.envs.SetValue(ctx, c, envID, varID, value)
	})
}

// SetVariableKey renames a variable (a secret's local value follows the key).
func (a *App) SetVariableKey(envID, varID, key string) EmptyResult {
	return callEmpty(a, func(ctx context.Context, c *api.APIClient) error {
		return a.envs.SetKey(ctx, c, envID, varID, strings.TrimSpace(key))
	})
}

// SetVariableType switches regular/secret, migrating the value (secret -> regular
// uploads the local value; the UI confirms that first).
func (a *App) SetVariableType(envID, varID, typ string) EmptyResult {
	return callEmpty(a, func(ctx context.Context, c *api.APIClient) error {
		return a.envs.SetType(ctx, c, envID, varID, typ)
	})
}

// DeleteVariable deletes a variable (a secret's local value is kept for its key).
func (a *App) DeleteVariable(varID string) EmptyResult {
	return callEmpty(a, func(ctx context.Context, c *api.APIClient) error {
		return a.envs.DeleteVariable(ctx, c, varID)
	})
}

// ReorderVariables sets an environment's variable order (the variables table's drag
// and drop; every variable id, in the new order).
func (a *App) ReorderVariables(envID string, ids []string) EmptyResult {
	return callEmpty(a, func(ctx context.Context, c *api.APIClient) error {
		return c.ReorderVariables(ctx, envID, ids)
	})
}

// Local secret storage, exposed directly (no server involved).

// GetSecretValues returns this machine's secret values for an environment, by key.
func (a *App) GetSecretValues(envID string) map[string]string {
	if a.store == nil {
		return map[string]string{}
	}
	m, err := a.store.SecretMap(a.ctx, envID)
	if err != nil {
		return map[string]string{}
	}
	return m
}

// GetSecretValue returns one local secret value ("" when not set).
func (a *App) GetSecretValue(envID, key string) string {
	if a.store == nil {
		return ""
	}
	v, _, _ := a.store.Secret(a.ctx, envID, key)
	return v
}

// SetSecretValue stores a secret value on this machine only.
func (a *App) SetSecretValue(envID, key, value string) EmptyResult {
	if a.store == nil {
		return EmptyResult{Error: problemNotLoggedIn}
	}
	if err := a.store.PutSecret(a.ctx, envID, key, value); err != nil {
		return EmptyResult{Error: session.ProblemFrom(err)}
	}
	return EmptyResult{}
}

// DeleteSecretValue removes a secret value from this machine.
func (a *App) DeleteSecretValue(envID, key string) EmptyResult {
	if a.store == nil {
		return EmptyResult{Error: problemNotLoggedIn}
	}
	if err := a.store.DeleteSecret(a.ctx, envID, key); err != nil {
		return EmptyResult{Error: session.ProblemFrom(err)}
	}
	return EmptyResult{}
}
