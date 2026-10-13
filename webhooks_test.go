package main

import (
	"context"
	"encoding/base64"
	"fmt"
	"net/http"
	"os"
	"path/filepath"
	"strconv"
	"strings"
	"testing"

	"github.com/wailsapp/wails/v2/pkg/runtime"
)

func TestPollCapturesReadsABacklogInPages(t *testing.T) {
	var afters []string
	a := newTestApp(t, true, map[string]http.HandlerFunc{
		"GET /api/v1/webhooks/{id}/captures": func(w http.ResponseWriter, r *http.Request) {
			after, _ := strconv.Atoi(r.URL.Query().Get("after"))
			afters = append(afters, r.URL.Query().Get("after"))
			n := 100
			if after >= 200 {
				n = 3 // the last, partial page
			}
			rows := make([]string, n)
			for i := range rows {
				rows[i] = fmt.Sprintf(`{"id":%d,"method":"POST","path":"/","query":"","content_type":"","body_size":0,"body_truncated":false,"source_ip":"x","received_at":"x"}`, after+i+1)
			}
			_, _ = w.Write([]byte("[" + strings.Join(rows, ",") + "]"))
		},
	})
	res := a.PollCaptures("w1", 0)
	if res.Error != nil {
		t.Fatal(res.Error.Message)
	}
	if len(res.Data) != 203 || res.Data[0].ID != 1 || res.Data[202].ID != 203 {
		t.Fatalf("got %d rows", len(res.Data))
	}
	if strings.Join(afters, ",") != ",100,200" {
		t.Errorf("cursors = %v", afters)
	}
}

func TestCreateWebhookMarksNotConfigured(t *testing.T) {
	msg := "webhook capture is not configured on this server (HOOKS_DOMAINS)"
	a := newTestApp(t, true, map[string]http.HandlerFunc{
		"POST /api/v1/projects/{project_id}/webhooks": func(w http.ResponseWriter, _ *http.Request) {
			writeEnvelope(w, 409, "conflict", msg)
		},
	})
	res := a.CreateWebhook("p1", "x")
	if res.Error == nil || res.Error.Code != CodeHooksNotConfigured || res.Error.Message != msg || res.Error.Status != 409 {
		t.Fatalf("problem = %+v", res.Error)
	}
	// The quota 409 stays a plain conflict, verbatim.
	quota := newTestApp(t, true, map[string]http.HandlerFunc{
		"POST /api/v1/projects/{project_id}/webhooks": func(w http.ResponseWriter, _ *http.Request) {
			writeEnvelope(w, 409, "conflict", "a project can have at most 20 webhook endpoints")
		},
	})
	if p := quota.CreateWebhook("p1", "x").Error; p == nil || p.Code != "conflict" || p.Message != "a project can have at most 20 webhook endpoints" {
		t.Fatalf("quota problem = %+v", p)
	}
}

func TestUpdateWebhookValidatesStatus(t *testing.T) {
	a := newTestApp(t, true, nil)
	bad := int32(42)
	if p := a.UpdateWebhook("w1", WebhookPatchInput{RespStatus: &bad}).Error; p == nil || p.Kind != "invalid" {
		t.Fatalf("problem = %+v", p)
	}
}

func captureRoute(body []byte, contentType string) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		b64 := "null"
		if body != nil {
			b64 = `"` + base64.StdEncoding.EncodeToString(body) + `"`
		}
		_, _ = fmt.Fprintf(w, `{"id":%s,"method":"POST","path":"/cb","query":"","content_type":%q,"body_size":%d,
			"body_truncated":false,"source_ip":"x","received_at":"x","headers":[{"key":"Host","value":"hooks.test"}],"body":%s}`,
			r.PathValue("capture_id"), contentType, len(body), b64)
	}
}

func TestCaptureDetailPreviewFilterAndSave(t *testing.T) {
	a := newTestApp(t, true, map[string]http.HandlerFunc{
		"GET /api/v1/webhooks/{id}/captures/{capture_id}": captureRoute([]byte(`{"a":[1,2]}`), "application/json"),
		"GET /api/v1/webhooks/{id}": func(w http.ResponseWriter, _ *http.Request) {
			_, _ = w.Write([]byte(`{"id":"w1","project_id":"p1","name":"Payme","slug":"s","domain":"","resp_status":200}`))
		},
	})
	res := a.GetCaptureDetail("w1", 3)
	if res.Error != nil {
		t.Fatal(res.Error.Message)
	}
	d := res.Data
	if !d.Formatted || d.RawBody != `{"a":[1,2]}` || !strings.Contains(d.Body, "\n") || d.Media != "" || d.StoredBytes != 11 {
		t.Fatalf("detail = %+v", d)
	}
	if f := a.EvalCaptureFilter("w1", 3, ".a[1]"); f.Error != "" || f.ResultJSON != "2" {
		t.Fatalf("filter = %+v", f)
	}

	dir := t.TempDir()
	var defaultName string
	a.saveDialog = func(_ context.Context, o runtime.SaveDialogOptions) (string, error) {
		defaultName = o.DefaultFilename
		return filepath.Join(dir, "out.json"), nil
	}
	saved := a.SaveCaptureBodyToFile("w1", 3)
	if saved.Error != nil || saved.Data.BytesWritten != 11 {
		t.Fatalf("save = %+v", saved)
	}
	if got, _ := os.ReadFile(filepath.Join(dir, "out.json")); string(got) != `{"a":[1,2]}` || defaultName != "Payme capture.json" {
		t.Fatalf("file = %q, name = %q", got, defaultName)
	}
}

func TestCaptureDetailBinaryIsNotText(t *testing.T) {
	png := []byte("\x89PNG\r\n\x1a\n\x00\x00\x00\rIHDR")
	a := newTestApp(t, true, map[string]http.HandlerFunc{
		"GET /api/v1/webhooks/{id}/captures/{capture_id}": captureRoute(png, "image/png"),
	})
	d := a.GetCaptureDetail("w1", 4).Data
	if d == nil || d.Media != "image" || d.Body != "" || d.StoredBytes != int64(len(png)) {
		t.Fatalf("detail = %+v", d)
	}
	if p := a.CopyCaptureBody("w1", 4).Error; p == nil {
		t.Fatal("a binary body was copied as text")
	}
	// Save writes the exact bytes, named by type.
	out := filepath.Join(t.TempDir(), "pic.png")
	var name string
	a.saveDialog = func(_ context.Context, o runtime.SaveDialogOptions) (string, error) {
		name = o.DefaultFilename
		return out, nil
	}
	if r := a.SaveCaptureBodyToFile("w1", 4); r.Error != nil || r.Data.BytesWritten != int64(len(png)) {
		t.Fatalf("save = %+v", r)
	}
	if got, _ := os.ReadFile(out); string(got) != string(png) || name != "capture.png" {
		t.Fatalf("saved %q as %q", got, name)
	}

	empty := newTestApp(t, true, map[string]http.HandlerFunc{
		"GET /api/v1/webhooks/{id}/captures/{capture_id}": captureRoute(nil, "application/json"),
	})
	if d := empty.GetCaptureDetail("w1", 5).Data; d == nil || d.Media != "" || d.Body != "" || d.StoredBytes != 0 {
		t.Fatalf("empty = %+v", d)
	}
}

func TestWebhookPanelPrefs(t *testing.T) {
	a := newTestApp(t, false, nil)
	if got := a.GetWebhookPanel("p1"); got != (WebhookPanelPrefs{Fraction: DefaultWebhookPanelFraction}) {
		t.Fatalf("default = %+v", got)
	}
	if r := a.SetWebhookPanel("p1", WebhookPanelPrefs{Expanded: true, Fraction: 0.45}); r.Error != nil {
		t.Fatal(r.Error.Message)
	}
	if got := a.GetWebhookPanel("p1"); got != (WebhookPanelPrefs{Expanded: true, Fraction: 0.45}) {
		t.Fatalf("saved = %+v", got)
	}
	if got := a.GetWebhookPanel("p2"); got.Expanded {
		t.Fatal("panel state leaked to another project")
	}
	for _, f := range []float64{0, 1, -2} {
		if r := a.SetWebhookPanel("p1", WebhookPanelPrefs{Fraction: f}); r.Error == nil {
			t.Fatalf("fraction %v accepted", f)
		}
	}
	_ = a.store.PutSetting(a.ctx, settingWebhookPanelPrefix+"p1", "{broken")
	if got := a.GetWebhookPanel("p1"); got != (WebhookPanelPrefs{Fraction: DefaultWebhookPanelFraction}) {
		t.Fatalf("corrupt = %+v", got)
	}
}
