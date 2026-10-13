package scripting

import (
	"context"
	"errors"
	"reflect"
	"sort"
	"strings"
	"testing"
	"time"

	"github.com/dop251/goja"

	"ghostman/internal/engine"
)

func spec() engine.RequestSpec {
	return engine.RequestSpec{
		Method: "POST", URL: "{{BASE}}/items",
		Headers:     []engine.Header{{Key: "Content-Type", Value: "application/json", Enabled: true}, {Key: "X-Old", Value: "1", Enabled: false}},
		QueryParams: []engine.Header{{Key: "page", Value: "1", Enabled: true}},
		Body:        engine.Body{Type: engine.BodyRaw, ContentType: "application/json", Content: `{"a":1}`},
	}
}

func env() *EnvState {
	return &EnvState{Name: "dev", Vars: map[string]string{"BASE": "https://x.test", "SECRET": "s3cr3t"}}
}

// run executes src as a script of the given phase; it returns the console text
// (one line per entry) and the error.
func run(t *testing.T, phase, src string, req *engine.RequestSpec, resp *Response, e *EnvState) (string, error) {
	t.Helper()
	if req == nil {
		s := spec()
		req = &s
	}
	if e == nil {
		e = env()
	}
	con := &Console{}
	err := Run(context.Background(), Script{Owner: "request 'Login'", Phase: phase, Source: src}, req, resp, e, con)
	var lines []string
	for _, en := range con.Entries {
		lines = append(lines, en.Level+": "+en.Text)
	}
	return strings.Join(lines, "\n"), err
}

func mustRun(t *testing.T, phase, src string, req *engine.RequestSpec, resp *Response, e *EnvState) string {
	t.Helper()
	out, err := run(t, phase, src, req, resp, e)
	if err != nil {
		t.Fatalf("%s: %v", src, err)
	}
	return out
}

func TestSandbox(t *testing.T) {
	out := mustRun(t, Pre, `
		console.log(typeof require, typeof fetch, typeof process, typeof XMLHttpRequest, typeof module, typeof exports);
		console.log(typeof globalThis.require, typeof globalThis.fetch, typeof globalThis.process, typeof setTimeout);
		console.log(Object.keys(globalThis).filter(k => !["gm", "console"].includes(k)).length);
		console.log(typeof (function(){ return this })().require);
		console.log(typeof Function("return this")().process);`, nil, nil, nil)
	want := "log: undefined undefined undefined undefined undefined undefined\n" +
		"log: undefined undefined undefined undefined\nlog: 0\nlog: undefined\nlog: undefined"
	if out != want {
		t.Fatalf("sandbox:\n%s", out)
	}
}

func TestFreshVMPerScript(t *testing.T) {
	mustRun(t, Pre, `globalThis.leak = 42; var also = 1; Object.prototype.polluted = true`, nil, nil, nil)
	if out := mustRun(t, Pre, `console.log(typeof leak, typeof also, ({}).polluted)`, nil, nil, nil); out != "log: undefined undefined undefined" {
		t.Fatalf("state leaked: %s", out)
	}
}

func TestEmptyScriptIsSkipped(t *testing.T) {
	con := &Console{}
	// nil request / env would panic if a VM were built: an empty script must not touch them.
	if err := Run(context.Background(), Script{Owner: "x", Phase: Pre, Source: "  \n\t"}, nil, nil, nil, con); err != nil {
		t.Fatal(err)
	}
}

func TestTimeout(t *testing.T) {
	start := time.Now()
	_, err := run(t, Pre, "while (true) {}", nil, nil, nil)
	took := time.Since(start)
	var se *ScriptError
	if !errors.As(err, &se) || se.Message != "script timed out after 2s" || err.Error() != "pre-script of request 'Login' failed: script timed out after 2s" {
		t.Fatalf("err %v", err)
	}
	if took < Budget || took > Budget+time.Second {
		t.Fatalf("took %v", took)
	}
}

func TestMemoryBudget(t *testing.T) {
	old := MemoryBudget
	MemoryBudget = 64 << 20
	defer func() { MemoryBudget = old }()
	start := time.Now()
	_, err := run(t, Pre, `const keep = []; while (true) { keep.push("x".repeat(1 << 20) + keep.length) }`, nil, nil, nil)
	if err == nil || !strings.Contains(err.Error(), "too much memory") || time.Since(start) > Budget {
		t.Fatalf("err %v after %v", err, time.Since(start))
	}
	// A string-doubling loop dies too (memory or time budget, whichever first).
	_, err = run(t, Pre, `let s = "x"; while (true) { s = s + s }`, nil, nil, nil)
	stopped := err != nil && (strings.Contains(err.Error(), "too much memory") || strings.Contains(err.Error(), "timed out") ||
		strings.Contains(err.Error(), "Invalid string length"))
	if !stopped {
		t.Fatalf("doubling: %v", err)
	}
}

func TestCancelledSendStopsTheScript(t *testing.T) {
	ctx, cancel := context.WithTimeout(context.Background(), 100*time.Millisecond)
	defer cancel()
	s := spec()
	err := Run(ctx, Script{Owner: "o", Phase: Pre, Source: "while(true){}"}, &s, nil, env(), &Console{})
	if err == nil || !strings.Contains(err.Error(), "cancelled") {
		t.Fatal(err)
	}
}

func TestErrorsNameTheOwnerAndLine(t *testing.T) {
	cases := []struct{ src, want string }{
		{"const a = 1;\nthrow new Error('boom')", "pre-script of request 'Login' failed: Error: boom (line 2)"},
		{"\n\npm.test('x', () => {})", "pre-script of request 'Login' failed: ReferenceError: pm is not defined (line 3)"},
		{"let = = 1", "pre-script of request 'Login' failed: SyntaxError:"},
		{"throw 'plain'", "pre-script of request 'Login' failed: plain (line 1)"},
		{"function f(){ f() }\nf()", "pre-script of request 'Login' failed: RangeError: Maximum call stack size exceeded"},
	}
	for _, c := range cases {
		_, err := run(t, Pre, c.src, nil, nil, nil)
		if err == nil || !strings.HasPrefix(err.Error(), c.want) {
			t.Fatalf("%q:\n got %v\nwant prefix %q", c.src, err, c.want)
		}
	}
	// Post-script phase and a folder owner.
	s := spec()
	err := Run(context.Background(), Script{Owner: "folder 'api v2'", Phase: Post, Source: "\nnull.x"}, &s, &Response{Status: 200}, env(), &Console{})
	if err == nil || !strings.HasPrefix(err.Error(), "post-script of folder 'api v2' failed: TypeError:") || !strings.Contains(err.Error(), "(line 2)") {
		t.Fatal(err)
	}
}

func TestEnvironmentAPI(t *testing.T) {
	e := env()
	out := mustRun(t, Pre, `
		console.log(gm.environment.name, gm.environment.get("BASE"), gm.environment.get("nope"));
		gm.environment.set("token", "abc");
		gm.environment.set("n", 42);
		console.log(gm.environment.get("token"), gm.environment.get("n"));
		gm.environment.unset("SECRET");
		console.log(gm.environment.get("SECRET"));`, nil, nil, e)
	if out != "log: dev https://x.test null\nlog: abc 42\nlog: null" {
		t.Fatalf("env:\n%s", out)
	}
	want := []EnvWrite{{Key: "token", Value: "abc"}, {Key: "n", Value: "42"}, {Key: "SECRET", Unset: true}}
	if !reflect.DeepEqual(e.Pending, want) || e.Vars["token"] != "abc" {
		t.Fatalf("pending %+v vars %v", e.Pending, e.Vars)
	}
	// No active environment: get → null, set / unset throw.
	none := &EnvState{Vars: map[string]string{}}
	if out := mustRun(t, Pre, `console.log(gm.environment.name, gm.environment.get("x"))`, nil, nil, none); out != "log: null null" {
		t.Fatal(out)
	}
	_, err := run(t, Pre, `gm.environment.set("token", "x")`, nil, nil, none)
	if err == nil || !strings.Contains(err.Error(), "no active environment") || len(none.Pending) != 0 {
		t.Fatalf("no env: %v", err)
	}
	if _, err := run(t, Pre, `gm.environment.set("x")`, nil, nil, nil); err == nil || !strings.Contains(err.Error(), "value is required") {
		t.Fatal(err)
	}
}

func TestRequestAPI(t *testing.T) {
	req := spec()
	out := mustRun(t, Pre, `
		console.log(gm.request.method, gm.request.url, gm.request.bodyType, gm.request.body.get());
		console.log(gm.request.headers.get("content-type"), gm.request.headers.get("X-Old"), gm.request.query.get("page"), gm.request.query.get("PAGE"));
		gm.request.method = "put";
		gm.request.url = gm.request.url + "/{{id}}";
		gm.request.headers.set("Content-Type", "text/plain");
		gm.request.headers.set("X-Sig", "abc");
		gm.request.headers.add("X-Sig", "def");
		gm.request.headers.remove("x-old");
		gm.request.query.set("page", "2");
		gm.request.query.add("tag", "a");
		gm.request.body.set("hello");
		console.log(gm.request.headers.all().length, JSON.stringify(gm.request.query.all()));`, &req, nil, nil)
	if out != `log: POST {{BASE}}/items raw {"a":1}`+"\nlog: application/json null 1 null\n"+`log: 3 [{"key":"page","value":"2"},{"key":"tag","value":"a"}]` {
		t.Fatalf("request:\n%s", out)
	}
	want := engine.RequestSpec{Method: "PUT", URL: "{{BASE}}/items/{{id}}",
		Headers: []engine.Header{{Key: "Content-Type", Value: "text/plain", Enabled: true}, {Key: "X-Sig", Value: "abc", Enabled: true},
			{Key: "X-Sig", Value: "def", Enabled: true}},
		QueryParams: []engine.Header{{Key: "page", Value: "2", Enabled: true}, {Key: "tag", Value: "a", Enabled: true}},
		Body:        engine.Body{Type: engine.BodyRaw, ContentType: "application/json", Content: "hello"}}
	if !reflect.DeepEqual(req, want) {
		t.Fatalf("mutated:\n got %+v\nwant %+v", req, want)
	}
	// A form body reads as urlencoded text; set() turns it into a raw body of that type.
	form := engine.RequestSpec{Body: engine.Body{Type: engine.BodyForm, Fields: []engine.Header{
		{Key: "a b", Value: "1&2", Enabled: true}, {Key: "off", Value: "x", Enabled: false}}}}
	if out := mustRun(t, Pre, `console.log(gm.request.body.get()); gm.request.body.set("z=1")`, &form, nil, nil); out != "log: a+b=1%262" ||
		form.Body.Type != engine.BodyRaw || form.Body.ContentType != "application/x-www-form-urlencoded" {
		t.Fatalf("form: %s %+v", out, form.Body)
	}
	// Post-scripts: reads work, every mutation throws.
	for _, src := range []string{`gm.request.url = "x"`, `gm.request.headers.set("a","b")`, `gm.request.query.remove("page")`, `gm.request.body.set("x")`, `gm.request.method = "GET"`} {
		post := spec()
		if _, err := run(t, Post, src, &post, &Response{}, nil); err == nil || !strings.Contains(err.Error(), "read-only in post-response scripts") {
			t.Fatalf("%s: %v", src, err)
		}
		if !reflect.DeepEqual(post, spec()) {
			t.Fatalf("%s changed the request", src)
		}
	}
	if out := mustRun(t, Post, `console.log(gm.request.url, gm.request.headers.get("Content-Type"))`, nil, &Response{}, nil); out != "log: {{BASE}}/items application/json" {
		t.Fatal(out)
	}
}

func TestResponseAPI(t *testing.T) {
	resp := &Response{Status: 201, DurationMs: 37, Headers: []engine.Header{{Key: "X-Rate", Value: "9"}},
		Body: []byte(`{"json":{"value":"tok-1"},"n":[1,2]}`)}
	out := mustRun(t, Post, `
		console.log(gm.response.status, gm.response.durationMs, gm.response.headers.get("x-rate"), gm.response.headers.get("nope"));
		console.log(gm.response.json().json.value, gm.response.text().length, gm.response.headers.all()[0].key);`, nil, resp, nil)
	if out != "log: 201 37 9 null\nlog: tok-1 36 X-Rate" {
		t.Fatalf("response:\n%s", out)
	}
	bad := &Response{Status: 200, Body: []byte("<html>")}
	if _, err := run(t, Post, `gm.response.json()`, nil, bad, nil); err == nil || !strings.Contains(err.Error(), "not valid JSON") {
		t.Fatal(err)
	}
	if _, err := run(t, Pre, `gm.response.status`, nil, nil, nil); err == nil || !strings.Contains(err.Error(), "only available in post-response") {
		t.Fatal(err)
	}
}

func TestCryptoVectors(t *testing.T) {
	out := mustRun(t, Pre, `
		console.log(gm.crypto.hmacSHA256("The quick brown fox jumps over the lazy dog", "key"));
		console.log(gm.crypto.hmacSHA1("The quick brown fox jumps over the lazy dog", "key"));
		console.log(gm.crypto.hmacSHA512("The quick brown fox jumps over the lazy dog", "key"));
		console.log(gm.crypto.sha256("abc"));
		console.log(gm.crypto.md5("The quick brown fox jumps over the lazy dog"));
		console.log(gm.crypto.base64Encode("hello world"), gm.crypto.base64Decode("aGVsbG8gd29ybGQ="), gm.crypto.base64Decode("aGk_"));
		console.log(/^[0-9a-f-]{36}$/.test(gm.crypto.uuid()), gm.crypto.randomHex(16).length, Math.abs(gm.crypto.timestamp() - Date.now()/1000) < 5);`,
		nil, nil, nil)
	want := strings.Join([]string{
		"log: f7bc83f430538424b13298e6aa6fb143ef4d59a14946175997479dbc2d1a3cd8",
		"log: de7c9b85b8b78aa6bc8a7a36f70a90701c9db4d9",
		"log: b42af09057bac1e2d41708e48a902e09b5ff7f12ab428a4fe86653c73dd248fb82f948a549f7b791a5b41915ee4d1ec3935357e4e2317250d0372afa2ebeeb3a",
		"log: ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad",
		"log: 9e107d9d372bb6826bd81d3542a419d6",
		"log: aGVsbG8gd29ybGQ= hello world hi?",
		"log: true 32 true",
	}, "\n")
	if out != want {
		t.Fatalf("crypto:\n%s", out)
	}
	if _, err := run(t, Pre, `gm.crypto.randomHex(0)`, nil, nil, nil); err == nil {
		t.Fatal("randomHex(0) must throw")
	}
	if _, err := run(t, Pre, `gm.crypto.base64Decode("%%%")`, nil, nil, nil); err == nil {
		t.Fatal("bad base64 must throw")
	}
}

func TestConsole(t *testing.T) {
	out := mustRun(t, Pre, `
		console.log("a", 1, true, null, undefined, {x: [1, "y"]});
		gm.console.warn("careful"); console.error(new Error("bad")); console.info(function(){});
		const cyc = {}; cyc.self = cyc; console.log(cyc);`, nil, nil, nil)
	want := "log: a 1 true null undefined {\n  \"x\": [\n    1,\n    \"y\"\n  ]\n}\nwarn: careful\nerror: Error: bad\nlog: [Function]\nlog: [unprintable: TypeError"
	if !strings.HasPrefix(out, want) {
		t.Fatalf("console:\n%s", out)
	}
	// Capped: a logging loop cannot grow the console without bound.
	con := &Console{}
	s := spec()
	_ = Run(context.Background(), Script{Owner: "o", Phase: Pre, Source: `for (let i = 0; i < 2000; i++) console.log("x".repeat(20000))`}, &s, nil, env(), con)
	if len(con.Entries) != maxEntries || !con.Truncated || len([]rune(con.Entries[0].Text)) > maxEntryLength+10 {
		t.Fatalf("entries %d truncated %v", len(con.Entries), con.Truncated)
	}
}

// Every documented member exists in the VM, and every gm member is documented.
func TestDocsMatchTheAPI(t *testing.T) {
	vm := goja.New()
	s := spec()
	if err := install(vm, Script{Owner: "o", Phase: Post}, &s, &Response{}, env(), &Console{}); err != nil {
		t.Fatal(err)
	}
	var walk func(prefix string, o *goja.Object, out *[]string)
	walk = func(prefix string, o *goja.Object, out *[]string) {
		for _, k := range o.Keys() {
			path := prefix + "." + k
			v := o.Get(k)
			if obj, ok := v.(*goja.Object); ok {
				if _, isFn := goja.AssertFunction(v); !isFn {
					walk(path, obj, out)
					continue
				}
			}
			*out = append(*out, path)
		}
	}
	var actual []string
	walk("gm", vm.Get("gm").ToObject(vm), &actual)
	var documented []string
	for _, d := range APIDocs {
		documented = append(documented, d.Name)
	}
	sort.Strings(actual)
	sort.Strings(documented)
	if !reflect.DeepEqual(actual, documented) {
		t.Fatalf("API and docs differ:\n api  %v\n docs %v", actual, documented)
	}
}
