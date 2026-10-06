package main

import "testing"

func TestThemeRoundtrip(t *testing.T) {
	a := newTestApp(t, false, nil) // works without being logged in (login screens are themed too)
	if got := a.GetTheme(); got != ThemeSystem {
		t.Fatalf("default = %q", got)
	}
	for _, th := range []string{ThemeLight, ThemeDark, ThemeSystem} {
		if res := a.SetTheme(th); res.Error != nil {
			t.Fatalf("SetTheme(%q): %s", th, res.Error.Message)
		}
		if got := a.GetTheme(); got != th {
			t.Fatalf("after SetTheme(%q) got %q", th, got)
		}
	}
	if res := a.SetTheme("neon"); res.Error == nil || res.Error.Kind != "invalid" {
		t.Fatalf("invalid theme accepted: %+v", res)
	}
	if err := a.store.PutSetting(a.ctx, settingTheme, "garbage"); err != nil {
		t.Fatal(err)
	}
	if got := a.GetTheme(); got != ThemeSystem {
		t.Fatalf("corrupt value = %q", got)
	}
}
