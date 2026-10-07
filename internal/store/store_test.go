package store

import (
	"context"
	"path/filepath"
	"testing"
)

func TestOpenMigratesAndPersistsHistory(t *testing.T) {
	ctx := context.Background()
	path := filepath.Join(t.TempDir(), "nested", "ghostman.db")

	s, err := Open(ctx, path)
	if err != nil {
		t.Fatalf("open: %v", err)
	}
	for i := int64(1); i <= 3; i++ {
		err := s.InsertHistory(ctx, InsertHistoryParams{
			Method: "GET", Url: "https://example.com", Status: 200, DurationMs: i, CreatedAt: 1000 + i,
		})
		if err != nil {
			t.Fatalf("insert: %v", err)
		}
	}
	if err := s.Close(); err != nil {
		t.Fatal(err)
	}

	// Reopening re-runs migrations (a no-op) and must keep the rows.
	s, err = Open(ctx, path)
	if err != nil {
		t.Fatalf("reopen: %v", err)
	}
	defer s.Close()

	rows, err := s.ListHistory(ctx, 2)
	if err != nil {
		t.Fatalf("list: %v", err)
	}
	if len(rows) != 2 || rows[0].CreatedAt != 1003 || rows[1].CreatedAt != 1002 {
		t.Errorf("want newest-first limit 2, got %+v", rows)
	}
}

func TestSettingsRoundtrip(t *testing.T) {
	ctx := context.Background()
	path := filepath.Join(t.TempDir(), "ghostman.db")
	s, err := Open(ctx, path)
	if err != nil {
		t.Fatal(err)
	}

	if _, ok, err := s.Setting(ctx, SettingSessionToken); ok || err != nil {
		t.Fatalf("missing key: ok=%v err=%v", ok, err)
	}
	for _, v := range []string{"first", "second"} { // second write must upsert
		if err := s.PutSetting(ctx, SettingSessionToken, v); err != nil {
			t.Fatal(err)
		}
	}
	if err := s.PutSetting(ctx, SettingServerURL, "http://localhost:9999"); err != nil {
		t.Fatal(err)
	}
	_ = s.Close()

	s, err = Open(ctx, path)
	if err != nil {
		t.Fatal(err)
	}
	defer s.Close()
	if v, ok, err := s.Setting(ctx, SettingSessionToken); v != "second" || !ok || err != nil {
		t.Fatalf("token after reopen = %q ok=%v err=%v", v, ok, err)
	}
	if err := s.DeleteSetting(ctx, SettingSessionToken); err != nil {
		t.Fatal(err)
	}
	if _, ok, _ := s.Setting(ctx, SettingSessionToken); ok {
		t.Fatal("token still present after delete")
	}
	if v, _, _ := s.Setting(ctx, SettingServerURL); v != "http://localhost:9999" {
		t.Fatalf("server_url = %q", v)
	}
}

func TestFollowRedirectsGlobalDefault(t *testing.T) {
	ctx := context.Background()
	path := filepath.Join(t.TempDir(), "ghostman.db")
	s, err := Open(ctx, path)
	if err != nil {
		t.Fatal(err)
	}
	if def, err := s.FollowRedirectsDefault(ctx); err != nil || !def {
		t.Fatalf("default: %v %v, want true", def, err)
	}
	if err := s.SetFollowRedirectsDefault(ctx, false); err != nil {
		t.Fatal(err)
	}
	_ = s.Close()
	s, err = Open(ctx, path)
	if err != nil {
		t.Fatal(err)
	}
	defer s.Close()
	if def, _ := s.FollowRedirectsDefault(ctx); def {
		t.Fatal("must stay off after reopen")
	}
	_ = s.PutSetting(ctx, settingFollowRedirectsDefault, "garbage")
	if def, _ := s.FollowRedirectsDefault(ctx); !def {
		t.Fatal("a corrupt value falls back to true")
	}
}

func TestLegacyRequestSettingsLifecycle(t *testing.T) {
	ctx := context.Background()
	s, err := Open(ctx, filepath.Join(t.TempDir(), "ghostman.db"))
	if err != nil {
		t.Fatal(err)
	}
	defer s.Close()
	for id, v := range map[string]int64{"a": 0, "b": 1} {
		if err := s.PutFollowRedirects(ctx, PutFollowRedirectsParams{RequestID: id, FollowRedirects: v}); err != nil {
			t.Fatal(err)
		}
	}
	rows, err := s.LegacyRequestSettings(ctx)
	if err != nil || len(rows) != 2 || rows[0] != (LegacyRequestSetting{RequestID: "a", Follow: false}) || !rows[1].Follow {
		t.Fatalf("rows = %+v %v", rows, err)
	}
	if err := s.DoneLegacyRequestSetting(ctx, "a"); err != nil {
		t.Fatal(err)
	}
	if rows, _ := s.LegacyRequestSettings(ctx); len(rows) != 1 {
		t.Fatalf("after done: %+v", rows)
	}
	if err := s.DropLegacyRequestSettings(ctx); err != nil {
		t.Fatal(err)
	}
	if rows, err := s.LegacyRequestSettings(ctx); err != nil || rows != nil {
		t.Fatalf("after drop: %+v %v (no table = nothing to push)", rows, err)
	}
	if err := s.DropLegacyRequestSettings(ctx); err != nil {
		t.Fatal("dropping twice is fine")
	}
}
