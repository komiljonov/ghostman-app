package api

import (
	"slices"
	"strings"
)

// Authorization is a cascading per-node setting (like follow_redirects) stored on
// the server per folder and request: Type inherit | none | bearer | basic |
// api_key | jwt plus typed fields, which may hold {{vars}}. A jwt config is a
// TEMPLATE the client signs at send time (engine/jwt.go); the server never
// signs and never sees a resolved secret. Fields not matching Type
// are kept by the server (switching back restores them), so the client never
// clears them either. Resolution is the client's job (settingsResolver.ts);
// sending applies the result (engine/auth.go).

const (
	AuthInherit = "inherit"
	AuthNone    = "none"
	AuthBearer  = "bearer"
	AuthBasic   = "basic"
	AuthAPIKey  = "api_key"
	AuthJWT     = "jwt"

	APIKeyInHeader = "header"
	APIKeyInQuery  = "query"

	JWTHS256 = "HS256"
)

// AuthTypes are the valid auth types.
var AuthTypes = []string{AuthInherit, AuthNone, AuthBearer, AuthBasic, AuthAPIKey, AuthJWT}

// JWTAlgorithms are the signing algorithms a jwt config may name.
var JWTAlgorithms = []string{"HS256", "HS384", "HS512"}

// Auth is a node's stored auth configuration (the server's shape).
type Auth struct {
	Type          string `json:"type"`
	BearerToken   string `json:"bearer_token"`
	BasicUsername string `json:"basic_username"`
	BasicPassword string `json:"basic_password"`
	APIKeyName    string `json:"api_key_name"`
	APIKeyValue   string `json:"api_key_value"`
	APIKeyIn      string `json:"api_key_in"`

	JWTAlgorithm    string `json:"jwt_algorithm"`     // HS256 | HS384 | HS512
	JWTSecret       string `json:"jwt_secret"`        // template; a {{secret variable}} is the recommended form
	JWTSecretBase64 bool   `json:"jwt_secret_base64"` // the (resolved) secret is Base64: decode before signing
	JWTPayload      string `json:"jwt_payload"`       // JSON object template ({{vars}}, {{$now±N}} claims)
	JWTAddTo        string `json:"jwt_add_to"`        // header | query
	JWTName         string `json:"jwt_name"`          // "" = Authorization (header) / token (query)
	JWTPrefix       string `json:"jwt_prefix"`        // header only; "" = "Bearer "
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

	JWTAlgorithm    *string `json:"jwt_algorithm,omitempty"`
	JWTSecret       *string `json:"jwt_secret,omitempty"`
	JWTSecretBase64 *bool   `json:"jwt_secret_base64,omitempty"`
	JWTPayload      *string `json:"jwt_payload,omitempty"`
	JWTAddTo        *string `json:"jwt_add_to,omitempty"`
	JWTName         *string `json:"jwt_name,omitempty"`
	JWTPrefix       *string `json:"jwt_prefix,omitempty"`
}

// ValidAuth reports whether a's type, API key placement, JWT algorithm and JWT
// placement are known values.
func ValidAuth(a Auth) bool {
	n := NormalizeAuth(a)
	placement := func(v string) bool { return v == APIKeyInHeader || v == APIKeyInQuery }
	for _, t := range AuthTypes {
		if n.Type == t {
			return placement(n.APIKeyIn) && placement(n.JWTAddTo) && slices.Contains(JWTAlgorithms, n.JWTAlgorithm)
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
	if a.JWTAlgorithm == "" {
		a.JWTAlgorithm = JWTHS256
	}
	if a.JWTAddTo == "" {
		a.JWTAddTo = APIKeyInHeader
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
	p.JWTAlgorithm = field(b.JWTAlgorithm, d.JWTAlgorithm)
	p.JWTSecret = field(b.JWTSecret, d.JWTSecret)
	if b.JWTSecretBase64 != d.JWTSecretBase64 {
		v := d.JWTSecretBase64
		p.JWTSecretBase64 = &v
	}
	p.JWTPayload = field(b.JWTPayload, d.JWTPayload)
	p.JWTAddTo = field(b.JWTAddTo, d.JWTAddTo)
	p.JWTName = field(b.JWTName, d.JWTName)
	p.JWTPrefix = field(b.JWTPrefix, d.JWTPrefix)
	return p, true
}

// FullAuthPatch sends every field (a new request created from a copy).
func FullAuthPatch(a Auth) *AuthPatch {
	n := NormalizeAuth(a)
	return &AuthPatch{Type: n.Type, BearerToken: &n.BearerToken, BasicUsername: &n.BasicUsername, BasicPassword: &n.BasicPassword,
		APIKeyName: &n.APIKeyName, APIKeyValue: &n.APIKeyValue, APIKeyIn: &n.APIKeyIn,
		JWTAlgorithm: &n.JWTAlgorithm, JWTSecret: &n.JWTSecret, JWTSecretBase64: &n.JWTSecretBase64, JWTPayload: &n.JWTPayload,
		JWTAddTo: &n.JWTAddTo, JWTName: &n.JWTName, JWTPrefix: &n.JWTPrefix}
}
