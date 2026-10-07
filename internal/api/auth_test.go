package api

import (
	"encoding/json"
	"testing"
)

func TestBuildAuthPatchSendsTypeAndChangedFieldsOnly(t *testing.T) {
	base := Auth{Type: AuthBearer, BearerToken: "{{T}}", BasicUsername: "kept", APIKeyIn: APIKeyInHeader}
	cases := []struct {
		name  string
		draft Auth
		want  string // "" = no patch
	}{
		{"unchanged", base, ""},
		{"absent defaults equal inherit/header", Auth{}, `{"type":"inherit","bearer_token":"","basic_username":""}`},
		{"mode switch keeps other fields", Auth{Type: AuthBasic, BearerToken: "{{T}}", BasicUsername: "kept", APIKeyIn: APIKeyInHeader}, `{"type":"basic"}`},
		{"one field", Auth{Type: AuthBearer, BearerToken: "{{T2}}", BasicUsername: "kept"}, `{"type":"bearer","bearer_token":"{{T2}}"}`},
		{"api key placement", Auth{Type: AuthAPIKey, BearerToken: "{{T}}", BasicUsername: "kept", APIKeyName: "k", APIKeyIn: APIKeyInQuery},
			`{"type":"api_key","api_key_name":"k","api_key_in":"query"}`},
	}
	for _, c := range cases {
		p, ok := BuildAuthPatch(base, c.draft)
		got := ""
		if ok {
			b, _ := json.Marshal(p)
			got = string(b)
		}
		if got != c.want {
			t.Errorf("%s: %s, want %s", c.name, got, c.want)
		}
	}
}

func TestBuildRequestPatchCarriesAuth(t *testing.T) {
	base := RequestDraft{Method: "GET", URL: "u", Body: RequestBody{Type: BodyNone}, Auth: Auth{Type: AuthInherit}}
	draft := base
	draft.Auth = Auth{Type: AuthNone}
	p, changed := BuildRequestPatch(base, draft)
	if !changed || p.Auth == nil || p.Auth.Type != AuthNone || p.Method != nil {
		t.Fatalf("patch = %+v", p)
	}
	if _, changed := BuildRequestPatch(base, base); changed {
		t.Fatal("no change expected")
	}
}

func TestValidAuth(t *testing.T) {
	for _, a := range []Auth{{}, {Type: AuthBearer}, {Type: AuthAPIKey, APIKeyIn: APIKeyInQuery}} {
		if !ValidAuth(a) {
			t.Errorf("%+v must be valid", a)
		}
	}
	for _, a := range []Auth{{Type: "oauth"}, {Type: AuthAPIKey, APIKeyIn: "cookie"}} {
		if ValidAuth(a) {
			t.Errorf("%+v must be invalid", a)
		}
	}
}
