package importer

import (
	"strings"
	"testing"
)

// The rb-market-analytics shapes: url.variable entries that are {{references}}
// become those references with NO report entry; scripts are translated into the
// request's own pre / post scripts.
func analyticsPlan(t *testing.T) *CollectionPlan {
	t.Helper()
	p, err := PlanCollection(fixture(t, "analytics.postman_collection.json"), "analytics.json", nil)
	if err != nil {
		t.Fatal(err)
	}
	return p
}

func TestImportPathVariablesBecomeVars(t *testing.T) {
	p := analyticsPlan(t)
	reqs := allRequests(p.Root, nil)
	for path, want := range map[string]string{
		"rb analytics / Products / Get Prices":     "{{base_url}}/api/v1/products/{{product_id}}/prices",
		"rb analytics / Products / Seller Product": "https://api.example.com:8443/api/v1/sellers/{{seller_id}}/products/{{sku}}",
		"rb analytics / Products / Fixed id":       "{{base_url}}/api/v1/products/{{product_id}}",
	} {
		if got := reqs[path].Draft.URL; got != want {
			t.Errorf("%s: url %q, want %q", path, got, want)
		}
	}
	var pathEntries []Entry
	for _, e := range entries(p.Report) {
		if e.Code == CodeURLPathVariable {
			pathEntries = append(pathEntries, e)
		}
	}
	// Only the LITERAL value is reported; {{references}} are silent.
	if len(pathEntries) != 1 || pathEntries[0].Path != "rb analytics / Products / Fixed id" || pathEntries[0].Severity != Warning ||
		pathEntries[0].Message != "path variable 'product_id' had value '123'; URL now uses {{product_id}} — set it in an environment (Add missing variables helps)." {
		t.Fatalf("path entries: %+v", pathEntries)
	}
	// :sku had no value: ONE info line for all such.
	if len(p.Report.Notes) != 1 || p.Report.Notes[0] != "1 path variable without a value became {{variables}} — create them via Add missing variables in an environment tab." {
		t.Fatalf("notes %q", p.Report.Notes)
	}
}

func TestImportScriptsTranslated(t *testing.T) {
	p := analyticsPlan(t)
	reqs := allRequests(p.Root, nil)
	login := reqs["rb analytics / Auth / Login"].Draft
	if login.PreScript != "" || strings.Contains(login.PostScript, "[postman]") || strings.Contains(login.PostScript, "pm.") ||
		!strings.Contains(login.PostScript, "gm.environment.set('access_token', j.tokens.access);") {
		t.Fatalf("login post-script:\n%s", login.PostScript)
	}
	signed := reqs["rb analytics / Auth / Signed"].Draft
	for _, want := range []string{
		"const sig = gm.crypto.hmacSHA256(ts, gm.environment.get('b2b_api_key'));",
		"gm.request.headers.add('X-Signature', sig);",
		"gm.request.headers.set('X-Ts', ts);",
	} {
		if !strings.Contains(signed.PreScript, want) {
			t.Errorf("signed pre-script lacks %q:\n%s", want, signed.PreScript)
		}
	}
	if strings.Contains(signed.PreScript, "[postman]") {
		t.Errorf("signed pre-script should translate fully:\n%s", signed.PreScript)
	}
	if !strings.Contains(signed.PostScript, "// [postman] pm.test('status is 200', function () {") ||
		!strings.Contains(signed.PostScript, "// [postman] });") || !strings.Contains(signed.PostScript, "console.log(gm.response.status);") {
		t.Fatalf("signed post-script:\n%s", signed.PostScript)
	}
	old := reqs["rb analytics / Auth / Old hooks"].Draft
	if old.PreScript != "" || old.PostScript != "" {
		t.Fatal("scripts disabled in Postman are not imported")
	}

	byPathMsg := map[string]Entry{}
	for _, e := range entries(p.Report) {
		byPathMsg[e.Path+"|"+e.Code+"|"+strings.SplitN(e.Message, " ", 2)[0]] = e
	}
	if e := byPathMsg["rb analytics / Auth / Login|"+CodeScriptImported+"|post-response"]; e.Severity != Imported ||
		e.Message != "post-response script imported: 5 lines translated to gm.*" || !strings.Contains(e.Detail, "pm.collectionVariables") {
		t.Fatalf("login entry: %+v", e)
	}
	if e := byPathMsg["rb analytics / Auth / Signed|"+CodeScriptPartial+"|post-response"]; e.Severity != Warning ||
		e.Message != "post-response script imported: 1 translated, 3 as [postman] comments" {
		t.Fatalf("signed entry: %+v", e)
	}
	if e := byPathMsg["rb analytics / Auth / Old hooks|"+CodeScriptPreRequest+"|pre-request"]; e.Severity != Dropped ||
		!strings.Contains(e.Message, "disabled in Postman") || e.Detail != "pm.environment.set('x', 1);" {
		t.Fatalf("disabled entry: %+v", e)
	}
	// Collection variables stay dropped (values kept in the report) and point at the button.
	if e := byPathMsg["rb analytics|"+CodeCollectionVars+"|2"]; e.Severity != Dropped ||
		!strings.Contains(e.Action, "Add missing variables") || e.Detail != "access_token = \nrefresh_token = " {
		t.Fatalf("collection vars: %+v", e)
	}
	// The executor sends the scripts with the request's contents PATCH.
	patch, ok := contentsPatch(reqs["rb analytics / Auth / Login"])
	if !ok || patch.PostScript == nil || *patch.PostScript != login.PostScript || patch.PreScript != nil {
		t.Fatalf("contents patch: %+v", patch)
	}
}
