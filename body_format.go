package main

import (
	"errors"

	"ghostman/internal/jsonfmt"
	"ghostman/internal/session"
)

// FormattedBody is the raw body after Format (rules: internal/jsonfmt).
type FormattedBody struct {
	Formatted string `json:"formatted"`
}

type FormattedBodyResult struct {
	Data  *FormattedBody   `json:"data,omitempty"`
	Error *session.Problem `json:"error,omitempty"`
}

// FormatJSONBody pretty-prints a raw JSON body (2-space indent), keeping {{vars}}
// verbatim. A body that does not parse comes back as an invalid Problem whose
// message names the position ("can't format: line L, col C: …"); the editor
// then changes nothing. Pure text in, text out: nothing is stored or logged.
func (a *App) FormatJSONBody(text string) FormattedBodyResult {
	out, err := jsonfmt.Format(text)
	if err != nil {
		var se *jsonfmt.SyntaxError
		if errors.As(err, &se) {
			return FormattedBodyResult{Error: &session.Problem{Kind: session.KindInvalid, Message: "can't format: " + se.Error()}}
		}
		return FormattedBodyResult{Error: &session.Problem{Kind: session.KindInvalid, Message: "can't format: " + err.Error()}}
	}
	return FormattedBodyResult{Data: &FormattedBody{Formatted: out}}
}
