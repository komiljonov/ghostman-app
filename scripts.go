package main

import (
	"context"
	"fmt"
	"slices"
	"strings"

	"ghostman/internal/api"
	"ghostman/internal/engine"
	"ghostman/internal/scripting"
)

// Pre-request / post-response scripts around a send (rules: internal/scripting).
// The send path (editor.go) gathers the scripts, runs them in order and applies
// their environment writes here — every write goes through internal/envs, so a
// script's gm.environment.set of a SECRET variable lands in local storage only.

// ScriptFolder is one ancestor folder's scripts. The UI sends the request's folder
// chain OUTERMOST first (the same tree walk as settings resolution).
type ScriptFolder struct {
	Name       string `json:"name"`
	PreScript  string `json:"pre_script"`
	PostScript string `json:"post_script"`
}

// gatherScripts lists a send's scripts in run order: folder pre-scripts (outer
// first), the request's pre-script; folder post-scripts (outer first), the
// request's post-script. Empty ones are left out (they would be skipped anyway).
func gatherScripts(folders []ScriptFolder, draft api.RequestDraft, requestName string) (pre, post []scripting.Script) {
	reqOwner := "this request"
	if n := strings.TrimSpace(requestName); n != "" {
		reqOwner = fmt.Sprintf("request '%s'", n)
	}
	add := func(list []scripting.Script, owner, phase, src string) []scripting.Script {
		if strings.TrimSpace(src) == "" {
			return list
		}
		return append(list, scripting.Script{Owner: owner, Phase: phase, Source: src})
	}
	for _, f := range folders {
		pre = add(pre, fmt.Sprintf("folder '%s'", f.Name), scripting.Pre, f.PreScript)
	}
	pre = add(pre, reqOwner, scripting.Pre, draft.PreScript)
	for _, f := range folders {
		post = add(post, fmt.Sprintf("folder '%s'", f.Name), scripting.Post, f.PostScript)
	}
	post = add(post, reqOwner, scripting.Post, draft.PostScript)
	return pre, post
}

// cloneSpec deep-copies a spec, so a pre-script's mutations never reach the
// template (the stored request and history's template copy).
func cloneSpec(s engine.RequestSpec) engine.RequestSpec {
	s.Headers = slices.Clone(s.Headers)
	s.QueryParams = slices.Clone(s.QueryParams)
	s.Body.Fields = slices.Clone(s.Body.Fields)
	s.Body.Parts = slices.Clone(s.Body.Parts)
	if s.Auth != nil {
		a := *s.Auth
		s.Auth = &a
	}
	return s
}

// flushEnv applies a script's queued environment writes to the active
// environment, in order: an existing variable gets its value (internal/envs
// routes a secret to this machine); a new key becomes a regular variable; unset
// clears the value. It returns the secret values written (masked in the timing
// URLs), and the first error.
func (a *App) flushEnv(ctx context.Context, c *api.APIClient, envID string, state *scripting.EnvState) ([]string, error) {
	pending := state.Pending
	state.Pending = nil
	if len(pending) == 0 || envID == "" {
		return nil, nil
	}
	vars, err := c.ListVariables(ctx, envID)
	if err != nil {
		return nil, fmt.Errorf("could not read the environment's variables: %w", err)
	}
	find := func(key string) *api.Variable {
		for i := range vars {
			if vars[i].Key == key {
				return &vars[i]
			}
		}
		return nil
	}
	var secrets []string
	for _, w := range pending {
		v := find(w.Key)
		switch {
		case w.Unset:
			if v == nil {
				continue
			}
			if err := a.envs.SetValue(ctx, c, envID, v.ID, ""); err != nil {
				return secrets, fmt.Errorf("could not clear '%s': %w", w.Key, err)
			}
		case v != nil:
			if err := a.envs.SetValue(ctx, c, envID, v.ID, w.Value); err != nil {
				return secrets, fmt.Errorf("could not save '%s': %w", w.Key, err)
			}
			if v.Type == api.VarSecret && w.Value != "" {
				secrets = append(secrets, w.Value)
			}
		default:
			created, err := a.envs.CreateVariable(ctx, c, envID, w.Key, api.VarRegular)
			if err != nil {
				return secrets, fmt.Errorf("could not create '%s': %w", w.Key, err)
			}
			if err := a.envs.SetValue(ctx, c, envID, created.ID, w.Value); err != nil {
				return secrets, fmt.Errorf("could not save '%s': %w", w.Key, err)
			}
			vars = append(vars, created)
		}
	}
	return secrets, nil
}

// scriptResponse is what post-scripts see: the engine's retained body (the
// full Go-side copy when there is one).
func scriptResponse(r *engine.Response) *scripting.Response {
	body := r.Full
	if body == nil {
		body = []byte(r.Body)
	}
	return &scripting.Response{Status: r.Status, DurationMs: r.DurationMs, Headers: r.Headers, Body: body}
}

// currentClient is the session's server client (nil when logged out).
func (a *App) currentClient() *api.APIClient {
	a.clientMu.Lock()
	defer a.clientMu.Unlock()
	return a.client
}

// GetScriptAPIDocs is the gm API reference for the script editors' help popover
// (the one source: scripting.APIDocs).
func (a *App) GetScriptAPIDocs() []scripting.Doc {
	return scripting.APIDocs
}
