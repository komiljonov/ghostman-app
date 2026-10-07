package api

import (
	"encoding/json"
	"slices"
	"strings"
)

// Request body types (the server's tagged union on "type").
const (
	BodyNone = "none"
	BodyRaw  = "raw"
	BodyForm = "form"
)

// DefaultRawContentType is used when a raw body has no content type: the server
// requires one, and the editor may briefly hold an empty custom value.
const DefaultRawContentType = "text/plain"

// KeyValue is one header, query parameter or form field row. Order and
// duplicates are meaningful.
type KeyValue struct {
	Key     string `json:"key"`
	Value   string `json:"value"`
	Enabled bool   `json:"enabled"`
}

// RequestBody holds a request body. The editor keeps every variant's fields at
// once (so switching type does not lose typing), but it is always encoded as
// exactly one variant with only that variant's fields, as the server requires.
type RequestBody struct {
	Type        string     `json:"type"`
	ContentType string     `json:"content_type"`
	Content     string     `json:"content"`
	Fields      []KeyValue `json:"fields"`
}

// MarshalJSON encodes the variant selected by Type and nothing else.
func (b RequestBody) MarshalJSON() ([]byte, error) {
	switch b.Type {
	case BodyRaw:
		return json.Marshal(struct {
			Type        string `json:"type"`
			ContentType string `json:"content_type"`
			Content     string `json:"content"`
		}{BodyRaw, b.ContentType, b.Content})
	case BodyForm:
		return json.Marshal(struct {
			Type   string     `json:"type"`
			Fields []KeyValue `json:"fields"`
		}{BodyForm, nonNilRows(b.Fields)})
	default:
		return json.Marshal(struct {
			Type string `json:"type"`
		}{BodyNone})
	}
}

// RequestDraft is the editable part of a request as the editor holds it.
type RequestDraft struct {
	Method      string      `json:"method"`
	URL         string      `json:"url"`
	Headers     []KeyValue  `json:"headers"`
	QueryParams []KeyValue  `json:"query_params"`
	Body        RequestBody `json:"body"`
	Auth        Auth        `json:"auth"`
}

// NormalizeRows drops rows without a key (the editor's trailing empty row, or a
// row still being typed): the server requires a key. Order and duplicates stay.
func NormalizeRows(rows []KeyValue) []KeyValue {
	out := []KeyValue{}
	for _, r := range rows {
		if strings.TrimSpace(r.Key) != "" {
			out = append(out, r)
		}
	}
	return out
}

// NormalizeBody returns the body exactly as it will be stored.
func NormalizeBody(b RequestBody) RequestBody {
	switch b.Type {
	case BodyRaw:
		ct := b.ContentType
		if strings.TrimSpace(ct) == "" {
			ct = DefaultRawContentType
		}
		return RequestBody{Type: BodyRaw, ContentType: ct, Content: b.Content}
	case BodyForm:
		return RequestBody{Type: BodyForm, Fields: NormalizeRows(b.Fields)}
	default:
		return RequestBody{Type: BodyNone}
	}
}

// BuildRequestPatch compares the last saved draft with the current one and
// returns a patch holding only the fields that changed (after normalization),
// and whether anything changed at all.
func BuildRequestPatch(base, draft RequestDraft) (RequestPatch, bool) {
	var p RequestPatch
	changed := false
	if draft.Method != base.Method {
		m := draft.Method
		p.Method, changed = &m, true
	}
	if draft.URL != base.URL {
		u := draft.URL
		p.URL, changed = &u, true
	}
	if h := NormalizeRows(draft.Headers); !slices.Equal(h, NormalizeRows(base.Headers)) {
		p.Headers, changed = &h, true
	}
	if q := NormalizeRows(draft.QueryParams); !slices.Equal(q, NormalizeRows(base.QueryParams)) {
		p.QueryParams, changed = &q, true
	}
	if b := NormalizeBody(draft.Body); !bodiesEqual(b, NormalizeBody(base.Body)) {
		p.Body, changed = &b, true
	}
	if a, ok := BuildAuthPatch(base.Auth, draft.Auth); ok {
		p.Auth, changed = a, true
	}
	return p, changed
}

func bodiesEqual(a, b RequestBody) bool {
	return a.Type == b.Type && a.ContentType == b.ContentType && a.Content == b.Content && slices.Equal(a.Fields, b.Fields)
}

func nonNilRows(rows []KeyValue) []KeyValue {
	if rows == nil {
		return []KeyValue{}
	}
	return rows
}
