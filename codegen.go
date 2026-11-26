package main

import (
	"context"
	"encoding/json"
	"fmt"
	"strconv"
	"strings"
	"time"

	"ghostman/internal/api"
	"ghostman/internal/codegen"
	"ghostman/internal/engine"
	"ghostman/internal/session"
)

// Code generation: a request as a ready-to-paste snippet (internal/codegen). The
// snippet is built from the SEND pipeline up to, not including, execution: the
// same template (sendTemplate: effective auth, local file paths), the same
// variable map (sendVars: active env + local secrets), ResolveSpec, SignJWT and
// the engine's wire rules (engine.Prepare) — so it represents what Send would do.
// Scripts never run here (no side effects); a request with scripts gets a note.

// CodegenOptions are the panel's choices (persisted: GetCodegenPrefs).
type CodegenOptions struct {
	Target   string `json:"target"`   // codegen target id (curl | fetch | python | go)
	Resolved bool   `json:"resolved"` // real values (secrets, a signed JWT) vs {{variables}}
	OneLine  bool   `json:"one_line"` // curl: the whole command on one line
	Proxy    bool   `json:"proxy"`    // curl: include -x for the resolved proxy
}

// CodeSnippet is one generated snippet.
type CodeSnippet struct {
	Snippet  string   `json:"snippet"`
	Language string   `json:"language"` // the preview's highlighting
	Warnings []string `json:"warnings"` // unresolved vars, scripts, proxy, JWT notes
	Secrets  bool     `json:"secrets"`  // real secret values / a signed token are inlined
}

type CodeSnippetResult struct {
	Data  *CodeSnippet     `json:"data"`
	Error *session.Problem `json:"error"`
}

// CodegenTargets lists the languages in picker order.
func (a *App) CodegenTargets() []codegen.Target { return codegen.Targets() }

const settingCodegenPrefs = "codegen_prefs"

// DefaultCodegenOptions: curl, resolved values, multiline, no proxy.
var DefaultCodegenOptions = CodegenOptions{Target: "curl", Resolved: true}

// GetCodegenPrefs returns the persisted panel choices (defaults when unset or invalid).
func (a *App) GetCodegenPrefs() CodegenOptions {
	out := DefaultCodegenOptions
	if a.store == nil {
		return out
	}
	if v, ok := a.setting(settingCodegenPrefs); ok {
		var saved CodegenOptions
		if json.Unmarshal([]byte(v), &saved) == nil {
			if _, known := codegen.Find(saved.Target); known {
				out = saved
			}
		}
	}
	return out
}

// SetCodegenPrefs persists the panel choices.
func (a *App) SetCodegenPrefs(o CodegenOptions) EmptyResult {
	if _, ok := codegen.Find(o.Target); !ok {
		return EmptyResult{Error: &session.Problem{Kind: session.KindInvalid, Message: "unknown code target " + strconv.Quote(o.Target)}}
	}
	b, _ := json.Marshal(o)
	return a.putSetting(settingCodegenPrefs, string(b))
}

// GenerateCode renders a tab's current draft (the same arguments as SendRequest).
func (a *App) GenerateCode(projectID, requestID string, draft api.RequestDraft, opts SendOptions, gen CodegenOptions) CodeSnippetResult {
	if !a.session.IsLoggedIn() {
		return CodeSnippetResult{Error: problemNotLoggedIn}
	}
	if opts.Auth != nil && !api.ValidAuth(*opts.Auth) {
		return CodeSnippetResult{Error: invalidAuth()}
	}
	snip, p := a.generate(projectID, requestID, draft, opts, gen)
	return CodeSnippetResult{Data: snip, Error: p}
}

// GenerateCodeForRequest renders a saved request that is not open in a tab (the
// tree's "Copy as curl"): its server state, with the cascade the UI resolved.
func (a *App) GenerateCodeForRequest(projectID, requestID string, opts SendOptions, gen CodegenOptions) CodeSnippetResult {
	req, p := call(a, func(ctx context.Context, c *api.APIClient) (api.Request, error) { return c.GetRequest(ctx, requestID) })
	if p != nil {
		return CodeSnippetResult{Error: p}
	}
	return a.GenerateCode(projectID, requestID, req.Draft(), opts, gen)
}

func (a *App) generate(projectID, requestID string, draft api.RequestDraft, opts SendOptions, gen CodegenOptions) (*CodeSnippet, *session.Problem) {
	target, ok := codegen.Find(gen.Target)
	if !ok {
		return nil, &session.Problem{Kind: session.KindInvalid, Message: "unknown code target " + strconv.Quote(gen.Target)}
	}
	var warnings, notes []string
	template := a.sendTemplate(requestID, draft, opts)
	spec := template
	secrets := false
	if gen.Resolved {
		rv, p := a.sendVars(projectID)
		if p != nil {
			return nil, p
		}
		var unresolved []string
		spec, unresolved = engine.ResolveSpec(template, rv.vars)
		for _, k := range unresolved {
			warnings = append(warnings, "{{"+k+"}} has no value here — left as written")
		}
		signed, err := engine.SignJWT(spec, time.Now())
		if err != nil {
			// What Send would refuse to send: show the reason, keep the rest useful.
			warnings = append(warnings, err.Error())
			spec = engine.WithJWTPlaceholder(spec)
			notes = append(notes, "JWT: "+engine.JWTPlaceholder+" (it could not be signed now)")
		} else {
			spec = signed
			secrets = spec.Auth != nil && spec.Auth.Type == engine.AuthJWT
		}
		for _, s := range rv.secrets {
			if s != "" && containsValue(spec, s) {
				secrets = true
			}
		}
	} else {
		spec = engine.WithJWTPlaceholder(template)
		if spec.Auth != nil && spec.Auth.Type == engine.AuthJWT {
			notes = append(notes, "JWT: "+engine.JWTPlaceholder)
		}
		if hasFileParts(spec) {
			notes = append(notes, "file paths are placeholders (template values)")
		}
	}
	var prepared engine.Prepared
	if gen.Resolved {
		var err error
		if prepared, err = engine.Prepare(spec); err != nil {
			return nil, &session.Problem{Kind: KindRequest, Message: err.Error()}
		}
	} else {
		prepared = codegen.KeepVarTokens(engine.PrepareTemplate(spec))
	}
	if hasScripts(draft, opts.Folders) {
		n := "pre/post scripts are not represented"
		notes = append(notes, n)
		warnings = append(warnings, n)
	}
	if gen.Resolved && hasFileParts(spec) && missingLocalFile(spec) {
		warnings = append(warnings, "a file field has no file chosen on this machine — its path is a placeholder")
	}

	in := codegen.Input{
		Request: prepared, Timeout: a.engine.Timeout(), FollowRedirects: opts.FollowRedirects,
		Notes: notes, FilePaths: gen.Resolved,
	}
	if opts.ProxyID != "" {
		px, p := call(a, func(ctx context.Context, c *api.APIClient) (proxyAndWarning, error) {
			ep, w, err := a.sendProxy(ctx, c, opts.ProxyID)
			return proxyAndWarning{ep, w}, err
		})
		if p == nil && px.proxy != nil {
			in.Proxy = &codegen.Proxy{
				URL:   fmt.Sprintf("%s://%s:%d", px.proxy.Type, px.proxy.Host, px.proxy.Port),
				Label: px.proxy.Label(), HasCredentials: px.proxy.Username != "",
			}
			if gen.Target != "curl" || !gen.Proxy {
				warnings = append(warnings, codegen.ProxyNote(in.Proxy))
			}
		}
	}
	snippet, err := codegen.Generate(target.ID, in, codegen.Options{OneLine: gen.OneLine, IncludeProxy: gen.Proxy})
	if err != nil {
		return nil, &session.Problem{Kind: session.KindInvalid, Message: err.Error()}
	}
	if warnings == nil {
		warnings = []string{}
	}
	return &CodeSnippet{Snippet: snippet, Language: target.Language, Warnings: warnings, Secrets: gen.Resolved && secrets}, nil
}

// HistoryCurl renders a history entry as curl from its AS-SENT record (already
// resolved: the values toggle does not apply). History does not keep the timeout
// or redirect setting, nor a form-data body's bytes.
func (a *App) HistoryCurl(id int64, oneLine bool) CodeSnippetResult {
	r := a.GetHistoryEntry(id)
	if r.Error != nil {
		return CodeSnippetResult{Error: r.Error}
	}
	e := r.Data
	warnings := []string{"from the request as sent; history keeps no timeout / redirect setting"}
	prepared := engine.Prepared{Method: e.Summary.Method, URL: e.Resolved.URL, Body: engine.PreparedBody{Kind: engine.BodyNone}}
	multipart := e.Resolved.BodyType == api.BodyMultipart
	for _, h := range e.Resolved.Headers {
		if !h.Enabled || strings.TrimSpace(h.Key) == "" {
			continue
		}
		// The as-sent form-data type had a boundary curl makes up itself.
		if multipart && strings.EqualFold(h.Key, "Content-Type") && strings.HasPrefix(strings.ToLower(h.Value), "multipart/form-data") {
			continue
		}
		prepared.Headers = append(prepared.Headers, engine.Header{Key: h.Key, Value: h.Value, Enabled: true})
	}
	switch {
	case multipart:
		warnings = append(warnings, "the form-data body is not in history (files are never stored) — not included")
	case e.Resolved.Body != "" || e.Resolved.BodyType == api.BodyRaw:
		prepared.Body = engine.PreparedBody{Kind: engine.BodyRaw, Raw: e.Resolved.Body}
	}
	snippet, err := codegen.Generate("curl", codegen.Input{Request: prepared, FollowRedirects: true}, codegen.Options{OneLine: oneLine})
	if err != nil {
		return CodeSnippetResult{Error: &session.Problem{Kind: session.KindInvalid, Message: err.Error()}}
	}
	return CodeSnippetResult{Data: &CodeSnippet{Snippet: snippet, Language: "shell", Warnings: warnings, Secrets: true}}
}

func hasScripts(d api.RequestDraft, folders []ScriptFolder) bool {
	if strings.TrimSpace(d.PreScript) != "" || strings.TrimSpace(d.PostScript) != "" {
		return true
	}
	for _, f := range folders {
		if strings.TrimSpace(f.PreScript) != "" || strings.TrimSpace(f.PostScript) != "" {
			return true
		}
	}
	return false
}

func hasFileParts(s engine.RequestSpec) bool {
	if s.Body.Type != engine.BodyMultipart {
		return false
	}
	for _, p := range s.Body.Parts {
		if p.Enabled && p.Kind == engine.PartFile {
			return true
		}
	}
	return false
}

func missingLocalFile(s engine.RequestSpec) bool {
	for _, p := range s.Body.Parts {
		if p.Enabled && p.Kind == engine.PartFile && p.Path == "" {
			return true
		}
	}
	return false
}

// containsValue reports whether a (secret) value ended up anywhere in a spec.
func containsValue(s engine.RequestSpec, v string) bool {
	in := func(rows []engine.Header) bool {
		for _, r := range rows {
			if strings.Contains(r.Value, v) || strings.Contains(r.Key, v) {
				return true
			}
		}
		return false
	}
	if strings.Contains(s.URL, v) || in(s.Headers) || in(s.QueryParams) || in(s.Body.Fields) || strings.Contains(s.Body.Content, v) {
		return true
	}
	for _, p := range s.Body.Parts {
		if strings.Contains(p.Value, v) {
			return true
		}
	}
	if a := s.Auth; a != nil {
		for _, f := range []string{a.BearerToken, a.BasicPassword, a.BasicUsername, a.APIKeyValue, a.JWTSecret} {
			if strings.Contains(f, v) {
				return true
			}
		}
	}
	return false
}
