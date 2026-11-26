package main

import (
	"context"
	"strings"

	"ghostman/internal/api"
	"ghostman/internal/envs"
	"ghostman/internal/session"
)

// "Add missing variables" (environment tab header): the {{keys}} the project
// uses (server: GET /projects/{id}/variable-keys) that this environment does
// not define (envs.MissingKeys), then the chosen ones created as regular
// variables with "" through the normal paths. A general drift fixer, not tied
// to imports.

type MissingVariablesResult struct {
	Data  []string         `json:"data"`
	Error *session.Problem `json:"error,omitempty"`
}

// MissingVariables lists the keys the project uses that the environment lacks.
func (a *App) MissingVariables(projectID, envID string) MissingVariablesResult {
	v, p := call(a, func(ctx context.Context, c *api.APIClient) ([]string, error) {
		used, err := c.ListVariableKeys(ctx, projectID)
		if err != nil {
			return nil, err
		}
		have, err := c.ListVariables(ctx, envID)
		if err != nil {
			return nil, err
		}
		return envs.MissingKeys(used, have), nil
	})
	if v == nil {
		v = []string{}
	}
	return MissingVariablesResult{Data: v, Error: p}
}

// MissingFailure is one key that could not be created, with the reason.
type MissingFailure struct {
	Key     string `json:"key"`
	Message string `json:"message"`
}

// CreatedMissing is what CreateMissingVariables did.
type CreatedMissing struct {
	Created []string         `json:"created"`
	Failed  []MissingFailure `json:"failed"`
}

type CreateMissingResult struct {
	Data  *CreatedMissing  `json:"data"`
	Error *session.Problem `json:"error,omitempty"`
}

// CreateMissingVariables creates each key as a regular variable with value "",
// in order. One failure does not stop the rest; each is reported by key.
func (a *App) CreateMissingVariables(envID string, keys []string) CreateMissingResult {
	v, p := call(a, func(ctx context.Context, c *api.APIClient) (CreatedMissing, error) {
		out := CreatedMissing{Created: []string{}, Failed: []MissingFailure{}}
		for _, k := range keys {
			k = strings.TrimSpace(k)
			if k == "" {
				continue
			}
			if _, err := a.envs.CreateEmpty(ctx, c, envID, k); err != nil {
				if api.IsUnauthorized(err) {
					return out, err // the session is gone: stop, the UI drops to login
				}
				out.Failed = append(out.Failed, MissingFailure{Key: k, Message: session.ProblemFrom(err).Message})
				continue
			}
			out.Created = append(out.Created, k)
		}
		return out, nil
	})
	return CreateMissingResult{Data: ptr(v, p), Error: p}
}
