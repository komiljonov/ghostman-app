package importer

import (
	"fmt"
	"strings"
)

// Severities: the report's four sections.
const (
	Imported = "imported" // created as in Postman
	Warning  = "warning"  // imported, but changed — the entry says how
	Dropped  = "dropped"  // not imported at all — the entry says why and what to do
	Failed   = "failed"   // the server refused it (or the import stopped before it)
)

// Codes name every way the mapping can deviate from the Postman file. Each code
// has exactly one producing branch; FallbackCodes is what the fixture tests check
// for coverage (every code must be produced by some fixture).
const (
	CodeMethodUnsupported = "method.unsupported"
	CodeNameEmpty         = "name.empty"
	CodeURLPathVariable   = "url.path_variable"
	CodeURLFragment       = "url.fragment"
	CodeRowKeyless        = "row.keyless"
	CodeBodyDisabled      = "body.disabled"
	CodeBodyGraphQL       = "body.graphql"
	CodeBodyMultipart     = "body.multipart"
	CodeBodyFormFile      = "body.form_file"
	CodeBodyFile          = "body.file"
	CodeBodyUnknown       = "body.unknown_mode"
	CodeAuthUnsupported   = "auth.unsupported"
	CodeAuthAPIKeyIn      = "auth.apikey_in"
	CodeScriptPreRequest  = "script.prerequest"
	CodeScriptTest        = "script.test"
	CodeScriptOther       = "script.other"
	CodeDescriptions      = "descriptions"
	CodeExamples          = "examples"
	CodeCollectionVars    = "variables.collection"
	CodeFolderVars        = "variables.folder"
	CodeSettingOther      = "setting.unsupported"
	CodeOrderInterleaved  = "order.interleaved"
	CodeItemEmpty         = "item.empty"
	CodeEnvSecret         = "env.secret"
	CodeEnvDisabled       = "env.disabled"
	CodeEnvKeyless        = "env.keyless"
	CodeEnvDuplicate      = "env.duplicate"
	CodeEnvGlobals        = "env.globals"

	CodeCreated = "created"
	CodeServer  = "server.failed"
	CodeSkipped = "stopped.skipped"
)

// FallbackCodes are the mapping's deviation codes (not the execution ones).
var FallbackCodes = []string{
	CodeMethodUnsupported, CodeNameEmpty, CodeURLPathVariable, CodeURLFragment, CodeRowKeyless,
	CodeBodyDisabled, CodeBodyGraphQL, CodeBodyMultipart, CodeBodyFormFile, CodeBodyFile, CodeBodyUnknown,
	CodeAuthUnsupported, CodeAuthAPIKeyIn, CodeScriptPreRequest, CodeScriptTest, CodeScriptOther,
	CodeDescriptions, CodeExamples, CodeCollectionVars, CodeFolderVars, CodeSettingOther,
	CodeOrderInterleaved, CodeItemEmpty,
	CodeEnvSecret, CodeEnvDisabled, CodeEnvKeyless, CodeEnvDuplicate, CodeEnvGlobals,
	CodeOANameLong, CodeOATrace, CodeOAPathParams, CodeOACookieParams, CodeOADeprecated, CodeOASynthesized,
	CodeOARefCycle, CodeOADepthCap, CodeOARefBroken, CodeOABodyOther, CodeOAAltContent, CodeOAAuthSet,
	CodeOAAuthCookie, CodeOAAuthCombined, CodeOAOpSecurity, CodeOAServerVar, CodeOAServerRelative,
	CodeOANoServers, CodeOASchemes,
}

// Entry is one line of the report.
type Entry struct {
	Severity string `json:"severity"`
	Code     string `json:"code"`
	// Path is the item's full path in the Postman file ("Shop API / Orders /
	// Create order"); "" for collection-wide lines (e.g. description counts).
	Path    string `json:"path"`
	Message string `json:"message"`          // what happened, in plain words
	Action  string `json:"action,omitempty"` // what to do about it, when applicable
	// Detail is text the user must not lose (a script's full source, a list of
	// variables); shown collapsed in the dialog, always in the copied report.
	Detail      string `json:"detail,omitempty"`
	DetailLabel string `json:"detail_label,omitempty"`
	// Kind + Location: created items only ("request", "P1 / Shop API (2) / Orders").
	Kind     string `json:"kind,omitempty"`
	Location string `json:"location,omitempty"`
}

// Summary counts what was created.
type Summary struct {
	Folders      int `json:"folders"`
	Requests     int `json:"requests"`
	Environments int `json:"environments"`
	Variables    int `json:"variables"`
}

// Report is the complete accounting of one import (also the bound method's result).
type Report struct {
	Kind   string `json:"kind"`   // KindCollection | KindEnvironment
	Source string `json:"source"` // file name
	Format string `json:"format"` // "Collection v2.1", ...
	Name   string `json:"name"`   // the name in the file
	// Target is what was created to hold everything ("P1 / Shop API (2)"), "" if nothing.
	Target  string  `json:"target"`
	Summary Summary `json:"summary"`

	// Notes are info lines shown once at the top of the Imported section ("Converted
	// from Swagger 2.0 before import.", the optional-parameters rule, created envs).
	Notes    []string `json:"notes"`
	Imported []Entry  `json:"imported"`
	Changed  []Entry  `json:"changed"`
	Dropped  []Entry  `json:"dropped"`
	Failed   []Entry  `json:"failed"`
	// Stopped is the banner when execution stopped early ("" = it ran to the end).
	Stopped string `json:"stopped"`
	// Text is the whole report as plain text, collapsed details included ("Copy full report").
	Text string `json:"text"`
}

func newReport(kind, source, format, name string) *Report {
	return &Report{Kind: kind, Source: source, Format: format, Name: name, Notes: []string{},
		Imported: []Entry{}, Changed: []Entry{}, Dropped: []Entry{}, Failed: []Entry{}}
}

// add files entries into their sections.
func (r *Report) add(entries ...Entry) {
	for _, e := range entries {
		switch e.Severity {
		case Imported:
			r.Imported = append(r.Imported, e)
		case Warning:
			r.Changed = append(r.Changed, e)
		case Dropped:
			r.Dropped = append(r.Dropped, e)
		default:
			r.Failed = append(r.Failed, e)
		}
	}
}

func warn(code, path, msg, action string) Entry {
	return Entry{Severity: Warning, Code: code, Path: path, Message: msg, Action: action}
}

func drop(code, path, msg, action string) Entry {
	return Entry{Severity: Dropped, Code: code, Path: path, Message: msg, Action: action}
}

// word is one or many by n, without the number.
func word(n int, one, many string) string {
	if n == 1 {
		return one
	}
	return many
}

func plural(n int, one, many string) string {
	if n == 1 {
		return "1 " + one
	}
	return fmt.Sprintf("%d %s", n, many)
}

// render fills r.Text: every section, every entry, every detail.
func (r *Report) render() {
	var b strings.Builder
	what := "Postman collection"
	switch r.Kind {
	case KindEnvironment:
		what = "Postman environment"
	case KindOpenAPI:
		what = "API spec"
	}
	fmt.Fprintf(&b, "Ghostman import report — %s %q (%s, file %s)\n", what, r.Name, r.Format, r.Source)
	if r.Target != "" {
		fmt.Fprintf(&b, "Imported into: %s\n", r.Target)
	}
	s := r.Summary
	fmt.Fprintf(&b, "Created: %s, %s, %s, %s\n",
		plural(s.Folders, "folder", "folders"), plural(s.Requests, "request", "requests"),
		plural(s.Environments, "environment", "environments"), plural(s.Variables, "variable", "variables"))
	for _, n := range r.Notes {
		fmt.Fprintf(&b, "Note: %s\n", n)
	}
	if r.Stopped != "" {
		fmt.Fprintf(&b, "\n!! %s\n", r.Stopped)
	}
	section := func(title string, entries []Entry) {
		if len(entries) == 0 {
			return
		}
		fmt.Fprintf(&b, "\n%s (%d)\n", title, len(entries))
		for _, e := range entries {
			b.WriteString("  - ")
			if e.Kind != "" {
				b.WriteString(e.Kind + ": ")
			}
			if e.Path != "" {
				b.WriteString(e.Path + " — ")
			}
			b.WriteString(e.Message)
			if e.Location != "" {
				b.WriteString(" → " + e.Location)
			}
			if e.Action != "" {
				b.WriteString(" " + e.Action)
			}
			b.WriteString("\n")
			if e.Detail != "" {
				label := e.DetailLabel
				if label == "" {
					label = "Details"
				}
				fmt.Fprintf(&b, "    %s:\n", label)
				for _, line := range strings.Split(e.Detail, "\n") {
					b.WriteString("    | " + line + "\n")
				}
			}
		}
	}
	section("FAILED", r.Failed)
	section("IMPORTED WITH CHANGES", r.Changed)
	section("DROPPED", r.Dropped)
	section("IMPORTED", r.Imported)
	r.Text = b.String()
}
