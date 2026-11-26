package engine

import (
	"errors"
	"fmt"
	"net/url"
	"strings"
)

// Prepared is a request exactly as Send would put it on the wire, short of
// sending: the code generator's input (internal/codegen). It is built with the
// rules buildRequest applies — auth turned into its derived row (user-written
// rows win), enabled keyed rows only, the query params appended to the URL's own
// query, the body's implied Content-Type unless a header sets one — so a snippet
// represents what Send does, never a re-serialization of the raw fields.
type Prepared struct {
	Method  string
	URL     string   // the full URL, query included
	Headers []Header // enabled, in order; auth-derived and the body's implied Content-Type included
	Body    PreparedBody
}

// PreparedBody is the body by kind. Multipart is NOT flattened to bytes (each
// language frames it itself, with its own boundary): its implied Content-Type is
// therefore not in Headers either (a user-set one is, as Send would send it).
type PreparedBody struct {
	Kind  string   // BodyNone | BodyRaw | BodyForm | BodyMultipart
	Raw   string   // raw: the content as typed; form: the urlencoded string Send sends
	Form  []Header // form: the enabled fields (keys trimmed), in order
	Parts []Part   // multipart: the enabled keyed parts, file parts with their local Path
}

// JWTPlaceholder stands in for a JWT that is signed at send time (template snippets).
const JWTPlaceholder = "<signed at send time>"

// WithJWTPlaceholder makes a JWT auth produce its row with a placeholder token
// instead of a signed one (template snippets: nothing is signed). Other auth
// types are returned as they are.
func WithJWTPlaceholder(spec RequestSpec) RequestSpec {
	if spec.Auth == nil || spec.Auth.Type != AuthJWT {
		return spec
	}
	a := *spec.Auth
	a.jwtToken = JWTPlaceholder
	spec.Auth = &a
	return spec
}

// parseSendURL validates a request URL as Send does.
func parseSendURL(raw string) (*url.URL, error) {
	raw = strings.TrimSpace(raw)
	if raw == "" {
		return nil, errors.New("enter a URL")
	}
	u, err := url.Parse(raw)
	if err != nil {
		return nil, fmt.Errorf("invalid URL: %w", unwrapURLError(err))
	}
	if u.Scheme != "http" && u.Scheme != "https" {
		return nil, fmt.Errorf("invalid URL %q: must start with http:// or https://", raw)
	}
	if u.Host == "" {
		return nil, fmt.Errorf("invalid URL %q: missing host", raw)
	}
	return u, nil
}

// Prepare builds the wire form of spec (auth values already resolved, a JWT
// already signed — or given a placeholder). Invalid URLs fail as Send would.
// File parts are NOT read or checked: a snippet names the path, the file is the
// reader's business.
func Prepare(spec RequestSpec) (Prepared, error) {
	u, err := parseSendURL(spec.URL)
	if err != nil {
		return Prepared{}, err
	}
	spec = ApplyAuth(spec) // an API key in the query lands in QueryParams
	appendQuery(u, spec.QueryParams)
	return prepare(spec, u.String()), nil
}

// PrepareTemplate is Prepare for a spec whose {{vars}} are NOT resolved (template
// snippets): its URL may not parse yet ({{BASE_URL}}/items), so it is kept as
// typed and the enabled params are appended textually by appendQuery's rule ("?"
// or "&", the same encoding). The rest is Prepare's.
func PrepareTemplate(spec RequestSpec) Prepared {
	spec = ApplyAuth(spec)
	raw := strings.TrimSpace(spec.URL)
	if extra := encodePairs(enabled(spec.QueryParams)); extra != "" {
		sep := "?"
		if strings.Contains(raw, "?") {
			sep = "&"
		}
		raw += sep + extra
	}
	return prepare(spec, raw)
}

// prepare is the shared part: method, headers, body (auth already applied).
func prepare(spec RequestSpec, fullURL string) Prepared {
	method := strings.ToUpper(strings.TrimSpace(spec.Method))
	if method == "" {
		method = "GET"
	}
	out := Prepared{Method: method, URL: fullURL, Body: PreparedBody{Kind: BodyNone}}
	headers := enabled(spec.Headers)
	impliedType := ""
	switch spec.Body.Type {
	case BodyRaw:
		out.Body = PreparedBody{Kind: BodyRaw, Raw: spec.Body.Content}
		_, impliedType = encodeBody(spec.Body)
	case BodyForm:
		fields := enabled(spec.Body.Fields)
		for i := range fields {
			fields[i].Key = strings.TrimSpace(fields[i].Key)
		}
		out.Body = PreparedBody{Kind: BodyForm, Raw: encodePairs(fields), Form: fields}
		_, impliedType = encodeBody(spec.Body)
	case BodyMultipart:
		var parts []Part
		for _, p := range spec.Body.Parts {
			if p.Enabled && strings.TrimSpace(p.Key) != "" {
				p.Key = strings.TrimSpace(p.Key)
				parts = append(parts, p)
			}
		}
		out.Body = PreparedBody{Kind: BodyMultipart, Parts: parts}
	}
	out.Headers = make([]Header, 0, len(headers)+1)
	hasType := false
	for _, h := range headers {
		h.Key = strings.TrimSpace(h.Key)
		if strings.EqualFold(h.Key, "Content-Type") {
			hasType = true
		}
		out.Headers = append(out.Headers, h)
	}
	if impliedType != "" && !hasType {
		out.Headers = append(out.Headers, Header{Key: "Content-Type", Value: impliedType, Enabled: true})
	}
	return out
}
