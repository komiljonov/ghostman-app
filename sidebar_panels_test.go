package main

import "testing"

func TestSidebarPanelPrefs(t *testing.T) {
	a := newTestApp(t, false, nil)
	if got := a.GetSidebarPanels("p1"); got != (SidebarPanelPrefs{Fraction: DefaultPanelFraction}) {
		t.Fatalf("default = %+v", got)
	}
	want := SidebarPanelPrefs{Webhooks: true, Proxies: true, Fraction: 0.45}
	if r := a.SetSidebarPanels("p1", want); r.Error != nil {
		t.Fatal(r.Error.Message)
	}
	if got := a.GetSidebarPanels("p1"); got != want {
		t.Fatalf("saved = %+v", got)
	}
	if got := a.GetSidebarPanels("p2"); got.Webhooks || got.Proxies {
		t.Fatal("panel state leaked to another project")
	}
	for _, f := range []float64{0, 1, -2} {
		if r := a.SetSidebarPanels("p1", SidebarPanelPrefs{Fraction: f}); r.Error == nil {
			t.Fatalf("fraction %v accepted", f)
		}
	}
	_ = a.store.PutSetting(a.ctx, settingSidebarPanelsPrefix+"p1", "{broken")
	if got := a.GetSidebarPanels("p1"); got != (SidebarPanelPrefs{Fraction: DefaultPanelFraction}) {
		t.Fatalf("corrupt = %+v", got)
	}
}

// The webhook-only state of earlier builds carries over until the new key is written.
func TestSidebarPanelPrefsFromLegacyWebhookPanel(t *testing.T) {
	a := newTestApp(t, false, nil)
	_ = a.store.PutSetting(a.ctx, settingWebhookPanelPrefix+"p1", `{"expanded":true,"fraction":0.52}`)
	if got := a.GetSidebarPanels("p1"); got != (SidebarPanelPrefs{Webhooks: true, Fraction: 0.52}) {
		t.Fatalf("legacy = %+v", got)
	}
	a.SetSidebarPanels("p1", SidebarPanelPrefs{Proxies: true, Fraction: 0.3})
	if got := a.GetSidebarPanels("p1"); got != (SidebarPanelPrefs{Proxies: true, Fraction: 0.3}) {
		t.Fatalf("the new key must win: %+v", got)
	}
}
