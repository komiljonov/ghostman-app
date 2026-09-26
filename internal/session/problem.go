package session

import (
	"errors"
	"log/slog"

	"ghostman/internal/api"
)

// Problem kinds.
const (
	// KindServer: the server answered with an error (bad credentials, email taken, ...).
	KindServer = "server"
	// KindUnreachable: no usable answer from the server.
	KindUnreachable = "unreachable"
	// KindInvalid: input rejected locally before contacting the server.
	KindInvalid = "invalid"
	// KindInternal: a local bug or storage failure; details are only logged.
	KindInternal = "internal"
)

// Problem is an error in a form the UI can show directly: Message is always a
// human sentence, never raw JSON or a Go error dump.
type Problem struct {
	Kind    string `json:"kind"`
	Status  int    `json:"status,omitempty"`
	Code    string `json:"code,omitempty"`
	Message string `json:"message"`
}

// ProblemFrom classifies err. Unknown errors are logged and replaced by a generic message.
func ProblemFrom(err error) *Problem {
	var apiErr *api.APIError
	var unreachable *api.ServerUnreachableError
	switch {
	case errors.As(err, &apiErr):
		return &Problem{Kind: KindServer, Status: apiErr.Status, Code: apiErr.Code, Message: apiErr.Message}
	case errors.As(err, &unreachable):
		return &Problem{Kind: KindUnreachable, Message: unreachable.Error()}
	default:
		slog.Error("unexpected error", "err", err)
		return internalProblem()
	}
}

func internalProblem() *Problem {
	return &Problem{Kind: KindInternal, Message: "something went wrong inside Ghostman; see the log for details"}
}
