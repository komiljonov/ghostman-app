package api

import (
	"encoding/json"
	"slices"
	"strings"
)

// Request body types (the server's tagged union on "type").
const (
	BodyNone      = "none"
	BodyRaw       = "raw"
	BodyForm      = "form"
	BodyMultipart = "multipart"
)

// Multipart field kinds.
const (
	PartText = "text"
	PartFile = "file"
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

// MultipartField is one row of a multipart body: a text field ({{vars}} allowed
// in its value) or a file. A file row carries its DISPLAY name only — the file's
// path is local to this machine (request_files, request_files.go) and its bytes
// are read from disk at send time; neither ever reaches the server.
type MultipartField struct {
	Key      string `json:"key"`
	Kind     string `json:"kind"` // PartText | PartFile
	Value    string `json:"value"`
	FileName string `json:"file_name"`
	Enabled  bool   `json:"enabled"`
}

// RequestBody holds a request body. The editor keeps every variant's fields at
// once (so switching type does not lose typing): Fields are the urlencoded form's
// rows, Parts the multipart rows. It is always encoded as exactly one variant with
// only that variant's fields, as the server requires — the server calls both
// row lists "fields".
type RequestBody struct {
	Type        string           `json:"type"`
	ContentType string           `json:"content_type"`
	Content     string           `json:"content"`
	Fields      []KeyValue       `json:"fields"`
	Parts       []MultipartField `json:"parts"`
}

// UnmarshalJSON reads both shapes: the editor's (fields and parts side by side)
// and the server's, where a multipart body's rows arrive as "fields".
func (b *RequestBody) UnmarshalJSON(data []byte) error {
	var raw struct {
		Type        string           `json:"type"`
		ContentType string           `json:"content_type"`
		Content     string           `json:"content"`
		Fields      json.RawMessage  `json:"fields"`
		Parts       []MultipartField `json:"parts"`
	}
	if err := json.Unmarshal(data, &raw); err != nil {
		return err
	}
	*b = RequestBody{Type: raw.Type, ContentType: raw.ContentType, Content: raw.Content, Parts: raw.Parts}
	if len(raw.Fields) == 0 || string(raw.Fields) == "null" {
		return nil
	}
	if raw.Type == BodyMultipart && raw.Parts == nil {
		return json.Unmarshal(raw.Fields, &b.Parts)
	}
	return json.Unmarshal(raw.Fields, &b.Fields)
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
	case BodyMultipart:
		return json.Marshal(struct {
			Type   string `json:"type"`
			Fields []any  `json:"fields"`
		}{BodyMultipart, wireParts(b.Parts)})
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
	// ResponseFilter is the jq query for the response view ("" = none).
	ResponseFilter string `json:"response_filter"`
	// PreScript / PostScript are the request's own scripts (its folders' scripts
	// run around them, outer first: internal/scripting).
	PreScript  string `json:"pre_script"`
	PostScript string `json:"post_script"`
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
	case BodyMultipart:
		return RequestBody{Type: BodyMultipart, Parts: NormalizeParts(b.Parts)}
	default:
		return RequestBody{Type: BodyNone}
	}
}

// NormalizeParts drops keyless rows (like NormalizeRows) and reduces each row to
// its kind's fields: a text row has no file name, a file row no value. An
// unknown kind is text.
func NormalizeParts(parts []MultipartField) []MultipartField {
	out := []MultipartField{}
	for _, p := range parts {
		if strings.TrimSpace(p.Key) == "" {
			continue
		}
		if p.Kind == PartFile {
			out = append(out, MultipartField{Key: p.Key, Kind: PartFile, FileName: p.FileName, Enabled: p.Enabled})
		} else {
			out = append(out, MultipartField{Key: p.Key, Kind: PartText, Value: p.Value, Enabled: p.Enabled})
		}
	}
	return out
}

// wireParts is the server's exact row shape per kind: text {key, kind, value,
// enabled}, file {key, kind, file_name, enabled}.
func wireParts(parts []MultipartField) []any {
	type textRow struct {
		Key     string `json:"key"`
		Kind    string `json:"kind"`
		Value   string `json:"value"`
		Enabled bool   `json:"enabled"`
	}
	type fileRow struct {
		Key      string `json:"key"`
		Kind     string `json:"kind"`
		FileName string `json:"file_name"`
		Enabled  bool   `json:"enabled"`
	}
	out := make([]any, 0, len(parts))
	for _, p := range parts {
		if p.Kind == PartFile {
			out = append(out, fileRow{p.Key, PartFile, p.FileName, p.Enabled})
		} else {
			out = append(out, textRow{p.Key, PartText, p.Value, p.Enabled})
		}
	}
	return out
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
	if draft.ResponseFilter != base.ResponseFilter {
		f := draft.ResponseFilter
		p.ResponseFilter, changed = &f, true
	}
	if draft.PreScript != base.PreScript {
		s := draft.PreScript
		p.PreScript, changed = &s, true
	}
	if draft.PostScript != base.PostScript {
		s := draft.PostScript
		p.PostScript, changed = &s, true
	}
	return p, changed
}

func bodiesEqual(a, b RequestBody) bool {
	return a.Type == b.Type && a.ContentType == b.ContentType && a.Content == b.Content &&
		slices.Equal(a.Fields, b.Fields) && slices.Equal(a.Parts, b.Parts)
}

func nonNilRows(rows []KeyValue) []KeyValue {
	if rows == nil {
		return []KeyValue{}
	}
	return rows
}
