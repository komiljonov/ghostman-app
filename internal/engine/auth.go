package engine

import (
	"encoding/base64"
	"net/url"
	"strings"
)

// Authorization at send time. The UI resolves the cascading auth setting
// (request → folders, frontend/src/settingsResolver.ts) and passes the
// effective config in RequestSpec.Auth, still in template form; ResolveSpec
// resolves {{vars}} inside its values with the same env map as everything else
// (secret overlay included, unresolved keys reported). ApplyAuth then turns it
// into ordinary rows:
//
//	bearer              → Authorization: Bearer <token>
//	basic               → Authorization: Basic base64(<username>:<password>)
//	api_key, in=header  → <name>: <value>
//	api_key, in=query   → name=value appended to the query string
//	none / inherit / "" → nothing
//
// USER-WRITTEN BEATS DERIVED: if the request's enabled headers already contain
// the header auth would add (Authorization, or the API key's name; case-
// insensitive), or its query (enabled params or the URL's own query) already has
// the API key's name, nothing is added. Because the result is a plain header
// row, the redirect rules apply to it unchanged (Authorization is dropped when
// the chain leaves the initial host for a non-subdomain).

// Auth types (the server's values).
const (
	AuthInherit = "inherit"
	AuthNone    = "none"
	AuthBearer  = "bearer"
	AuthBasic   = "basic"
	AuthAPIKey  = "api_key"

	APIKeyInHeader = "header"
	APIKeyInQuery  = "query"
)

// Auth is an auth configuration (the server's shape). Values may hold {{vars}}.
type Auth struct {
	Type          string `json:"type"`
	BearerToken   string `json:"bearer_token"`
	BasicUsername string `json:"basic_username"`
	BasicPassword string `json:"basic_password"`
	APIKeyName    string `json:"api_key_name"`
	APIKeyValue   string `json:"api_key_value"`
	APIKeyIn      string `json:"api_key_in"`
}

// resolveAuth resolves {{vars}} inside the values (not the type / placement).
func resolveAuth(a Auth, res func(string) string) Auth {
	switch a.Type {
	case AuthBearer:
		a.BearerToken = res(a.BearerToken)
	case AuthBasic:
		a.BasicUsername, a.BasicPassword = res(a.BasicUsername), res(a.BasicPassword)
	case AuthAPIKey:
		a.APIKeyName, a.APIKeyValue = res(a.APIKeyName), res(a.APIKeyValue)
	}
	return a
}

// BasicCredentials is the value of a basic Authorization header.
func BasicCredentials(username, password string) string {
	return "Basic " + base64.StdEncoding.EncodeToString([]byte(username+":"+password))
}

// derivedAuth is what an auth config adds: one header or one query param.
func derivedAuth(a Auth) (h *Header, q *Header) {
	switch a.Type {
	case AuthBearer:
		if t := strings.TrimSpace(a.BearerToken); t != "" {
			return &Header{Key: "Authorization", Value: "Bearer " + t, Enabled: true}, nil
		}
	case AuthBasic:
		if a.BasicUsername != "" || a.BasicPassword != "" {
			return &Header{Key: "Authorization", Value: BasicCredentials(a.BasicUsername, a.BasicPassword), Enabled: true}, nil
		}
	case AuthAPIKey:
		name := strings.TrimSpace(a.APIKeyName)
		if name == "" {
			return nil, nil
		}
		row := &Header{Key: name, Value: a.APIKeyValue, Enabled: true}
		if a.APIKeyIn == APIKeyInQuery {
			return nil, row
		}
		return row, nil
	}
	return nil, nil
}

func hasKey(rows []Header, key string) bool {
	for _, r := range enabled(rows) {
		if strings.EqualFold(strings.TrimSpace(r.Key), key) {
			return true
		}
	}
	return false
}

// urlHasParam reports whether the URL's own query (before the params rows) has key.
func urlHasParam(raw, key string) bool {
	u, err := url.Parse(strings.TrimSpace(raw))
	if err != nil {
		return false
	}
	_, ok := u.Query()[key]
	return ok
}

// ApplyAuth returns spec with its auth turned into a header or query row (see
// the rules above) and Auth cleared, so applying twice changes nothing. The
// auth values must already be resolved (ResolveSpec does it).
func ApplyAuth(spec RequestSpec) RequestSpec {
	if spec.Auth == nil {
		return spec
	}
	h, q := derivedAuth(*spec.Auth)
	spec.Auth = nil
	if h != nil && !hasKey(spec.Headers, h.Key) {
		spec.Headers = append(append([]Header{}, spec.Headers...), *h)
	}
	if q != nil && !hasKey(spec.QueryParams, q.Key) && !urlHasParam(spec.URL, q.Key) {
		spec.QueryParams = append(append([]Header{}, spec.QueryParams...), *q)
	}
	return spec
}
