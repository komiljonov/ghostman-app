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

func TestBulkModePrefsAreGlobalPerKind(t *testing.T) {
	a := newTestApp(t, false, nil)
	if p := a.GetUIPrefs(); p.BulkParams || p.BulkHeaders || p.BulkForm {
		t.Fatalf("default must be the table: %+v", p)
	}
	if r := a.SetBulkMode("form", true); r.Error != nil {
		t.Fatal(r.Error.Message)
	}
	if p := a.GetUIPrefs(); !p.BulkForm || p.BulkParams || p.BulkHeaders {
		t.Fatalf("after form=on: %+v", p)
	}
	_ = a.SetBulkMode("headers", true)
	_ = a.SetBulkMode("form", false)
	if p := a.GetUIPrefs(); p.BulkForm || !p.BulkHeaders {
		t.Fatalf("after toggles: %+v", p)
	}
	if r := a.SetBulkMode("cookies", true); r.Error == nil {
		t.Fatal("unknown kind must be refused")
	}
	_ = a.store.PutSetting(a.ctx, settingBulkModePrefix+"params", "yes please")
	if p := a.GetUIPrefs(); p.BulkParams {
		t.Fatal("corrupt value must fall back to the table")
	}
}
