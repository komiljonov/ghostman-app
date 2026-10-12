package main

import (
	"context"
	"fmt"
	"io"
	"log/slog"
	"os"
	"path/filepath"
	"unicode"

	"github.com/wailsapp/wails/v2/pkg/runtime"

	"ghostman/internal/api"
	"ghostman/internal/importer"
	"ghostman/internal/session"
)

// Import (profile menu → Import…): Postman collections / environments and OpenAPI
// 3.x / Swagger 2.0 specs, JSON or YAML, through ONE file picker — the sniffer
// routes by content. All the work is Go: internal/importer sniffs, plans (pure,
// tested against fixtures) and executes through the existing server endpoints into
// the CURRENT project; the UI only picks the file, shows progress and renders the
// returned report.

// maxImportFileBytes bounds what is read from disk.
const maxImportFileBytes = 64 << 20

// ImportFile is the picked file, sniffed (the modal shows it before importing).
type ImportFile struct {
	Path     string `json:"path"`
	FileName string `json:"file_name"`
	importer.FileInfo
}

type ImportFileResult struct {
	Data  *ImportFile      `json:"data,omitempty"`
	Error *session.Problem `json:"error,omitempty"`
}

type ImportReportResult struct {
	Data  *importer.Report `json:"data,omitempty"`
	Error *session.Problem `json:"error,omitempty"`
}

// ImportProgress is the "import:progress" event's payload.
type ImportProgress struct {
	Done  int `json:"done"`
	Total int `json:"total"`
}

// ImportProgressEvent is emitted after each created item of a running import.
const ImportProgressEvent = "import:progress"

// openDialog is the native "Open" dialog; tests replace it. "" = cancelled.
type openDialog func(ctx context.Context, opts runtime.OpenDialogOptions) (string, error)

// eventEmitter sends a Wails event to the UI; tests replace it.
type eventEmitter func(ctx context.Context, name string, data ...any)

func invalid(msg string) *session.Problem {
	return &session.Problem{Kind: session.KindInvalid, Message: msg}
}

// ChooseImportFile opens the native dialog (.json) and sniffs the picked file.
// Cancel → no data, no error. A file that is not a supported Postman export → a
// readable error naming both supported kinds.
func (a *App) ChooseImportFile() ImportFileResult {
	path, err := a.openDialog(a.ctx, runtime.OpenDialogOptions{
		Title: "Import",
		Filters: []runtime.FileFilter{
			{DisplayName: "OpenAPI / Swagger / Postman (*.json, *.yaml, *.yml)", Pattern: "*.json;*.yaml;*.yml"},
		},
	})
	if err != nil {
		return ImportFileResult{Error: invalid("could not open the file dialog: " + err.Error())}
	}
	if path == "" {
		return ImportFileResult{}
	}
	data, p := readImportFile(path)
	if p != nil {
		return ImportFileResult{Error: p}
	}
	info, err := importer.Sniff(data)
	if err != nil {
		return ImportFileResult{Error: invalid(capitalize(err.Error()) + ".")}
	}
	return ImportFileResult{Data: &ImportFile{Path: path, FileName: filepath.Base(path), FileInfo: info}}
}

func readImportFile(path string) ([]byte, *session.Problem) {
	f, err := os.Open(path)
	if err != nil {
		return nil, invalid("could not open the file: " + err.Error())
	}
	defer f.Close()
	data, err := io.ReadAll(io.LimitReader(f, maxImportFileBytes+1))
	if err != nil {
		return nil, invalid("could not read the file: " + err.Error())
	}
	if len(data) > maxImportFileBytes {
		return nil, invalid(fmt.Sprintf("the file is larger than %d MB, which is too big to import", maxImportFileBytes>>20))
	}
	return data, nil
}

func withArticle(kind string) string {
	switch kind {
	case importer.KindEnvironment:
		return "a Postman environment"
	case importer.KindOpenAPI:
		return "an OpenAPI / Swagger spec"
	}
	return "a Postman collection"
}

func capitalize(s string) string {
	r := []rune(s)
	if len(r) == 0 {
		return s
	}
	r[0] = unicode.ToUpper(r[0])
	return string(r)
}

// ImportPostmanCollection imports a collection file into the project as ONE new
// root folder and returns the full report (also on a failure part-way: the report
// says where it stopped and how to undo).
func (a *App) ImportPostmanCollection(projectID, path string) ImportReportResult {
	return a.runImport(projectID, path, importer.KindCollection)
}

// ImportPostmanEnvironment imports an environment file as ONE new environment.
func (a *App) ImportPostmanEnvironment(projectID, path string) ImportReportResult {
	return a.runImport(projectID, path, importer.KindEnvironment)
}

// ImportOpenAPI imports an OpenAPI 3.x spec (or a Swagger 2.0 one, converted) as
// ONE new root folder plus one environment per server.
func (a *App) ImportOpenAPI(projectID, path string) ImportReportResult {
	return a.runImport(projectID, path, importer.KindOpenAPI)
}

func (a *App) runImport(projectID, path, kind string) ImportReportResult {
	if !a.importMu.TryLock() {
		return ImportReportResult{Error: invalid("an import is already running")}
	}
	defer a.importMu.Unlock()

	a.clientMu.Lock()
	c := a.client
	a.clientMu.Unlock()
	if c == nil || a.session == nil || !a.session.IsLoggedIn() {
		return ImportReportResult{Error: problemNotLoggedIn}
	}
	data, p := readImportFile(path)
	if p != nil {
		return ImportReportResult{Error: p}
	}
	info, err := importer.Sniff(data)
	if err != nil {
		return ImportReportResult{Error: invalid(capitalize(err.Error()) + ".")}
	}
	if info.Kind != kind {
		return ImportReportResult{Error: invalid(fmt.Sprintf("This file is %s, not %s.", withArticle(info.Kind), withArticle(kind)))}
	}

	ctx := a.ctx
	projectName := "Project"
	if proj, err := c.GetProject(ctx, projectID); err == nil && proj.Name != "" {
		projectName = proj.Name
	}
	progress := func(done, total int) { a.emit(ctx, ImportProgressEvent, ImportProgress{Done: done, Total: total}) }
	source := filepath.Base(path)

	var rep *importer.Report
	var failure error
	switch kind {
	case importer.KindCollection:
		rep, failure, err = importer.ImportCollection(ctx, c, projectID, projectName, data, source, progress)
	case importer.KindOpenAPI:
		rep, failure, err = importer.ImportOpenAPI(ctx, c, envWriter{a, c}, projectID, projectName, data, source, progress)
	default:
		rep, failure, err = importer.ImportEnvironment(ctx, c, envWriter{a, c}, projectID, projectName, data, source, progress)
	}
	if err != nil {
		return ImportReportResult{Error: invalid(capitalize(err.Error()) + ".")}
	}
	if failure != nil && api.IsUnauthorized(failure) {
		a.session.Check(ctx) // the session expired mid-import: the UI drops to login after the report
	}
	slog.Info("import", "kind", kind, "folders", rep.Summary.Folders, "requests", rep.Summary.Requests,
		"environments", rep.Summary.Environments, "variables", rep.Summary.Variables, "changed", len(rep.Changed), "dropped", len(rep.Dropped),
		"failed", len(rep.Failed), "stopped", rep.Stopped != "")
	return ImportReportResult{Data: rep}
}

// envWriter routes imported variables through internal/envs, the one place that
// writes variables (secrets stay local; their values are not imported anyway).
type envWriter struct {
	a *App
	c *api.APIClient
}

func (w envWriter) CreateVariable(ctx context.Context, envID, key, typ string) (api.Variable, error) {
	return w.a.envs.CreateVariable(ctx, w.c, envID, key, typ)
}

func (w envWriter) SetValue(ctx context.Context, envID, varID, value string) error {
	return w.a.envs.SetValue(ctx, w.c, envID, varID, value)
}
