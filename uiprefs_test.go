package main

import "testing"

func TestUIPrefsRoundtrip(t *testing.T) {
	a := newTestApp(t, false, nil)
	if got := a.GetUIPrefs(); got != (UIPrefs{SidebarWidth: DefaultSidebarWidth, ResponseWrap: true}) {
		t.Fatalf("defaults = %+v", got)
	}
	if res := a.SetSidebarWidth(333); res.Error != nil {
		t.Fatal(res.Error.Message)
	}
	if res := a.SetResponseWrap(false); res.Error != nil {
		t.Fatal(res.Error.Message)
	}
	if got := a.GetUIPrefs(); got != (UIPrefs{SidebarWidth: 333, ResponseWrap: false}) {
		t.Fatalf("after set = %+v", got)
	}
	for _, px := range []int{0, MinSidebarWidth - 1, 100000} {
		if res := a.SetSidebarWidth(px); res.Error == nil || res.Error.Kind != "invalid" {
			t.Fatalf("width %d accepted: %+v", px, res)
		}
	}
	// Corrupt stored values fall back to the defaults.
	_ = a.store.PutSetting(a.ctx, settingSidebarWidth, "wide")
	_ = a.store.PutSetting(a.ctx, settingResponseWrap, "maybe")
	if got := a.GetUIPrefs(); got != (UIPrefs{SidebarWidth: DefaultSidebarWidth, ResponseWrap: true}) {
		t.Fatalf("corrupt = %+v", got)
	}
}
