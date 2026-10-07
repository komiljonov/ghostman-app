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

func TestFollowRedirectsDefaultAndOverrides(t *testing.T) {
	ctx := context.Background()
	path := filepath.Join(t.TempDir(), "ghostman.db")
	s, err := Open(ctx, path)
	if err != nil {
		t.Fatal(err)
	}
	if def, err := s.FollowRedirectsDefault(ctx); err != nil || !def {
		t.Fatalf("global default: %v %v, want true", def, err)
	}
	if o, err := s.FollowRedirectsOverride(ctx, "r1"); err != nil || o != nil {
		t.Fatalf("untouched request: override=%v err=%v, want none", o, err)
	}
	off, on := false, true
	if err := s.SetFollowRedirectsOverride(ctx, "r1", &off); err != nil {
		t.Fatal(err)
	}
	if err := s.SetFollowRedirectsOverride(ctx, "r2", &on); err != nil {
		t.Fatal(err)
	}
	if err := s.SetFollowRedirectsDefault(ctx, false); err != nil {
		t.Fatal(err)
	}
	_ = s.Close()

	// Survives a restart.
	s, err = Open(ctx, path)
	if err != nil {
		t.Fatal(err)
	}
	defer s.Close()
	if def, _ := s.FollowRedirectsDefault(ctx); def {
		t.Fatal("default must stay off")
	}
	if o, _ := s.FollowRedirectsOverride(ctx, "r1"); o == nil || *o {
		t.Fatalf("r1 override must stay off, got %v", o)
	}
	if o, _ := s.FollowRedirectsOverride(ctx, "r2"); o == nil || !*o {
		t.Fatalf("r2 override must stay on, got %v", o)
	}
	// Back to "use the default".
	if err := s.SetFollowRedirectsOverride(ctx, "r1", nil); err != nil {
		t.Fatal(err)
	}
	if o, _ := s.FollowRedirectsOverride(ctx, "r1"); o != nil {
		t.Fatal("r1 must use the default again")
	}
	_ = s.PutSetting(ctx, settingFollowRedirectsDefault, "garbage")
	if def, _ := s.FollowRedirectsDefault(ctx); !def {
		t.Fatal("a corrupt default falls back to true")
	}
}

func TestMigrationDropsOldFollowOnRows(t *testing.T) {
	ctx := context.Background()
	s, err := Open(ctx, filepath.Join(t.TempDir(), "ghostman.db"))
	if err != nil {
		t.Fatal(err)
	}
	defer s.Close()
	// After all migrations, an override written now is kept (the cleanup ran once, earlier).
	on := true
	if err := s.SetFollowRedirectsOverride(ctx, "r1", &on); err != nil {
		t.Fatal(err)
	}
	if o, _ := s.FollowRedirectsOverride(ctx, "r1"); o == nil || !*o {
		t.Fatal("a new 'always' override must persist")
	}
}
