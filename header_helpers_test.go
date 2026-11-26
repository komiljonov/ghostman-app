package main

import (
	"fmt"
	"net/http"
	"reflect"
	"testing"
)

func TestPushRecent(t *testing.T) {
	tests := []struct {
		list []string
		key  string
		want []string
	}{
		{nil, "X-Trace", []string{"X-Trace"}},
		{[]string{"A", "B"}, " C ", []string{"C", "A", "B"}},
		{[]string{"A", "x-trace", "B"}, "X-Trace", []string{"X-Trace", "A", "B"}}, // moved up, newest spelling
		{[]string{"A"}, "   ", []string{"A"}},
		{[]string{"A", "B", "C"}, "D", []string{"D", "A", "B"}}, // capped at 3 below
	}
	for _, tt := range tests {
		if got := pushRecent(tt.list, tt.key, 3); !reflect.DeepEqual(got, tt.want) {
			t.Errorf("pushRecent(%v, %q) = %v, want %v", tt.list, tt.key, got, tt.want)
		}
	}
}

func TestRecentHeaderKeysAndHintDismissal(t *testing.T) {
	a := newTestApp(t, false, nil)
	if got := a.GetRecentHeaderKeys("p1"); len(got) != 0 {
		t.Fatalf("fresh = %v", got)
	}
	for i := 0; i < MaxRecentHeaderKeys+5; i++ {
		a.AddRecentHeaderKey("p1", fmt.Sprintf("X-K%d", i))
	}
	returned := a.AddRecentHeaderKey("p1", "x-k3")
	got := a.GetRecentHeaderKeys("p1")
	if len(got) != MaxRecentHeaderKeys || got[0] != "x-k3" {
		t.Fatalf("recent = %d keys, first %q", len(got), got[0])
	}
	if !reflect.DeepEqual(returned, got) {
		t.Fatalf("AddRecentHeaderKey returned %v, stored %v", returned, got)
	}
	if len(a.GetRecentHeaderKeys("p2")) != 0 {
		t.Fatal("recent keys are per project")
	}

	if a.IsAuthHintDismissed("r1") {
		t.Fatal("not dismissed yet")
	}
	if r := a.DismissAuthHint("r1"); r.Error != nil {
		t.Fatal(r.Error.Message)
	}
	if !a.IsAuthHintDismissed("r1") || a.IsAuthHintDismissed("r2") {
		t.Fatal("dismissal is per request")
	}
}

func TestOrderByIDs(t *testing.T) {
	id := func(s string) string { return s }
	tests := []struct {
		list, order, want []string
	}{
		{[]string{"a", "b", "c"}, nil, []string{"a", "b", "c"}},
		{[]string{"a", "b", "c"}, []string{"c", "a", "b"}, []string{"c", "a", "b"}},
		{[]string{"a", "b", "c", "new"}, []string{"c", "gone", "a"}, []string{"c", "a", "b", "new"}}, // unknown ids last, in server order
	}
	for _, tt := range tests {
		if got := orderByIDs(tt.list, id, tt.order); !reflect.DeepEqual(got, tt.want) {
			t.Errorf("orderByIDs(%v, %v) = %v, want %v", tt.list, tt.order, got, tt.want)
		}
	}
}

// The webhook sidebar order is local: ListWebhooks applies the saved order.
func TestWebhookOrderIsLocal(t *testing.T) {
	a := newTestApp(t, true, map[string]http.HandlerFunc{
		"GET /api/v1/projects/p1/webhooks": func(w http.ResponseWriter, _ *http.Request) {
			_, _ = w.Write([]byte(`[{"id":"h1","name":"one"},{"id":"h2","name":"two"},{"id":"h3","name":"three"}]`))
		},
	})
	names := func() []string {
		r := a.ListWebhooks("p1")
		if r.Error != nil {
			t.Fatal(r.Error.Message)
		}
		out := []string{}
		for _, h := range r.Data {
			out = append(out, h.ID)
		}
		return out
	}
	if got := names(); !reflect.DeepEqual(got, []string{"h1", "h2", "h3"}) {
		t.Fatalf("server order = %v", got)
	}
	if r := a.SetWebhookOrder("p1", []string{"h3", "h1", "h2"}); r.Error != nil {
		t.Fatal(r.Error.Message)
	}
	if got := names(); !reflect.DeepEqual(got, []string{"h3", "h1", "h2"}) {
		t.Fatalf("local order = %v", got)
	}
}

func TestScriptEditorHeights(t *testing.T) {
	a := newTestApp(t, false, nil)
	if p := a.GetUIPrefs(); p.ScriptHeightPre != 0 || p.ScriptHeightPost != 0 {
		t.Fatalf("defaults = %+v", p)
	}
	if r := a.SetScriptEditorHeight("pre", 260); r.Error != nil {
		t.Fatal(r.Error.Message)
	}
	if r := a.SetScriptEditorHeight("post", 40); r.Error == nil {
		t.Fatal("below the minimum is refused")
	}
	if r := a.SetScriptEditorHeight("mid", 200); r.Error == nil {
		t.Fatal("unknown kind is refused")
	}
	if p := a.GetUIPrefs(); p.ScriptHeightPre != 260 || p.ScriptHeightPost != 0 {
		t.Fatalf("saved = %+v", p)
	}
	if r := a.SetScriptEditorHeight("pre", 0); r.Error != nil || a.GetUIPrefs().ScriptHeightPre != 0 {
		t.Fatal("0 resets to the default")
	}
}
