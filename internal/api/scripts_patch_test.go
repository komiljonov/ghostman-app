package api

import "testing"

// Scripts ride the autosave: a changed script is in the patch, an unchanged one
// is not, and clearing one sends "".
func TestBuildRequestPatchScripts(t *testing.T) {
	base := RequestDraft{Method: "GET", URL: "https://x.io", PreScript: "a()", PostScript: "b()"}
	if _, changed := BuildRequestPatch(base, base); changed {
		t.Fatal("no change must give no patch")
	}
	next := base
	next.PreScript = `gm.request.headers.set("X", "1")`
	p, changed := BuildRequestPatch(base, next)
	if !changed || p.PreScript == nil || *p.PreScript != next.PreScript || p.PostScript != nil || p.URL != nil {
		t.Fatalf("pre only: %+v", p)
	}
	cleared := base
	cleared.PostScript = ""
	p, _ = BuildRequestPatch(base, cleared)
	if p.PostScript == nil || *p.PostScript != "" || p.PreScript != nil {
		t.Fatalf("clear: %+v", p)
	}
	// The stored request's scripts load into the draft.
	r := Request{PreScript: "x", PostScript: "y"}
	if d := r.Draft(); d.PreScript != "x" || d.PostScript != "y" {
		t.Fatalf("draft %+v", d)
	}
}
