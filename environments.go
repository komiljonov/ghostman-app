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
		return a.envs.Context(ctx, c, projectID)
	})
	return EnvContextResult{Data: ptr(v, p), Error: p}
}

// SetActiveEnvironment selects the project's environment ("" = No environment).
func (a *App) SetActiveEnvironment(projectID, envID string) EnvContextResult {
	v, p := call(a, func(ctx context.Context, c *api.APIClient) (envs.EnvContext, error) {
		return a.envs.SetActive(ctx, c, projectID, envID)
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

// MoveEnvironment moves an environment one place up (-1) or down (+1).
func (a *App) MoveEnvironment(projectID, envID string, offset int) EmptyResult {
	return callEmpty(a, func(ctx context.Context, c *api.APIClient) error {
		list, err := c.ListEnvironments(ctx, projectID)
		if err != nil {
			return err
		}
		ids := make([]string, len(list))
		for i, e := range list {
			ids[i] = e.ID
		}
		if moved, ok := envs.Move(ids, envID, offset); ok {
			return c.ReorderEnvironments(ctx, projectID, moved)
		}
		return nil
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

// MoveVariable moves a variable one place up (-1) or down (+1).
func (a *App) MoveVariable(envID, varID string, offset int) EmptyResult {
	return callEmpty(a, func(ctx context.Context, c *api.APIClient) error {
		list, err := c.ListVariables(ctx, envID)
		if err != nil {
			return err
		}
		ids := make([]string, len(list))
		for i, v := range list {
			ids[i] = v.ID
		}
		if moved, ok := envs.Move(ids, varID, offset); ok {
			return c.ReorderVariables(ctx, envID, moved)
		}
		return nil
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
