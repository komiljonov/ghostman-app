package importer

import (
	"strings"
	"testing"

	"github.com/dop251/goja"
)

// The rb-market-analytics token-saving script (Auth > Register … Refresh): every
// line translates; no [postman] markers.
const tokenScript = `const j = pm.response.json();
if (j.tokens) {
  pm.collectionVariables.set('access_token', j.tokens.access);
  pm.collectionVariables.set('refresh_token', j.tokens.refresh);
  console.log('Saved access/refresh tokens');
}
if (j.otp_token) {
  pm.collectionVariables.set('otp_token', j.otp_token);
  console.log('Verification required: saved otp_token. Now call Auth > Verify with the code.');
}
if (j.reset_token) {
  pm.collectionVariables.set('reset_token', j.reset_token);
  console.log('Saved reset_token. Now call Auth > Reset password.');
}`

func TestTranslateTokenScriptFully(t *testing.T) {
	tr := TranslateScript(tokenScript)
	if tr.Commented != 0 || strings.Contains(tr.Text, "[postman]") || strings.Contains(tr.Text, "pm.") {
		t.Fatalf("expected a full translation:\n%s", tr.Text)
	}
	if tr.Translated != 5 {
		t.Fatalf("translated = %d", tr.Translated)
	}
	for _, want := range []string{
		headerScope,
		"const j = gm.response.json();",
		"  gm.environment.set('access_token', j.tokens.access);",
		"  gm.environment.set('reset_token', j.reset_token);",
		"  console.log('Saved access/refresh tokens');",
	} {
		if !strings.Contains(tr.Text, want) {
			t.Errorf("missing %q in\n%s", want, tr.Text)
		}
	}
}

// pm.test / pm.expect have no gm equivalent: the whole block stays as comments,
// the rest is translated, and the result still compiles.
func TestTranslateKeepsUnknownBlocksCommented(t *testing.T) {
	src := `pm.test("status is 200", function () {
    pm.response.to.have.status(200);
});
const body = pm.response.json();
pm.environment.set("id", body.id);
postman.setNextRequest("Next");`
	tr := TranslateScript(src)
	want := strings.Join([]string{
		headerMarkers,
		`// [postman] pm.test("status is 200", function () {`,
		`// [postman]     pm.response.to.have.status(200);`,
		`// [postman] });`,
		`const body = gm.response.json();`,
		`gm.environment.set("id", body.id);`,
		`// [postman] postman.setNextRequest("Next");`,
	}, "\n")
	if tr.Text != want || tr.Translated != 2 || tr.Commented != 4 {
		t.Fatalf("got (%d translated, %d commented):\n%s", tr.Translated, tr.Commented, tr.Text)
	}
}

func TestTranslateCryptoAndHeaders(t *testing.T) {
	cases := []struct{ in, out string }{
		{`const sig = CryptoJS.HmacSHA256(body + ts, pm.environment.get("SECRET")).toString();`,
			`const sig = gm.crypto.hmacSHA256(body + ts, gm.environment.get("SECRET"));`},
		{`const h = CryptoJS.SHA256(JSON.stringify({a: 1})).toString(CryptoJS.enc.Hex);`, `const h = gm.crypto.sha256(JSON.stringify({a: 1}));`},
		{`const m = CryptoJS.MD5("x").toString(), s1 = CryptoJS.HmacSHA1("d", "k").toString();`,
			`const m = gm.crypto.md5("x"), s1 = gm.crypto.hmacSHA1("d", "k");`},
		{`pm.request.headers.add({ key: "X-Signature", value: sig });`, `gm.request.headers.add("X-Signature", sig);`},
		{`pm.request.headers.upsert({key: 'X-Ts', value: String(Date.now())});`, `gm.request.headers.set('X-Ts', String(Date.now()));`},
		{`pm.request.headers.remove("X-Debug");`, `gm.request.headers.remove("X-Debug");`},
		{`if (pm.response.code !== 200) console.log(pm.response.responseTime);`, `if (gm.response.status !== 200) console.log(gm.response.durationMs);`},
		{`console.log("pm.test is not run here"); // pm.expect too`, `console.log("pm.test is not run here"); // pm.expect too`}, // strings / comments are not code
	}
	for _, c := range cases {
		tr := TranslateScript(c.in)
		if tr.Text != c.out || tr.Commented != 0 {
			t.Errorf("TranslateScript(%q)\n got %q (%d commented)\nwant %q", c.in, tr.Text, tr.Commented, c.out)
		}
	}
	// Base64 output is not the same value as gm.crypto's hex: kept as Postman code.
	tr := TranslateScript(`const b = CryptoJS.HmacSHA256("d", "k").toString(CryptoJS.enc.Base64);`)
	if tr.Commented != 1 || !strings.Contains(tr.Text, PostmanMarker+"const b = CryptoJS.HmacSHA256") {
		t.Fatalf("base64: %s", tr.Text)
	}
}

// A comment that would break the syntax (a dangling expression) → the whole
// script is kept commented instead of a script that cannot compile.
func TestTranslateUnsafeFallsBackToComments(t *testing.T) {
	tr := TranslateScript("const x =\n  pm.info.requestName;\nconsole.log(x);")
	if !strings.HasPrefix(tr.Text, headerUnsafe) || tr.Commented != 3 || tr.Translated != 0 {
		t.Fatalf("got:\n%s", tr.Text)
	}
	if _, err := goja.Compile("t", tr.Text, false); err != nil {
		t.Fatal(err)
	}
}
