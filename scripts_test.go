package main

import (
	"crypto/hmac"
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"fmt"
	"io"
	"net/http"
	"net/http/httptest"
	"strings"
	"sync"
	"testing"

	"ghostman/internal/api"
)

// scriptWorld: project p1, active env "dev" with BASE_URL (regular, the echo
// target) and SECRET / API_TOKEN (secrets, local values). The fake server keeps
// variables in memory and records EVERY server-bound request (method, path,
// body), so tests can prove a secret never left this machine.
type scriptWorld struct {
	a      *App
	mu     sync.Mutex
	vars   []map[string]any
	server []string // "METHOD /path body"
	echo   struct {
		method, path, query, body string
		headers                   http.Header
		hits                      int
	}
}

func newScriptWorld(t *testing.T) *scriptWorld {
	t.Helper()
	w := &scriptWorld{}
	target := httptest.NewServer(http.HandlerFunc(func(rw http.ResponseWriter, r *http.Request) {
		b, _ := io.ReadAll(r.Body)
		w.mu.Lock()
		w.echo.method, w.echo.path, w.echo.query, w.echo.body, w.echo.headers = r.Method, r.URL.Path, r.URL.RawQuery, string(b), r.Header.Clone()
		w.echo.hits++
		w.mu.Unlock()
		rw.Header().Set("Content-Type", "application/json")
		_ = json.NewEncoder(rw).Encode(map[string]any{"json": map[string]any{"value": "tok-from-login"}, "path": r.URL.Path})
	}))
	t.Cleanup(target.Close)
	w.vars = []map[string]any{
		{"id": "v1", "key": "BASE_URL", "type": "regular", "value": target.URL, "sort_order": 0},
		{"id": "v2", "key": "SECRET", "type": "secret", "value": nil, "sort_order": 1},
		{"id": "v3", "key": "API_TOKEN", "type": "secret", "value": nil, "sort_order": 2},
	}
	record := func(r *http.Request) []byte {
		b, _ := io.ReadAll(r.Body)
		w.mu.Lock()
		w.server = append(w.server, r.Method+" "+r.URL.Path+" "+string(b))
		w.mu.Unlock()
		return b
	}
	routes := map[string]http.HandlerFunc{
		"GET /api/v1/projects/{project_id}/environments": func(rw http.ResponseWriter, r *http.Request) {
			record(r)
			_, _ = rw.Write([]byte(`[{"id":"dev","name":"dev","sort_order":0,"created_at":"x"}]`))
		},
		"GET /api/v1/environments/{env_id}/variables": func(rw http.ResponseWriter, r *http.Request) {
			record(r)
			w.mu.Lock()
			defer w.mu.Unlock()
			_ = json.NewEncoder(rw).Encode(w.vars)
		},
		"POST /api/v1/environments/{env_id}/variables": func(rw http.ResponseWriter, r *http.Request) {
			var in map[string]any
			_ = json.Unmarshal(record(r), &in)
			w.mu.Lock()
			defer w.mu.Unlock()
			v := map[string]any{"id": fmt.Sprintf("v%d", len(w.vars)+1), "key": in["key"], "type": in["type"], "value": nil, "sort_order": len(w.vars)}
			w.vars = append(w.vars, v)
			_ = json.NewEncoder(rw).Encode(v)
		},
		"PATCH /api/v1/variables/{id}": func(rw http.ResponseWriter, r *http.Request) {
			var in map[string]any
			_ = json.Unmarshal(record(r), &in)
			w.mu.Lock()
			defer w.mu.Unlock()
			for _, v := range w.vars {
				if v["id"] == r.PathValue("id") {
					if val, ok := in["value"]; ok {
						v["value"] = val
					}
					_ = json.NewEncoder(rw).Encode(v)
					return
				}
			}
			rw.WriteHeader(http.StatusNotFound)
		},
	}
	w.a = newTestApp(t, true, routes)
	for k, v := range map[string]string{"SECRET": "s3cr3t-key", "API_TOKEN": "old-token"} {
		if err := w.a.store.PutSecret(w.a.ctx, "dev", k, v); err != nil {
			t.Fatal(err)
		}
	}
	if r := w.a.SetActiveEnvironment("p1", "dev"); r.Error != nil {
		t.Fatal(r.Error.Message)
	}
	w.mu.Lock()
	w.server = nil
	w.mu.Unlock()
	return w
}

func (w *scriptWorld) serverTraffic() string {
	w.mu.Lock()
	defer w.mu.Unlock()
	return strings.Join(w.server, "\n")
}

func (w *scriptWorld) varValue(key string) any {
	w.mu.Lock()
	defer w.mu.Unlock()
	for _, v := range w.vars {
		if v["key"] == key {
			return v["value"]
		}
	}
	return "<missing>"
}

func consoleText(r SendResult) string {
	var lines []string
	for _, e := range r.Console.Entries {
		lines = append(lines, e.Phase+" "+e.Owner+" "+e.Level+": "+e.Text)
	}
	return strings.Join(lines, "\n")
}

func baseDraft() api.RequestDraft {
	return api.RequestDraft{Method: "POST", URL: "{{BASE_URL}}/anything",
		Headers: []api.KeyValue{{Key: "Content-Type", Value: "application/json", Enabled: true}},
		Body:    api.RequestBody{Type: api.BodyRaw, ContentType: "application/json", Content: `{"amount":42}`}}
}

func TestScriptOrderOuterFoldersFirstForPreAndPost(t *testing.T) {
	w := newScriptWorld(t)
	draft := baseDraft()
	draft.PreScript, draft.PostScript = `console.log("pre request")`, `console.log("post request")`
	folders := []ScriptFolder{
		{Name: "outer", PreScript: `console.log("pre outer")`, PostScript: `console.log("post outer")`},
		{Name: "empty"},
		{Name: "inner", PreScript: `console.log("pre inner")`, PostScript: `console.log("post inner")`},
	}
	res := w.a.SendRequest("p1", "r1", draft, SendOptions{RequestName: "Login", Folders: folders})
	want := strings.Join([]string{
		"pre folder 'outer' log: pre outer", "pre folder 'inner' log: pre inner", "pre request 'Login' log: pre request",
		"post folder 'outer' log: post outer", "post folder 'inner' log: post inner", "post request 'Login' log: post request",
	}, "\n")
	if res.Error != nil || consoleText(res) != want {
		t.Fatalf("order:\n%s\n%v", consoleText(res), res.Error)
	}
}

// The token / signature use case: a pre-script's gm.environment.set resolves in
// THIS send, because pre-scripts run before {{var}} resolution.
func TestPreScriptEnvSetResolvesInTheSameSend(t *testing.T) {
	w := newScriptWorld(t)
	draft := baseDraft()
	draft.Headers = append(draft.Headers, api.KeyValue{Key: "X-Nonce", Value: "{{nonce}}", Enabled: true})
	draft.PreScript = `gm.environment.set("nonce", "n-123")`
	res := w.a.SendRequest("p1", "r1", draft, SendOptions{RequestName: "Login"})
	if res.Error != nil || w.echo.headers.Get("X-Nonce") != "n-123" || len(res.Unresolved) != 0 {
		t.Fatalf("nonce %q unresolved %v err %v", w.echo.headers.Get("X-Nonce"), res.Unresolved, res.Error)
	}
	// It was created as a regular variable on the server.
	if w.varValue("nonce") != "n-123" {
		t.Fatalf("server value %v", w.varValue("nonce"))
	}
}

// Mutations reach the wire; the saved request (and the draft passed in) is untouched.
func TestPreScriptMutationsReachTheWireOnly(t *testing.T) {
	w := newScriptWorld(t)
	draft := baseDraft()
	draft.PreScript = `
		gm.request.method = "PUT";
		gm.request.url = gm.request.url + "/v2";
		gm.request.headers.set("X-Added", "yes");
		gm.request.query.set("q", "{{BASE_URL}}".length ? "1" : "0");
		gm.request.body.set(JSON.stringify({ amount: 43 }));`
	before := toJSON(t, draft)
	res := w.a.SendRequest("p1", "r1", draft, SendOptions{RequestName: "Edit"})
	if res.Error != nil || w.echo.method != "PUT" || w.echo.path != "/anything/v2" || w.echo.headers.Get("X-Added") != "yes" ||
		w.echo.query != "q=1" || w.echo.body != `{"amount":43}` {
		t.Fatalf("wire: %s %s?%s %q %v", w.echo.method, w.echo.path, w.echo.query, w.echo.body, res.Error)
	}
	if toJSON(t, draft) != before {
		t.Fatal("the draft was modified")
	}
	if strings.Contains(w.serverTraffic(), "/requests") {
		t.Fatalf("a send never writes the request: %s", w.serverTraffic())
	}
	// History: the resolved copy is AS SENT, the template copy the stored request.
	e := w.a.GetHistoryEntry(historyRows(t, w.a)[0].ID).Data
	if e.Summary.Method != http.MethodPut || !strings.HasSuffix(e.Resolved.URL, "/anything/v2?q=1") || e.Template.Body != `{"amount":42}` ||
		e.Console != nil {
		t.Fatalf("history: %s %s template body %q console %+v", e.Summary.Method, e.Resolved.URL, e.Template.Body, e.Console)
	}
	if h := toJSON(t, e.Resolved.Headers); !strings.Contains(h, "X-Added") {
		t.Fatalf("history headers %s", h)
	}
}

// A secret set by a script lands on this machine only.
func TestSecretSetStaysLocal(t *testing.T) {
	w := newScriptWorld(t)
	draft := baseDraft()
	draft.Headers = append(draft.Headers, api.KeyValue{Key: "Authorization", Value: "Bearer {{API_TOKEN}}", Enabled: true})
	draft.PreScript = `gm.environment.set("API_TOKEN", "fresh-secret-777")`
	res := w.a.SendRequest("p1", "r1", draft, SendOptions{RequestName: "Login"})
	if res.Error != nil || w.echo.headers.Get("Authorization") != "Bearer fresh-secret-777" {
		t.Fatalf("auth %q err %v", w.echo.headers.Get("Authorization"), res.Error)
	}
	if v, _, _ := w.a.store.Secret(w.a.ctx, "dev", "API_TOKEN"); v != "fresh-secret-777" {
		t.Fatalf("local secret %q", v)
	}
	if traffic := w.serverTraffic(); strings.Contains(traffic, "fresh-secret-777") || strings.Contains(traffic, "s3cr3t-key") {
		t.Fatalf("a secret reached the server:\n%s", traffic)
	}
	for _, h := range res.Hops {
		if strings.Contains(h.URL, "fresh-secret-777") {
			t.Fatal("the new secret is not masked in the hop URLs")
		}
	}
}

func TestFolderSignatureScript(t *testing.T) {
	w := newScriptWorld(t)
	folders := []ScriptFolder{{Name: "api v2", PreScript: `
		const sig = gm.crypto.hmacSHA256(gm.request.body.get(), gm.environment.get("SECRET"));
		gm.request.headers.set("X-Signature", sig);`}}
	res := w.a.SendRequest("p1", "r1", baseDraft(), SendOptions{RequestName: "Pay", Folders: folders})
	m := hmac.New(sha256.New, []byte("s3cr3t-key"))
	m.Write([]byte(`{"amount":42}`))
	if res.Error != nil || w.echo.headers.Get("X-Signature") != hex.EncodeToString(m.Sum(nil)) {
		t.Fatalf("signature %q err %v", w.echo.headers.Get("X-Signature"), res.Error)
	}
	if strings.Contains(w.serverTraffic(), "s3cr3t-key") {
		t.Fatal("SECRET reached the server")
	}
}

func TestPostScriptTokenChaining(t *testing.T) {
	w := newScriptWorld(t)
	login := baseDraft()
	login.PostScript = `gm.environment.set("token", gm.response.json().json.value)`
	if res := w.a.SendRequest("p1", "r1", login, SendOptions{RequestName: "Login"}); res.Error != nil || res.Console.HasErrors() {
		t.Fatalf("login: %v %s", res.Error, consoleText(res))
	}
	if w.varValue("token") != "tok-from-login" {
		t.Fatalf("token %v", w.varValue("token"))
	}
	next := baseDraft()
	next.Headers = append(next.Headers, api.KeyValue{Key: "Authorization", Value: "Bearer {{token}}", Enabled: true})
	if res := w.a.SendRequest("p1", "r2", next, SendOptions{RequestName: "Me"}); res.Error != nil ||
		w.echo.headers.Get("Authorization") != "Bearer tok-from-login" {
		t.Fatalf("chained: %q %v", w.echo.headers.Get("Authorization"), res.Error)
	}
}

func TestPreScriptFailureAbortsTheSend(t *testing.T) {
	w := newScriptWorld(t)
	draft := baseDraft()
	draft.PreScript = "console.log('before');\nthrow new Error('no token')"
	res := w.a.SendRequest("p1", "r1", draft, SendOptions{RequestName: "Login"})
	if res.Error == nil || res.Error.Message != "pre-script of request 'Login' failed: Error: no token (line 2)" || res.Data != nil {
		t.Fatalf("err %+v", res.Error)
	}
	if w.echo.hits != 0 {
		t.Fatal("the request was sent")
	}
	if consoleText(res) != "pre request 'Login' log: before\npre request 'Login' error: pre-script of request 'Login' failed: Error: no token (line 2)" {
		t.Fatalf("console:\n%s", consoleText(res))
	}
	// A folder's failing script names the folder; later scripts do not run.
	res = w.a.SendRequest("p1", "r1", baseDraft(), SendOptions{RequestName: "Login", Folders: []ScriptFolder{
		{Name: "api v2", PreScript: "\n\npm.test('x', () => {})"}, {Name: "inner", PreScript: "console.log('never')"}}})
	if res.Error == nil || res.Error.Message != "pre-script of folder 'api v2' failed: ReferenceError: pm is not defined (line 3)" ||
		strings.Contains(consoleText(res), "never") {
		t.Fatalf("folder: %+v\n%s", res.Error, consoleText(res))
	}
	// History records the aborted send with its console.
	e := w.a.GetHistoryEntry(historyRows(t, w.a)[0].ID).Data
	if e.Summary.Error == "" || e.Console == nil || len(e.Console.Entries) != 1 || e.Response != nil {
		t.Fatalf("history: %+v", e.Summary)
	}
}

func TestPostScriptFailureKeepsTheResponse(t *testing.T) {
	w := newScriptWorld(t)
	draft := baseDraft()
	draft.PostScript = "const x = gm.response.json();\nx.missing.deeper"
	res := w.a.SendRequest("p1", "r1", draft, SendOptions{RequestName: "Login"})
	if res.Error != nil || res.Data == nil || res.Data.Status != 200 || !res.Console.HasErrors() ||
		!strings.Contains(consoleText(res), "post-script of request 'Login' failed: TypeError") || !strings.Contains(consoleText(res), "(line 2)") {
		t.Fatalf("res %+v\n%s", res.Error, consoleText(res))
	}
}

func TestNoActiveEnvironmentSetThrows(t *testing.T) {
	w := newScriptWorld(t)
	if r := w.a.SetActiveEnvironment("p1", ""); r.Error != nil {
		t.Fatal(r.Error.Message)
	}
	draft := baseDraft()
	draft.URL = "http://127.0.0.1:1/x"
	draft.PreScript = `gm.environment.set("token", "x")`
	res := w.a.SendRequest("p1", "r1", draft, SendOptions{RequestName: "Login"})
	if res.Error == nil || !strings.Contains(res.Error.Message, "no active environment") {
		t.Fatalf("%+v", res.Error)
	}
}

func TestPostScriptsSkippedWhenTheSendFails(t *testing.T) {
	w := newScriptWorld(t)
	draft := baseDraft()
	draft.URL = "http://127.0.0.1:1/x"
	draft.PostScript = `console.log("never")`
	res := w.a.SendRequest("p1", "r1", draft, SendOptions{RequestName: "Login"})
	if res.Error == nil || consoleText(res) != "post request 'Login' error: post-response scripts skipped: the send failed" {
		t.Fatalf("%+v\n%s", res.Error, consoleText(res))
	}
}

func TestScriptAPIDocsBound(t *testing.T) {
	a := &App{}
	docs := a.GetScriptAPIDocs()
	if len(docs) < 30 || docs[0].Name != "gm.environment.get" {
		t.Fatalf("%d docs", len(docs))
	}
}
