package postman

import (
	"context"
	"errors"
	"fmt"
	"log/slog"

	"ghostman/internal/api"
)

// Execution: a plan → server calls, strictly in order, through EXISTING endpoints
// (create folder / request / environment / variable, then PATCH contents and
// settings). The first server error stops the import; there is no automatic
// rollback — everything lands inside ONE new root folder (or environment), so
// undo is one delete, and the report's banner says so.

// Client is the server API the import needs (implemented by *api.APIClient).
type Client interface {
	ListFolders(ctx context.Context, projectID string) ([]api.Folder, error)
	CreateFolder(ctx context.Context, projectID, name string, parentID *string) (api.FolderDetail, error)
	UpdateFolderSettings(ctx context.Context, id string, patch api.FolderSettingsPatch) (api.FolderDetail, error)
	CreateRequest(ctx context.Context, projectID string, in api.NewRequest) (api.RequestSummary, error)
	UpdateRequest(ctx context.Context, id string, patch api.RequestPatch) (api.Request, error)
	DeleteRequest(ctx context.Context, id string) error
	ListEnvironments(ctx context.Context, projectID string) ([]api.Environment, error)
	CreateEnvironment(ctx context.Context, projectID, name string) (api.EnvironmentDetail, error)
}

// VariableWriter creates variables. The app passes internal/envs (every variable
// write goes through it: secrets are routed to local storage, never the server).
type VariableWriter interface {
	CreateVariable(ctx context.Context, envID, key, typ string) (api.Variable, error)
	SetValue(ctx context.Context, envID, varID, value string) error
}

// Progress is called after each created item (done of total).
type Progress func(done, total int)

// ImportCollection lists the project's root folders (for the name dedupe), plans
// the file and executes the plan. err: the file cannot be imported (nothing was
// sent). failure: the server error that stopped the import, if any (the report
// carries it too; the caller uses it to notice an expired session).
func ImportCollection(ctx context.Context, c Client, projectID, projectName string, data []byte, source string,
	progress Progress) (rep *Report, failure error, err error) {
	if _, err := parseCollection(data); err != nil {
		return nil, nil, err
	}
	folders, lerr := c.ListFolders(ctx, projectID)
	var roots []string
	for _, f := range folders {
		if f.ParentID == nil {
			roots = append(roots, f.Name)
		}
	}
	plan, err := PlanCollection(data, source, roots)
	if err != nil {
		return nil, nil, err
	}
	rep = plan.Report
	if lerr != nil {
		stopEarly(rep, plan.Root.Path, lerr, "could not read the project's folders")
		return rep, lerr, nil
	}
	r := &run{ctx: ctx, c: c, projectID: projectID, rep: rep, total: plan.Items, progress: progress}
	failure = r.root(plan.Root, projectName)
	rep.render()
	return rep, failure, nil
}

// ImportEnvironment lists the project's environments (dedupe), plans and executes.
func ImportEnvironment(ctx context.Context, c Client, vw VariableWriter, projectID, projectName string, data []byte,
	source string, progress Progress) (rep *Report, failure error, err error) {
	if _, err := parseEnvironment(data); err != nil {
		return nil, nil, err
	}
	envs, lerr := c.ListEnvironments(ctx, projectID)
	names := make([]string, 0, len(envs))
	for _, e := range envs {
		names = append(names, e.Name)
	}
	plan, err := PlanEnvironment(data, source, names)
	if err != nil {
		return nil, nil, err
	}
	rep = plan.Report
	if lerr != nil {
		stopEarly(rep, "Env '"+plan.Name+"'", lerr, "could not read the project's environments")
		return rep, lerr, nil
	}
	failure = executeEnvironment(ctx, c, vw, projectID, projectName, plan, progress)
	rep.render()
	return rep, failure, nil
}

func stopEarly(rep *Report, path string, err error, what string) {
	rep.add(Entry{Severity: Failed, Code: CodeServer, Path: path,
		Message: fmt.Sprintf("%s (%s). Nothing was imported.", what, ErrorText(err))})
	rep.Stopped = "Import stopped before anything was created, after a server error. Fix the issue and import again."
	rep.render()
}

// ErrorText is a server error as the report shows it: "400: name too long".
func ErrorText(err error) string {
	var ae *api.APIError
	if errors.As(err, &ae) {
		return fmt.Sprintf("%d: %s", ae.Status, ae.Message)
	}
	return err.Error()
}

type run struct {
	ctx       context.Context
	c         Client
	projectID string
	rep       *Report
	total     int // items inside the root
	done      int
	progress  Progress
	rootName  string
}

func (r *run) step() {
	r.done++
	if r.progress != nil {
		r.progress(r.done, r.total)
	}
}

// fail records a failed item, the stop banner and the items never attempted.
func (r *run) fail(path, kind, what string, err error) error {
	r.rep.add(Entry{Severity: Failed, Code: CodeServer, Path: path, Kind: kind,
		Message: fmt.Sprintf("%s (%s). NOT imported.", what, ErrorText(err))})
	if r.rootName == "" {
		r.rep.Stopped = "Import stopped before anything was created, after a server error. Fix the issue and import again."
		return err
	}
	r.rep.Stopped = fmt.Sprintf("Import stopped at item %d of %d after a server error. Everything above was created "+
		"inside folder '%s'; delete that folder to undo, fix the issue, re-import.", r.done+1, r.total, r.rootName)
	if left := r.total - r.done - 1; left > 0 {
		r.rep.add(Entry{Severity: Failed, Code: CodeSkipped,
			Message: plural(left, "more item was", "more items were") + " not imported because the import stopped."})
	}
	return err
}

func (r *run) root(f *FolderPlan, projectName string) error {
	created, err := r.c.CreateFolder(r.ctx, r.projectID, f.Name, nil)
	if err != nil {
		return r.fail(f.Path, "folder", "server rejected creating the collection's folder", err)
	}
	r.rootName = f.Name
	loc := projectName + " / " + f.Name
	r.rep.Target = loc
	r.rep.Summary.Folders++
	if err := r.settings(created.ID, f); err != nil {
		return err
	}
	r.rep.add(Entry{Severity: Imported, Code: CodeCreated, Kind: "folder", Path: f.Path,
		Message: "collection folder created", Location: loc})
	if r.progress != nil {
		r.progress(0, r.total)
	}
	return r.children(created.ID, f, loc)
}

func (r *run) children(id string, f *FolderPlan, loc string) error {
	for _, sub := range f.Folders {
		if err := r.folder(id, sub, loc); err != nil {
			return err
		}
	}
	for _, req := range f.Requests {
		if err := r.request(id, req, loc); err != nil {
			return err
		}
	}
	return nil
}

func (r *run) folder(parentID string, f *FolderPlan, parentLoc string) error {
	created, err := r.c.CreateFolder(r.ctx, r.projectID, f.Name, &parentID)
	if err != nil {
		return r.fail(f.Path, "folder", "server rejected creation", err)
	}
	r.rep.Summary.Folders++
	if err := r.settings(created.ID, f); err != nil {
		return err
	}
	loc := parentLoc + " / " + f.Name
	r.rep.add(Entry{Severity: Imported, Code: CodeCreated, Kind: "folder", Path: f.Path, Message: "created", Location: loc})
	r.step()
	return r.children(created.ID, f, loc)
}

// settings PATCHes a folder's auth / follow-redirects when the file set them.
func (r *run) settings(id string, f *FolderPlan) error {
	var patch api.FolderSettingsPatch
	if f.Auth.Type != api.AuthInherit {
		patch.Auth = api.FullAuthPatch(f.Auth)
	}
	if f.Follow != "" {
		patch.FollowRedirects = &f.Follow
	}
	if patch.Auth == nil && patch.FollowRedirects == nil {
		return nil
	}
	if _, err := r.c.UpdateFolderSettings(r.ctx, id, patch); err != nil {
		return r.fail(f.Path, "folder", "folder created, but the server rejected its auth / settings", err)
	}
	return nil
}

func (r *run) request(folderID string, p *RequestPlan, parentLoc string) error {
	d := p.Draft
	created, err := r.c.CreateRequest(r.ctx, r.projectID, api.NewRequest{Name: p.Name, FolderID: &folderID, Method: d.Method, URL: d.URL})
	if err != nil {
		return r.fail(p.Path, "request", "server rejected creation", err)
	}
	if patch, ok := contentsPatch(p); ok {
		if _, err := r.c.UpdateRequest(r.ctx, created.ID, patch); err != nil {
			if derr := r.c.DeleteRequest(context.WithoutCancel(r.ctx), created.ID); derr != nil {
				slog.Warn("import: could not remove a half-made request", "request", created.ID, "err", derr)
			}
			return r.fail(p.Path, "request", "server rejected its headers / params / body / auth", err)
		}
	}
	r.rep.Summary.Requests++
	r.rep.add(Entry{Severity: Imported, Code: CodeCreated, Kind: "request", Path: p.Path, Message: d.Method + " created",
		Location: parentLoc + " / " + p.Name})
	r.step()
	return nil
}

// contentsPatch is the one PATCH that fills a created request (only what is set).
func contentsPatch(p *RequestPlan) (api.RequestPatch, bool) {
	d := p.Draft
	var patch api.RequestPatch
	set := false
	if len(d.Headers) > 0 {
		patch.Headers, set = &d.Headers, true
	}
	if len(d.QueryParams) > 0 {
		patch.QueryParams, set = &d.QueryParams, true
	}
	if d.Body.Type != api.BodyNone && d.Body.Type != "" {
		patch.Body, set = &d.Body, true
	}
	if d.Auth.Type != api.AuthInherit {
		patch.Auth, set = api.FullAuthPatch(d.Auth), true
	}
	if p.Follow != "" {
		patch.FollowRedirects, set = &p.Follow, true
	}
	return patch, set
}

func executeEnvironment(ctx context.Context, c Client, vw VariableWriter, projectID, projectName string,
	plan *EnvironmentPlan, progress Progress) error {
	rep := plan.Report
	label := "Env '" + plan.Name + "'"
	env, err := c.CreateEnvironment(ctx, projectID, plan.Name)
	if err != nil {
		rep.add(Entry{Severity: Failed, Code: CodeServer, Path: label, Kind: "environment",
			Message: fmt.Sprintf("server rejected creating the environment (%s). NOT imported.", ErrorText(err))})
		rep.Stopped = "Import stopped before anything was created, after a server error. Fix the issue and import again."
		return err
	}
	loc := projectName + " / " + plan.Name
	rep.Target = loc
	rep.Summary.Environments = 1
	rep.add(Entry{Severity: Imported, Code: CodeCreated, Kind: "environment", Path: label, Message: "environment created",
		Location: loc})
	total := len(plan.Variables)
	for i, v := range plan.Variables {
		typ := VarRegular
		if v.Secret {
			typ = VarSecret
		}
		created, err := vw.CreateVariable(ctx, env.ID, v.Key, typ)
		if err == nil && !v.Secret && v.Value != "" {
			err = vw.SetValue(ctx, env.ID, created.ID, v.Value)
		}
		if err != nil {
			rep.add(Entry{Severity: Failed, Code: CodeServer, Path: label + " / " + v.Key, Kind: "variable",
				Message: fmt.Sprintf("server rejected the variable (%s). NOT imported.", ErrorText(err))})
			rep.Stopped = fmt.Sprintf("Import stopped at variable %d of %d after a server error. Everything above was "+
				"created in environment '%s'; delete that environment to undo, fix the issue, re-import.", i+1, total, plan.Name)
			if left := total - i - 1; left > 0 {
				rep.add(Entry{Severity: Failed, Code: CodeSkipped,
					Message: plural(left, "more variable was", "more variables were") + " not imported because the import stopped."})
			}
			return err
		}
		rep.Summary.Variables++
		what := "regular variable created"
		if v.Secret {
			what = "secret variable created (no value)"
		}
		rep.add(Entry{Severity: Imported, Code: CodeCreated, Kind: "variable", Path: label + " / " + v.Key, Message: what,
			Location: loc})
		if progress != nil {
			progress(i+1, total)
		}
	}
	return nil
}
