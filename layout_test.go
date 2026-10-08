package main

import (
	"encoding/json"
	"testing"
)

func TestLayoutPerUserAndProject(t *testing.T) {
	a := newTestApp(t, true, nil) // logged in as u1 (see newTestApp)
	if got := a.GetLayout("p1"); got != "" {
		t.Fatalf("nothing stored: %q", got)
	}
	doc := `{"version":1,"layout":{"root":{"type":"split","id":"s","direction":"horizontal","sizes":[0.5,0.5],"children":[` +
		`{"type":"group","id":"A","tabs":["request:r1","history:"],"activeTabId":"request:r1"},` +
		`{"type":"group","id":"B","tabs":["request:r2"],"activeTabId":"request:r2"}]},"focusedGroupId":"B"}}`
	if r := a.SetLayout("p1", doc); r.Error != nil {
		t.Fatal(r.Error.Message)
	}
	if got := a.GetLayout("p1"); got != doc {
		t.Fatalf("round trip: %s", got)
	}
	if got := a.GetLayout("p2"); got != "" {
		t.Fatalf("per project: %q", got)
	}
	// Another user on the same machine does not see it.
	if raw, ok, _ := a.store.Setting(a.ctx, layoutKey("someone-else", "p1")); ok {
		t.Fatalf("leaked under another user: %s", raw)
	}
	if raw, ok, _ := a.store.Setting(a.ctx, layoutKey("u1", "p1")); !ok || raw != doc {
		t.Fatalf("stored under ui_layout_<user>_<project>: %v", ok)
	}
	for _, bad := range []string{"", "nope", `{"version":2,"layout":{}}`, `[]`} {
		if r := a.SetLayout("p1", bad); r.Error == nil {
			t.Errorf("%q must be refused", bad)
		}
	}
}

func TestLayoutMigratesTheOldTabList(t *testing.T) {
	a := newTestApp(t, true, nil)
	if err := a.store.PutSetting(a.ctx, tabsKey("p1"), `{"open":[{"kind":"request","id":"r1"},{"kind":"env_list","id":""}],"active":{"kind":"request","id":"r1"}}`); err != nil {
		t.Fatal(err)
	}
	var doc struct {
		Version int `json:"version"`
		Layout  struct {
			Root struct {
				Type        string   `json:"type"`
				Tabs        []string `json:"tabs"`
				ActiveTabID string   `json:"activeTabId"`
			} `json:"root"`
		} `json:"layout"`
	}
	if err := json.Unmarshal([]byte(a.GetLayout("p1")), &doc); err != nil {
		t.Fatal(err)
	}
	if doc.Version != 1 || doc.Layout.Root.Type != "group" || len(doc.Layout.Root.Tabs) != 2 ||
		doc.Layout.Root.Tabs[0] != "request:r1" || doc.Layout.Root.Tabs[1] != "env_list:" || doc.Layout.Root.ActiveTabID != "request:r1" {
		t.Fatalf("migrated = %+v", doc)
	}
}

func TestSetLayoutFreesClosedTabsBodies(t *testing.T) {
	a := newTestApp(t, true, nil)
	a.responses.put("r1", heldBody{projectID: "p1", data: []byte("1")})
	a.responses.put("r2", heldBody{projectID: "p1", data: []byte("2")})
	a.SetLayout("p1", `{"version":1,"layout":{"root":{"type":"group","id":"A","tabs":["request:r2"]},"focusedGroupId":"A"}}`)
	if _, ok := a.responses.get("r1"); ok {
		t.Error("r1 is not open in any group: its body must go")
	}
	if _, ok := a.responses.get("r2"); !ok {
		t.Error("r2 is open: keep its body")
	}
}

func TestLayoutNeedsAUser(t *testing.T) {
	a := newTestApp(t, false, nil)
	if r := a.SetLayout("p1", `{"version":1,"layout":{"root":{"type":"group","id":"A","tabs":[]}}}`); r.Error != nil {
		t.Fatal(r.Error.Message)
	}
	if got := a.GetLayout("p1"); got != "" {
		t.Fatalf("logged out: %q", got)
	}
}
