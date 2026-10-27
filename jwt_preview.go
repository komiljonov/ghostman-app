package main

import (
	"context"
	"errors"
	"time"

	"ghostman/internal/api"
	"ghostman/internal/engine"
	"ghostman/internal/session"
)

// JWTPreview is the Auth tab's "Preview token": the token's decoded header and
// claims as they would be signed now ({{vars}} and {{$now…}} resolved) and its
// first / last 8 characters. NEVER the secret, resolved or not.
type JWTPreview struct {
	Header      string   `json:"header"`  // pretty JSON
	Payload     string   `json:"payload"` // pretty JSON, resolved, time claims applied
	TokenHead   string   `json:"token_head"`
	TokenTail   string   `json:"token_tail"`
	Unresolved  []string `json:"unresolved"`  // payload {{vars}} with no value (kept literal)
	Environment string   `json:"environment"` // the active environment's name ("" = none)
}

type JWTPreviewResult struct {
	Data  *JWTPreview      `json:"data,omitempty"`
	Error *session.Problem `json:"error,omitempty"`
}

// PreviewJWT signs a JWT auth config (template form, as the cascade resolved it)
// exactly like a send would — same variable map, same order — without sending
// anything. Pre-request scripts do not run for a preview. A config that cannot
// be signed comes back as the send's own abort message.
func (a *App) PreviewJWT(projectID string, auth api.Auth) JWTPreviewResult {
	if !api.ValidAuth(auth) {
		return JWTPreviewResult{Error: invalidAuth()}
	}
	if api.NormalizeAuth(auth).Type != api.AuthJWT {
		return JWTPreviewResult{Error: &session.Problem{Kind: session.KindInvalid, Message: "not a JWT auth config"}}
	}
	type loaded struct {
		vars map[string]string
		env  string
	}
	l, p := call(a, func(ctx context.Context, c *api.APIClient) (loaded, error) {
		m, ec, err := a.envs.VarMap(ctx, c, projectID)
		return loaded{m, ec.ActiveName}, err
	})
	if p != nil {
		p.Message = "could not load environment variables: " + p.Message
		return JWTPreviewResult{Error: p}
	}
	spec, unresolved := engine.ResolveSpec(engine.RequestSpec{Auth: engineAuth(&auth)}, l.vars)
	pv, err := engine.PreviewJWT(spec, time.Now())
	if err != nil {
		var je *engine.JWTError
		if errors.As(err, &je) {
			return JWTPreviewResult{Error: &session.Problem{Kind: session.KindInvalid, Message: je.Msg}}
		}
		return JWTPreviewResult{Error: &session.Problem{Kind: session.KindInvalid, Message: err.Error()}}
	}
	if unresolved == nil {
		unresolved = []string{}
	}
	return JWTPreviewResult{Data: &JWTPreview{Header: pv.Header, Payload: pv.Payload, TokenHead: pv.TokenHead, TokenTail: pv.TokenTail, Unresolved: unresolved, Environment: l.env}}
}
