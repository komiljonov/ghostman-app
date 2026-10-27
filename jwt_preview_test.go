package main

import (
	"bytes"
	"io"
	"log/slog"
	"net/http"
	"net/http/httptest"
	"strings"
	"sync"
	"testing"
	"time"

	"github.com/golang-jwt/jwt/v5"

	"ghostman/internal/api"
)

const jwtTestSecret = "jwt-signing-key-42"

// jwtApp: authEnvApp plus a JWT_SECRET secret with a local value and a regular
// user_id; every request to the fake server is recorded (URL + body).
func jwtApp(t *testing.T, target string) (*App, func() string) {
	t.Helper()
	var mu sync.Mutex
	var seen strings.Builder
	record := func(h http.HandlerFunc) http.HandlerFunc {
		return func(w http.ResponseWriter, r *http.Request) {
			b, _ := io.ReadAll(r.Body)
			mu.Lock()
			seen.WriteString(r.Method + " " + r.URL.String() + " " + r.Header.Get("Authorization") + " " + string(b) + "\n")
			mu.Unlock()
			h(w, r)
		}
	}
	routes := map[string]http.HandlerFunc{
		"GET /api/v1/projects/{project_id}/environments": record(func(w http.ResponseWriter, _ *http.Request) {
			_, _ = w.Write([]byte(`[{"id":"dev","name":"dev","sort_order":0,"created_at":"x"}]`))
		}),
		"GET /api/v1/environments/{env_id}/variables": record(func(w http.ResponseWriter, _ *http.Request) {
			_, _ = w.Write([]byte(`[{"id":"v1","key":"BASE_URL","type":"regular","value":"` + target + `","sort_order":0},
				{"id":"v2","key":"JWT_SECRET","type":"secret","value":null,"sort_order":1},
				{"id":"v3","key":"user_id","type":"regular","value":"u-7","sort_order":2},
				{"id":"v4","key":"NO_VALUE","type":"secret","value":null,"sort_order":3}]`))
		}),
	}
	a := newTestApp(t, true, routes)
	if err := a.store.PutSecret(a.ctx, "dev", "JWT_SECRET", jwtTestSecret); err != nil {
		t.Fatal(err)
	}
	if r := a.SetActiveEnvironment("p1", "dev"); r.Error != nil {
		t.Fatal(r.Error.Message)
	}
	return a, func() string {
		mu.Lock()
		defer mu.Unlock()
		return seen.String()
	}
}

var folderJWT = &api.Auth{Type: api.AuthJWT, JWTAlgorithm: "HS256", JWTSecret: "{{JWT_SECRET}}",
	JWTPayload: `{"sub":"{{user_id}}","iat":"{{$now}}","exp":"{{$now+3600}}","note":"{{nope}}"}`}

func TestSendSignsJWTAndTheSecretGoesNowhere(t *testing.T) {
	var logs bytes.Buffer
	prev := slog.Default()
	slog.SetDefault(slog.New(slog.NewTextHandler(&logs, &slog.HandlerOptions{Level: slog.LevelDebug})))
	defer slog.SetDefault(prev)

	var gotAuth, gotQuery string
	target := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		gotAuth, gotQuery = r.Header.Get("Authorization"), r.URL.RawQuery
		_, _ = w.Write([]byte(`{"ok":true}`))
	}))
	defer target.Close()
	a, seen := jwtApp(t, target.URL)
	draft := api.RequestDraft{Method: "GET", URL: "{{BASE_URL}}/headers", Body: api.RequestBody{Type: api.BodyNone}}

	before := time.Now().Unix()
	res := a.SendRequest("p1", "r1", draft, SendOptions{Auth: folderJWT, AuthSource: "folder ‘api’", RequestName: "R"})
	if res.Error != nil || toJSON(t, res.Unresolved) != `["nope"]` {
		t.Fatalf("send: %s", toJSON(t, res))
	}
	raw, ok := strings.CutPrefix(gotAuth, "Bearer ")
	if !ok {
		t.Fatalf("Authorization = %q", gotAuth)
	}
	tok, err := jwt.Parse(raw, func(*jwt.Token) (any, error) { return []byte(jwtTestSecret), nil })
	if err != nil {
		t.Fatalf("verify: %v", err)
	}
	c := tok.Claims.(jwt.MapClaims)
	exp, _ := c["exp"].(float64)
	if c["sub"] != "u-7" || c["note"] != "{{nope}}" || int64(exp) < before+3600 || int64(exp) > time.Now().Unix()+3600 {
		t.Fatalf("claims = %v", c)
	}

	// History: the token is in the as-sent copy; the template keeps the config.
	e := a.GetHistoryEntry(historyRows(t, a)[0].ID).Data
	if !strings.Contains(toJSON(t, e.Resolved.Headers), raw) || e.Auth == nil || e.Auth.JWTSecret != "{{JWT_SECRET}}" || e.Auth.Type != api.AuthJWT {
		t.Fatalf("history = %s", toJSON(t, e))
	}

	// Query placement with a custom name.
	q := *folderJWT
	q.JWTAddTo, q.JWTName = api.APIKeyInQuery, "access_token"
	if r := a.SendRequest("p1", "r1", draft, SendOptions{Auth: &q}); r.Error != nil || !strings.HasPrefix(gotQuery, "access_token=ey") || gotAuth != "" {
		t.Fatalf("query: %q %q %v", gotQuery, gotAuth, r.Error)
	}
	// A user-written Authorization header wins.
	manual := draft
	manual.Headers = []api.KeyValue{{Key: "Authorization", Value: "Mine", Enabled: true}}
	if a.SendRequest("p1", "r1", manual, SendOptions{Auth: folderJWT}); gotAuth != "Mine" {
		t.Fatalf("user header must win: %q", gotAuth)
	}

	// The secret has no value on this machine → abort naming it, nothing sent.
	gotAuth = "untouched"
	noValue := *folderJWT
	noValue.JWTSecret = "{{NO_VALUE}}"
	r := a.SendRequest("p1", "r1", draft, SendOptions{Auth: &noValue})
	if r.Error == nil || !strings.Contains(r.Error.Message, "{{NO_VALUE}}") || gotAuth != "untouched" {
		t.Fatalf("abort: %+v (sent %q)", r.Error, gotAuth)
	}
	if h := historyRows(t, a)[0]; h.Error == "" || !strings.Contains(h.Error, "NO_VALUE") {
		t.Fatalf("aborted send in history: %q", h.Error)
	}

	// The preview: claims resolved, no secret.
	pv := a.PreviewJWT("p1", *folderJWT)
	if pv.Error != nil || !strings.Contains(pv.Data.Payload, `"sub": "u-7"`) || len(pv.Data.TokenHead) != 8 || toJSON(t, pv.Data.Unresolved) != `["nope"]` {
		t.Fatalf("preview = %s", toJSON(t, pv))
	}
	if pe := a.PreviewJWT("p1", noValue); pe.Error == nil || !strings.Contains(pe.Error.Message, "NO_VALUE") {
		t.Fatalf("preview abort = %s", toJSON(t, pe))
	}

	// The resolved secret appears nowhere: not at the server, not in any result,
	// not in history (list + every entry), not in the log.
	var everywhere strings.Builder
	everywhere.WriteString(seen() + logs.String() + toJSON(t, res) + toJSON(t, pv) + toJSON(t, r))
	for _, row := range historyRows(t, a) {
		everywhere.WriteString(toJSON(t, row) + toJSON(t, a.GetHistoryEntry(row.ID)))
	}
	if strings.Contains(everywhere.String(), jwtTestSecret) {
		t.Fatal("the resolved JWT secret leaked")
	}
	if !strings.Contains(seen(), "/variables") {
		t.Fatal("the recorder saw nothing")
	}
}
