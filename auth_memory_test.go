package main

import (
	"bytes"
	"io"
	"log/slog"
	"net/http"
	"strings"
	"sync"
	"testing"

	"ghostman/internal/api"
)

// memoryApp: requests r1 / r2 in project p1, r9 in p2, folder f1 in p1. Every
// server request is recorded (method, path, body).
func memoryApp(t *testing.T) (*App, func() []string) {
	t.Helper()
	var mu sync.Mutex
	var seen []string
	project := map[string]string{"r1": "p1", "r2": "p1", "r9": "p2", "f1": "p1"}
	record := func(kind string) http.HandlerFunc {
		return func(w http.ResponseWriter, r *http.Request) {
			b, _ := io.ReadAll(r.Body)
			mu.Lock()
			seen = append(seen, r.Method+" "+r.URL.Path+" "+string(b))
			mu.Unlock()
			id := r.PathValue("id")
			_, _ = w.Write([]byte(`{"id":"` + id + `","project_id":"` + project[id] + `","name":"` + kind + `"}`))
		}
	}
	a := newTestApp(t, true, map[string]http.HandlerFunc{
		"PATCH /api/v1/requests/{id}": record("request"),
		"PATCH /api/v1/folders/{id}":  record("folder"),
	})
	return a, func() []string {
		mu.Lock()
		defer mu.Unlock()
		return append([]string(nil), seen...)
	}
}

func save(t *testing.T, a *App, id string, auth api.Auth) {
	t.Helper()
	base := api.RequestDraft{Method: "GET", Body: api.RequestBody{Type: api.BodyNone}, Auth: api.NormalizeAuth(api.Auth{})}
	draft := base
	draft.Auth = auth
	if r := a.SaveRequest(id, base, draft); r.Error != nil {
		t.Fatalf("save %s: %s", id, r.Error.Message)
	}
}

func switchTo(t *testing.T, a *App, project string, node api.Auth, to string) AuthSwitch {
	t.Helper()
	r := a.SwitchAuthType(project, node, to)
	if r.Error != nil || r.Data == nil {
		t.Fatalf("switch: %+v", r.Error)
	}
	return *r.Data
}

var emptyAuth = api.NormalizeAuth(api.Auth{Type: api.AuthInherit})

func TestAuthMemoryCaptureAndPrefill(t *testing.T) {
	var logs bytes.Buffer
	prev := slog.Default()
	slog.SetDefault(slog.New(slog.NewTextHandler(&logs, &slog.HandlerOptions{Level: slog.LevelDebug})))
	defer slog.SetDefault(prev)
	a, seen := memoryApp(t)

	// Nothing remembered yet: only the type changes.
	if s := switchTo(t, a, "p1", emptyAuth, api.AuthBearer); s.Prefilled || s.Auth.BearerToken != "" || s.Auth.Type != api.AuthBearer {
		t.Fatalf("no memory: %+v", s)
	}

	// Capture on save; last write wins.
	save(t, a, "r1", api.Auth{Type: api.AuthBearer, BearerToken: "{{API_TOKEN}}"})
	if s := switchTo(t, a, "p1", emptyAuth, api.AuthBearer); !s.Prefilled || s.Auth.BearerToken != "{{API_TOKEN}}" {
		t.Fatalf("prefill: %+v", s)
	}
	save(t, a, "r2", api.Auth{Type: api.AuthBearer, BearerToken: "literal-bearer-77"})
	if s := switchTo(t, a, "p1", emptyAuth, api.AuthBearer); s.Auth.BearerToken != "literal-bearer-77" {
		t.Fatalf("last wins: %+v", s)
	}

	// Per-type isolation; a node's own (server-kept) values are never replaced.
	save(t, a, "r1", api.Auth{Type: api.AuthBasic, BasicUsername: "alice", BasicPassword: "basic-pw-55"})
	if s := switchTo(t, a, "p1", emptyAuth, api.AuthAPIKey); s.Prefilled {
		t.Fatalf("no api_key memory yet: %+v", s)
	}
	own := api.Auth{Type: api.AuthNone, BasicUsername: "dave", BasicPassword: "own"}
	if s := switchTo(t, a, "p1", own, api.AuthBasic); s.Prefilled || s.Auth.BasicUsername != "dave" || s.Auth.BasicPassword != "own" {
		t.Fatalf("own values must stay: %+v", s)
	}

	// A pure mode switch saves no fields: switching a node back to its own basic
	// creds (kept by the server) must not overwrite the memory with them.
	ownBase := api.RequestDraft{Method: "GET", Body: api.RequestBody{Type: api.BodyNone},
		Auth: api.NormalizeAuth(api.Auth{Type: api.AuthBearer, BasicUsername: "dave", BasicPassword: "dave-pw"})}
	ownNext := ownBase
	ownNext.Auth.Type = api.AuthBasic
	if r := a.SaveRequest("r2", ownBase, ownNext); r.Error != nil {
		t.Fatal(r.Error.Message)
	}
	if s := switchTo(t, a, "p1", emptyAuth, api.AuthBasic); s.Auth.BasicUsername != "alice" {
		t.Fatalf("a pure switch overwrote the memory: %+v", s)
	}

	// Per-project isolation.
	if s := switchTo(t, a, "p2", emptyAuth, api.AuthBearer); s.Prefilled {
		t.Fatalf("p1's memory leaked into p2: %+v", s)
	}
	save(t, a, "r9", api.Auth{Type: api.AuthAPIKey, APIKeyName: "k", APIKeyValue: "v", APIKeyIn: api.APIKeyInQuery})
	if s := switchTo(t, a, "p1", emptyAuth, api.AuthAPIKey); s.Prefilled {
		t.Fatalf("p2's memory leaked into p1: %+v", s)
	}
	if s := switchTo(t, a, "p2", emptyAuth, api.AuthAPIKey); !s.Prefilled || s.Auth.APIKeyIn != api.APIKeyInQuery {
		t.Fatalf("api_key in=query: %+v", s)
	}

	// Folder path: the settings modal's save captures into the same store; jwt keeps
	// every field.
	jwtCfg := api.Auth{Type: api.AuthJWT, JWTAlgorithm: "HS384", JWTSecret: "jwt-secret-99", JWTSecretBase64: true,
		JWTPayload: `{"iat":"{{$now}}"}`, JWTAddTo: api.APIKeyInQuery, JWTName: "t", JWTPrefix: "X "}
	saved := FolderSettingsInput{FollowRedirects: api.SettingInherit, Auth: emptyAuth}
	next := saved
	next.Auth = jwtCfg
	if r := a.SaveFolderSettings("f1", saved, next); r.Error != nil {
		t.Fatal(r.Error.Message)
	}
	s := switchTo(t, a, "p1", emptyAuth, api.AuthJWT)
	if want := api.NormalizeAuth(jwtCfg); !s.Prefilled || s.Auth != want {
		t.Fatalf("jwt prefill = %+v\nwant %+v", s.Auth, want)
	}

	// Inherit / none / an empty config capture nothing.
	save(t, a, "r1", api.Auth{Type: api.AuthNone, BearerToken: "ignored-none"})
	save(t, a, "r1", api.Auth{Type: api.AuthBearer}) // empty token: not remembered
	if s := switchTo(t, a, "p1", emptyAuth, api.AuthBearer); s.Auth.BearerToken != "literal-bearer-77" {
		t.Fatalf("an empty / none save must not overwrite the memory: %+v", s)
	}
	if r := a.SwitchAuthType("p1", emptyAuth, "oauth"); r.Error == nil {
		t.Fatal("unknown type must be refused")
	}

	// Recording fake: the remembered values reach the server ONLY inside the normal
	// auth PATCH of the node they were typed on — a switch / prefill makes no call.
	calls := seen()
	for _, secret := range []string{"literal-bearer-77", "basic-pw-55", "jwt-secret-99"} {
		n := 0
		for _, c := range calls {
			if strings.Contains(c, secret) {
				n++
				if !strings.HasPrefix(c, "PATCH ") || !strings.Contains(c, `"auth"`) {
					t.Errorf("%s outside an auth PATCH: %s", secret, c)
				}
			}
		}
		if n != 1 {
			t.Errorf("%s sent %d times, want exactly its own save", secret, n)
		}
		if strings.Contains(logs.String(), secret) {
			t.Errorf("%s logged", secret)
		}
	}
	before := len(calls)
	switchTo(t, a, "p1", emptyAuth, api.AuthBasic)
	if len(seen()) != before {
		t.Fatal("a switch must not call the server")
	}
}

func TestAuthMemoryStoresOnlyTheTypesFields(t *testing.T) {
	a, _ := memoryApp(t)
	save(t, a, "r1", api.Auth{Type: api.AuthBearer, BearerToken: "{{T}}"})
	got, ok, err := a.store.AuthDefault(a.ctx, "p1", api.AuthBearer)
	if err != nil || !ok || !strings.Contains(got, `"bearer_token":"{{T}}"`) || strings.Contains(got, `"basic_password":"x`) {
		t.Fatalf("stored row = %q %v %v", got, ok, err)
	}
}
