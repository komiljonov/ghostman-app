package main

import (
	"database/sql"
	"encoding/json"
	"io"
	"net/http"
	"net/http/httptest"
	"strings"
	"sync"
	"testing"

	"ghostman/internal/api"
)

// authEnvApp: project p1 with active env "dev" (BASE_URL regular, API_TOKEN
// secret with a local value, MISSING secret without one).
func authEnvApp(t *testing.T, target string, extra map[string]http.HandlerFunc) *App {
	t.Helper()
	routes := map[string]http.HandlerFunc{
		"GET /api/v1/projects/{project_id}/environments": func(w http.ResponseWriter, _ *http.Request) {
			_, _ = w.Write([]byte(`[{"id":"dev","name":"dev","sort_order":0,"created_at":"x"}]`))
		},
		"GET /api/v1/environments/{env_id}/variables": func(w http.ResponseWriter, _ *http.Request) {
			_, _ = w.Write([]byte(`[{"id":"v1","key":"BASE_URL","type":"regular","value":"` + target + `","sort_order":0},
				{"id":"v2","key":"API_TOKEN","type":"secret","value":null,"sort_order":1},
				{"id":"v3","key":"MISSING","type":"secret","value":null,"sort_order":2}]`))
		},
	}
	for k, v := range extra {
		routes[k] = v
	}
	a := newTestApp(t, true, routes)
	if err := a.store.PutSecret(a.ctx, "dev", "API_TOKEN", "local-secret-9"); err != nil {
		t.Fatal(err)
	}
	if r := a.SetActiveEnvironment("p1", "dev"); r.Error != nil {
		t.Fatal(r.Error.Message)
	}
	return a
}

func TestSendAppliesResolvedAuthWithLocalSecret(t *testing.T) {
	var gotAuth, gotQuery string
	target := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		gotAuth, gotQuery = r.Header.Get("Authorization"), r.URL.RawQuery
	}))
	defer target.Close()
	a := authEnvApp(t, target.URL, nil)
	draft := api.RequestDraft{Method: "GET", URL: "{{BASE_URL}}/x", Body: api.RequestBody{Type: api.BodyNone}}

	bearer := &api.Auth{Type: api.AuthBearer, BearerToken: "{{API_TOKEN}}"}
	res := a.SendRequest("p1", "r1", draft, SendOptions{Auth: bearer, AuthSource: "folder ‘api’"})
	if res.Error != nil || gotAuth != "Bearer local-secret-9" || len(res.Unresolved) != 0 {
		t.Fatalf("bearer: auth=%q res=%s", gotAuth, toJSON(t, res))
	}
	// History: the template copy keeps the config as authored, the resolved copy
	// has the header that was sent.
	e := a.GetHistoryEntry(historyRows(t, a)[0].ID).Data
	if e.Auth == nil || e.Auth.BearerToken != "{{API_TOKEN}}" || e.AuthSource != "folder ‘api’" {
		t.Errorf("history auth = %+v %q", e.Auth, e.AuthSource)
	}
	if !strings.Contains(toJSON(t, e.Resolved.Headers), "Bearer local-secret-9") || strings.Contains(toJSON(t, e.Template.Headers), "Bearer") {
		t.Errorf("resolved = %s template = %s", toJSON(t, e.Resolved.Headers), toJSON(t, e.Template.Headers))
	}

	// Unresolved secret inside auth: reported, sent literally.
	res = a.SendRequest("p1", "r1", draft, SendOptions{Auth: &api.Auth{Type: api.AuthBearer, BearerToken: "{{MISSING}}"}})
	if res.Error != nil || gotAuth != "Bearer {{MISSING}}" || toJSON(t, res.Unresolved) != `["MISSING"]` {
		t.Fatalf("unresolved: auth=%q unresolved=%v", gotAuth, res.Unresolved)
	}

	// API key in the query, with the secret; masked in the hop URL shown to the UI.
	res = a.SendRequest("p1", "r1", draft, SendOptions{Auth: &api.Auth{Type: api.AuthAPIKey, APIKeyName: "key", APIKeyValue: "{{API_TOKEN}}", APIKeyIn: api.APIKeyInQuery}})
	if res.Error != nil || gotQuery != "key=local-secret-9" || gotAuth != "" {
		t.Fatalf("api key: query=%q auth=%q", gotQuery, gotAuth)
	}
	if strings.Contains(toJSON(t, res.Hops), "local-secret-9") {
		t.Errorf("secret must be masked in hops: %s", toJSON(t, res.Hops))
	}

	// No auth / a manual header wins.
	a.SendRequest("p1", "r1", draft, SendOptions{})
	if gotAuth != "" {
		t.Errorf("no auth: %q", gotAuth)
	}
	manual := draft
	manual.Headers = []api.KeyValue{{Key: "Authorization", Value: "Manual", Enabled: true}}
	a.SendRequest("p1", "r1", manual, SendOptions{Auth: bearer})
	if gotAuth != "Manual" {
		t.Errorf("manual must win: %q", gotAuth)
	}
	if r := a.SendRequest("p1", "r1", draft, SendOptions{Auth: &api.Auth{Type: "oauth"}}); r.Error == nil {
		t.Error("unknown auth type must be refused")
	}
}

func TestSaveFolderSettingsOnePatch(t *testing.T) {
	var mu sync.Mutex
	var bodies []string
	a := newTestApp(t, true, map[string]http.HandlerFunc{
		"PATCH /api/v1/folders/{id}": func(w http.ResponseWriter, r *http.Request) {
			b, _ := io.ReadAll(r.Body)
			mu.Lock()
			bodies = append(bodies, string(b))
			mu.Unlock()
			_, _ = w.Write([]byte(`{"id":"f1","project_id":"p1","parent_id":null,"name":"api","follow_redirects":"off","sort_order":0,"created_at":"x"}`))
		},
	})
	base := api.Auth{Type: api.AuthInherit, BearerToken: "old", APIKeyIn: api.APIKeyInHeader}
	if r := a.SaveFolderSettings("f1", "inherit", "inherit", base, base); r.Error != nil || r.Data != nil || len(bodies) != 0 {
		t.Fatalf("nothing changed must send nothing: %+v %v", r, bodies)
	}
	edited := base
	edited.Type, edited.BearerToken = api.AuthBearer, "{{API_TOKEN}}"
	if r := a.SaveFolderSettings("f1", "inherit", "off", base, edited); r.Error != nil || r.Data == nil {
		t.Fatalf("save: %+v", r.Error)
	}
	var got map[string]any
	_ = json.Unmarshal([]byte(bodies[0]), &got)
	if len(bodies) != 1 || toJSON(t, got) != `{"auth":{"bearer_token":"{{API_TOKEN}}","type":"bearer"},"follow_redirects":"off"}` {
		t.Fatalf("bodies = %v", bodies)
	}
	if r := a.SaveFolderSettings("f1", "inherit", "inherit", base, api.Auth{Type: "x"}); r.Error == nil {
		t.Fatal("invalid auth must be refused")
	}
}

func TestSaveRequestPatchesAuthPartially(t *testing.T) {
	var body string
	a := newTestApp(t, true, map[string]http.HandlerFunc{
		"PATCH /api/v1/requests/{id}": func(w http.ResponseWriter, r *http.Request) {
			b, _ := io.ReadAll(r.Body)
			body = string(b)
			_, _ = w.Write([]byte(`{"id":"r1","project_id":"p1","name":"R","method":"GET","url":"u"}`))
		},
	})
	base := api.RequestDraft{Method: "GET", URL: "u", Body: api.RequestBody{Type: api.BodyNone},
		Auth: api.Auth{Type: api.AuthBearer, BearerToken: "{{T}}", BasicUsername: "kept"}}
	draft := base
	draft.Auth.Type = api.AuthBasic // mode switch: other fields untouched
	if r := a.SaveRequest("r1", base, draft); r.Error != nil {
		t.Fatal(r.Error.Message)
	}
	if body != `{"auth":{"type":"basic"}}` {
		t.Fatalf("patch = %s", body)
	}
}

func TestRestoreSetsEffectiveAuthExplicitly(t *testing.T) {
	target := bytesServer(t, 1)
	srv := &dupServer{}
	a := newTestApp(t, true, srv.routes())
	draft := api.RequestDraft{Method: "GET", URL: target.URL, Body: api.RequestBody{Type: api.BodyNone}}
	a.SendRequest("p1", "r1", draft, SendOptions{RequestName: "R", Auth: &api.Auth{Type: api.AuthBasic, BasicUsername: "u", BasicPassword: "{{P}}"}, AuthSource: "folder ‘api’"})
	if r := a.RestoreHistoryEntry(historyRows(t, a)[0].ID, "p1"); r.Error != nil {
		t.Fatal(r.Error.Message)
	}
	if got := toJSON(t, srv.patched["auth"]); got != `{"api_key_in":"header","api_key_name":"","api_key_value":"","basic_password":"{{P}}","basic_username":"u","bearer_token":"","type":"basic"}` {
		t.Fatalf("restored auth = %s", got)
	}
	if got := restoredAuth(sql.NullString{}); got.Type != api.AuthInherit {
		t.Fatalf("no auth -> inherit, got %+v", got)
	}
}
