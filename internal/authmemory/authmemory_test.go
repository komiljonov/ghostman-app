package authmemory

import (
	"testing"

	"ghostman/internal/api"
)

var mems = map[string]api.Auth{
	api.AuthBearer: {Type: api.AuthBearer, BearerToken: "{{API_TOKEN}}"},
	api.AuthBasic:  {Type: api.AuthBasic, BasicUsername: "u", BasicPassword: "p@ss"},
	api.AuthAPIKey: {Type: api.AuthAPIKey, APIKeyName: "X-Key", APIKeyValue: "{{K}}", APIKeyIn: api.APIKeyInQuery},
	api.AuthJWT: {Type: api.AuthJWT, JWTAlgorithm: "HS512", JWTSecret: "{{S}}", JWTSecretBase64: true,
		JWTPayload: `{"exp":"{{$now+60}}"}`, JWTAddTo: api.APIKeyInQuery, JWTName: "jwt", JWTPrefix: "JWT "},
}

func blank() api.Auth { return api.NormalizeAuth(api.Auth{Type: api.AuthInherit}) }

func TestSwitchPrefillsOnlyWhenEmpty(t *testing.T) {
	for _, tt := range []struct {
		name    string
		node    api.Auth
		to      string
		filled  bool
		changed func(api.Auth) bool // the expectation on the result
	}{
		{"bearer: empty → filled", blank(), api.AuthBearer, true,
			func(a api.Auth) bool { return a.BearerToken == "{{API_TOKEN}}" }},
		{"bearer: own token → untouched", api.Auth{Type: api.AuthNone, BearerToken: "mine"}, api.AuthBearer, false,
			func(a api.Auth) bool { return a.BearerToken == "mine" }},
		{"basic: empty → both filled", blank(), api.AuthBasic, true,
			func(a api.Auth) bool { return a.BasicUsername == "u" && a.BasicPassword == "p@ss" }},
		{"basic: partial (username only) → untouched", api.Auth{BasicUsername: "me"}, api.AuthBasic, false,
			func(a api.Auth) bool { return a.BasicUsername == "me" && a.BasicPassword == "" }},
		{"basic: server-preserved password only → untouched", api.Auth{Type: api.AuthBearer, BearerToken: "t", BasicPassword: "kept"}, api.AuthBasic, false,
			func(a api.Auth) bool {
				return a.BasicPassword == "kept" && a.BasicUsername == "" && a.BearerToken == "t"
			}},
		{"api_key: default 'in' doesn't count → filled incl. in=query", blank(), api.AuthAPIKey, true,
			func(a api.Auth) bool {
				return a.APIKeyName == "X-Key" && a.APIKeyValue == "{{K}}" && a.APIKeyIn == api.APIKeyInQuery
			}},
		{"api_key: value only → untouched", api.Auth{APIKeyValue: "v"}, api.AuthAPIKey, false,
			func(a api.Auth) bool { return a.APIKeyName == "" && a.APIKeyIn == "" }},
		{"jwt: default algorithm / add_to don't count → every field filled", blank(), api.AuthJWT, true,
			func(a api.Auth) bool {
				return a.JWTAlgorithm == "HS512" && a.JWTSecret == "{{S}}" && a.JWTSecretBase64 && a.JWTPayload == `{"exp":"{{$now+60}}"}` &&
					a.JWTAddTo == api.APIKeyInQuery && a.JWTName == "jwt" && a.JWTPrefix == "JWT "
			}},
		{"jwt: non-default enums alone still count as empty", api.Auth{JWTAlgorithm: "HS384", JWTAddTo: api.APIKeyInQuery}, api.AuthJWT, true,
			func(a api.Auth) bool { return a.JWTAlgorithm == "HS512" && a.JWTSecret == "{{S}}" }},
		{"jwt: server-preserved payload → untouched", api.Auth{Type: api.AuthNone, JWTPayload: `{"sub":"x"}`}, api.AuthJWT, false,
			func(a api.Auth) bool {
				return a.JWTPayload == `{"sub":"x"}` && a.JWTSecret == "" && a.JWTAlgorithm == ""
			}},
		{"jwt: secret only → untouched", api.Auth{JWTSecret: "k"}, api.AuthJWT, false,
			func(a api.Auth) bool { return a.JWTSecret == "k" && a.JWTPayload == "" }},
		{"inherit: nothing prefilled", blank(), api.AuthInherit, false,
			func(a api.Auth) bool { return a.BearerToken == "" }},
		{"none: nothing prefilled", blank(), api.AuthNone, false,
			func(a api.Auth) bool { return a.BasicUsername == "" }},
	} {
		mem, ok := mems[tt.to]
		var m *api.Auth
		if ok {
			m = &mem
		}
		got, filled := Switch(tt.node, tt.to, m)
		if filled != tt.filled || got.Type != tt.to || !tt.changed(got) {
			t.Errorf("%s: filled=%v got=%+v", tt.name, filled, got)
		}
	}
	// No memory yet: only the type changes.
	if got, filled := Switch(blank(), api.AuthBearer, nil); filled || got.Type != api.AuthBearer || got.BearerToken != "" {
		t.Errorf("no memory: %+v %v", got, filled)
	}
}

func TestSwitchKeepsOtherTypesFields(t *testing.T) {
	node := api.Auth{Type: api.AuthBasic, BasicUsername: "keep", BasicPassword: "me", APIKeyName: "old"}
	m := mems[api.AuthBearer]
	got, filled := Switch(node, api.AuthBearer, &m)
	if !filled || got.BasicUsername != "keep" || got.BasicPassword != "me" || got.APIKeyName != "old" {
		t.Fatalf("other fields must survive: %+v", got)
	}
}

func TestExtract(t *testing.T) {
	full := api.Auth{Type: api.AuthBearer, BearerToken: "t", BasicUsername: "other", JWTSecret: "x"}
	got, ok := Extract(full)
	if !ok || got != (api.Auth{Type: api.AuthBearer, BearerToken: "t"}) {
		t.Fatalf("bearer extract = %+v %v (other types' fields must not be remembered)", got, ok)
	}
	got, ok = Extract(mems[api.AuthJWT])
	if !ok || got != mems[api.AuthJWT] {
		t.Fatalf("jwt extract = %+v", got)
	}
	for _, a := range []api.Auth{
		{Type: api.AuthInherit, BearerToken: "t"},
		{Type: api.AuthNone, BasicUsername: "u"},
		{Type: api.AuthBearer},
		{Type: api.AuthJWT, JWTAlgorithm: "HS384", JWTName: "n"}, // secret + payload empty
		{Type: api.AuthAPIKey, APIKeyIn: api.APIKeyInQuery},
	} {
		if _, ok := Extract(a); ok {
			t.Errorf("nothing to remember in %+v", a)
		}
	}
}

func TestCaptures(t *testing.T) {
	jwtOwn := api.Auth{Type: api.AuthNone, JWTPayload: `{"sub":"kept"}`}
	switched := jwtOwn
	switched.Type = api.AuthJWT
	for _, tt := range []struct {
		name       string
		base, next api.Auth
		want       bool
	}{
		{"typed a token", api.Auth{Type: api.AuthBearer}, api.Auth{Type: api.AuthBearer, BearerToken: "t"}, true},
		{"edited a token", api.Auth{Type: api.AuthBearer, BearerToken: "t"}, api.Auth{Type: api.AuthBearer, BearerToken: "t2"}, true},
		{"prefill then save (fields changed from empty)", api.Auth{Type: api.AuthInherit}, api.Auth{Type: api.AuthBearer, BearerToken: "t"}, true},
		{"pure switch back to own basic creds", api.Auth{Type: api.AuthBearer, BasicUsername: "dave", BasicPassword: "pw"},
			api.Auth{Type: api.AuthBasic, BasicUsername: "dave", BasicPassword: "pw"}, false},
		{"pure switch onto a server-kept jwt payload", jwtOwn, switched, false},
		{"another type's field changed", api.Auth{Type: api.AuthBearer, BearerToken: "t"}, api.Auth{Type: api.AuthBearer, BearerToken: "t", BasicUsername: "x"}, false},
		{"cleared to empty", api.Auth{Type: api.AuthBearer, BearerToken: "t"}, api.Auth{Type: api.AuthBearer}, false},
		{"api_key: only 'in' changed (still counts — a field of the type)", api.Auth{Type: api.AuthAPIKey, APIKeyName: "k"},
			api.Auth{Type: api.AuthAPIKey, APIKeyName: "k", APIKeyIn: api.APIKeyInQuery}, true},
		{"none / inherit", api.Auth{Type: api.AuthBearer, BearerToken: "t"}, api.Auth{Type: api.AuthNone, BearerToken: "t2"}, false},
	} {
		if got := Captures(tt.base, tt.next); got != tt.want {
			t.Errorf("%s: Captures = %v", tt.name, got)
		}
	}
}
