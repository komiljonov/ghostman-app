package api

import "strings"

// Authorization is a cascading per-node setting (like follow_redirects) stored on
// the server per folder and request: Type inherit | none | bearer | basic |
// api_key plus typed fields, which may hold {{vars}}. Fields not matching Type
// are kept by the server (switching back restores them), so the client never
// clears them either. Resolution is the client's job (settingsResolver.ts);
// sending applies the result (engine/auth.go).

const (
	AuthInherit = "inherit"
	AuthNone    = "none"
	AuthBearer  = "bearer"
	AuthBasic   = "basic"
	AuthAPIKey  = "api_key"

	APIKeyInHeader = "header"
	APIKeyInQuery  = "query"
)

// AuthTypes are the valid auth types.
var AuthTypes = []string{AuthInherit, AuthNone, AuthBearer, AuthBasic, AuthAPIKey}

// Auth is a node's stored auth configuration (the server's shape).
type Auth struct {
	Type          string `json:"type"`
	BearerToken   string `json:"bearer_token"`
	BasicUsername string `json:"basic_username"`
	BasicPassword string `json:"basic_password"`
	APIKeyName    string `json:"api_key_name"`
	APIKeyValue   string `json:"api_key_value"`
	APIKeyIn      string `json:"api_key_in"`
}

// AuthPatch is a partial auth update: Type is always sent, the other fields only
// when they changed (the server keeps the rest).
type AuthPatch struct {
	Type          string  `json:"type"`
	BearerToken   *string `json:"bearer_token,omitempty"`
	BasicUsername *string `json:"basic_username,omitempty"`
	BasicPassword *string `json:"basic_password,omitempty"`
	APIKeyName    *string `json:"api_key_name,omitempty"`
	APIKeyValue   *string `json:"api_key_value,omitempty"`
	APIKeyIn      *string `json:"api_key_in,omitempty"`
}

// ValidAuth reports whether a's type and API key placement are known values.
func ValidAuth(a Auth) bool {
	n := NormalizeAuth(a)
	for _, t := range AuthTypes {
		if n.Type == t {
			return n.APIKeyIn == APIKeyInHeader || n.APIKeyIn == APIKeyInQuery
		}
	}
	return false
}

// NormalizeAuth fills the defaults (absent type = inherit, placement = header).
func NormalizeAuth(a Auth) Auth {
	if strings.TrimSpace(a.Type) == "" {
		a.Type = AuthInherit
	}
	if a.APIKeyIn == "" {
		a.APIKeyIn = APIKeyInHeader
	}
	return a
}

// BuildAuthPatch returns the patch turning base into draft (type + changed
// fields), and whether anything differs.
func BuildAuthPatch(base, draft Auth) (*AuthPatch, bool) {
	b, d := NormalizeAuth(base), NormalizeAuth(draft)
	if b == d {
		return nil, false
	}
	p := &AuthPatch{Type: d.Type}
	field := func(from, to string) *string {
		if from == to {
			return nil
		}
		return &to
	}
	p.BearerToken = field(b.BearerToken, d.BearerToken)
	p.BasicUsername = field(b.BasicUsername, d.BasicUsername)
	p.BasicPassword = field(b.BasicPassword, d.BasicPassword)
	p.APIKeyName = field(b.APIKeyName, d.APIKeyName)
	p.APIKeyValue = field(b.APIKeyValue, d.APIKeyValue)
	p.APIKeyIn = field(b.APIKeyIn, d.APIKeyIn)
	return p, true
}

// FullAuthPatch sends every field (a new request created from a copy).
func FullAuthPatch(a Auth) *AuthPatch {
	n := NormalizeAuth(a)
	return &AuthPatch{Type: n.Type, BearerToken: &n.BearerToken, BasicUsername: &n.BasicUsername, BasicPassword: &n.BasicPassword,
		APIKeyName: &n.APIKeyName, APIKeyValue: &n.APIKeyValue, APIKeyIn: &n.APIKeyIn}
}
