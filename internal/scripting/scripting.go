// Package scripting runs pre-request and post-response scripts in a sandboxed
// JavaScript VM (goja). Scripts are teammate code synced from the server, so they
// are UNTRUSTED input:
//
//   - every script runs in a FRESH VM: nothing leaks between scripts or sends;
//   - the VM starts with ECMAScript built-ins only plus the gm API (api.go) — no
//     require, fetch, XMLHttpRequest, process, filesystem or network;
//   - a watchdog interrupts it after Budget (2 s: "script timed out after 2s"),
//     when the Go heap grows by more than MemoryBudget while it runs (a
//     string-doubling loop exhausts RAM long before 2 s, and running out of
//     memory is fatal in Go, not recoverable), or when the send is cancelled;
//   - the call stack is bounded (deep recursion becomes a RangeError);
//   - empty scripts are skipped without creating a VM.
//
// Order and meaning (the caller, the app's send path, runs them):
//
//	folder pre-scripts, OUTERMOST first → request pre-script → {{var}} resolution →
//	send → folder post-scripts, outermost first → request post-script
//
// Pre-scripts run BEFORE {{var}} resolution on purpose: gm.environment.set in a
// pre-script changes THIS send's resolution (the token / signature use case), and
// gm.request mutations (template form) apply to this send only — the saved
// request is never modified. Environment writes are queued in EnvState.Pending
// (the in-VM view updates at once) and applied by the caller AFTER each script, so
// server latency never counts against the script's budget.
package scripting

import (
	"context"
	"errors"
	"fmt"
	"runtime"
	"strings"
	"time"
	"unicode/utf8"

	"github.com/dop251/goja"

	"ghostman/internal/engine"
)

// Phases.
const (
	Pre  = "pre"
	Post = "post"
)

// Limits.
var (
	Budget       = 2 * time.Second
	MemoryBudget = uint64(256 << 20) // heap growth while one script runs
	memoryTick   = 10 * time.Millisecond
)

const (
	maxCallStack   = 1024
	maxEntries     = 500    // console entries per send
	maxEntryLength = 10_000 // characters per console entry
)

// Script is one script to run.
type Script struct {
	Owner  string // "folder 'api v2'", "request 'Login'" — names it in errors and the console
	Phase  string // Pre | Post
	Source string
}

// Entry is one console line of a send.
type Entry struct {
	Owner string `json:"owner"`
	Phase string `json:"phase"`
	Level string `json:"level"` // log | warn | error
	Text  string `json:"text"`
}

// Console collects a send's output (capped: untrusted code may log in a loop).
type Console struct {
	Entries   []Entry `json:"entries"`
	Truncated bool    `json:"truncated"`
}

func (c *Console) add(e Entry) {
	if len(c.Entries) >= maxEntries {
		c.Truncated = true
		return
	}
	if utf8.RuneCountInString(e.Text) > maxEntryLength {
		e.Text = string([]rune(e.Text)[:maxEntryLength]) + "… (cut)"
	}
	c.Entries = append(c.Entries, e)
}

// Error adds a script failure (also for the caller's own errors, e.g. an
// environment write that failed after the script ran).
func (c *Console) Error(owner, phase, text string) {
	c.add(Entry{Owner: owner, Phase: phase, Level: "error", Text: text})
}

// HasErrors reports whether any entry is an error.
func (c *Console) HasErrors() bool {
	for _, e := range c.Entries {
		if e.Level == "error" {
			return true
		}
	}
	return false
}

// EnvState is gm.environment's view: the active environment's resolved values
// (regular values + local secret values) and the writes queued by scripts.
type EnvState struct {
	Name    string // "" = no active environment
	Vars    map[string]string
	Pending []EnvWrite
}

// EnvWrite is one queued environment change.
type EnvWrite struct {
	Key   string
	Value string
	Unset bool // clear the value (the variable itself stays)
}

// Response is what a post-script sees.
type Response struct {
	Status     int
	DurationMs int64
	Headers    []engine.Header
	Body       []byte // the engine's retained body
}

// ScriptError is a script that failed: thrown, timed out, invalid, misused the API.
type ScriptError struct {
	Owner, Phase, Message string
}

func (e *ScriptError) Error() string {
	return fmt.Sprintf("%s-script of %s failed: %s", e.Phase, e.Owner, e.Message)
}

// Run executes one script. req is the send's (template-form) spec: mutable in
// pre-scripts, read-only in post-scripts. resp is nil for pre-scripts.
func Run(ctx context.Context, s Script, req *engine.RequestSpec, resp *Response, env *EnvState, con *Console) error {
	if strings.TrimSpace(s.Source) == "" {
		return nil // zero cost: no VM
	}
	fail := func(msg string) error { return &ScriptError{Owner: s.Owner, Phase: s.Phase, Message: msg} }
	prog, err := goja.Compile(s.Owner, s.Source, false)
	if err != nil {
		return fail(compileMessage(err))
	}
	vm := goja.New()
	vm.SetMaxCallStackSize(maxCallStack)
	if err := install(vm, s, req, resp, env, con); err != nil {
		return fail(err.Error())
	}

	done := make(chan struct{})
	go watchdog(ctx, vm, done)
	_, err = vm.RunProgram(prog)
	close(done)
	if err == nil {
		return nil
	}
	var interrupted *goja.InterruptedError
	if errors.As(err, &interrupted) {
		return fail(fmt.Sprint(interrupted.Value()))
	}
	var overflow *goja.StackOverflowError
	if errors.As(err, &overflow) {
		return fail("RangeError: Maximum call stack size exceeded (too deep recursion)")
	}
	var ex *goja.Exception
	if errors.As(err, &ex) {
		return fail(exceptionMessage(ex, s.Owner))
	}
	return fail(err.Error())
}

// watchdog interrupts the VM on the time budget, on heap growth past
// MemoryBudget, or when the send is cancelled.
func watchdog(ctx context.Context, vm *goja.Runtime, done <-chan struct{}) {
	var ms runtime.MemStats
	runtime.ReadMemStats(&ms)
	base := ms.HeapAlloc
	deadline := time.NewTimer(Budget)
	defer deadline.Stop()
	tick := time.NewTicker(memoryTick)
	defer tick.Stop()
	for {
		select {
		case <-done:
			return
		case <-ctx.Done():
			vm.Interrupt("the send was cancelled")
			return
		case <-deadline.C:
			vm.Interrupt(fmt.Sprintf("script timed out after %s", Budget))
			return
		case <-tick.C:
			runtime.ReadMemStats(&ms)
			if ms.HeapAlloc > base && ms.HeapAlloc-base > MemoryBudget {
				vm.Interrupt(fmt.Sprintf("script used too much memory (over %d MB)", MemoryBudget>>20))
				return
			}
		}
	}
}

func compileMessage(err error) string {
	var se *goja.CompilerSyntaxError
	if errors.As(err, &se) && se.File != nil {
		return fmt.Sprintf("SyntaxError: %s (line %d)", se.Message, se.File.Position(se.Offset).Line)
	}
	return "SyntaxError: " + err.Error()
}

// exceptionMessage is the thrown value plus the line in the owner's script.
func exceptionMessage(ex *goja.Exception, owner string) string {
	msg := ex.Value().String()
	if o, ok := ex.Value().(*goja.Object); ok {
		if m := o.Get("message"); m != nil && !goja.IsUndefined(m) {
			name := "Error"
			if n := o.Get("name"); n != nil && !goja.IsUndefined(n) {
				name = n.String()
			}
			msg = name + ": " + m.String()
		}
	}
	for _, f := range ex.Stack() {
		if f.SrcName() == owner {
			if line := f.Position().Line; line > 0 {
				return fmt.Sprintf("%s (line %d)", msg, line)
			}
		}
	}
	return msg
}
