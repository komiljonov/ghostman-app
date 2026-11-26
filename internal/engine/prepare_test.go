package engine

import (
	"context"
	"io"
	"net/textproto"
	"strings"
	"testing"
)

// Prepare (code snippets) and buildRequest (Send) agree on what goes on the wire:
// method, URL, every header (auth-derived, user-wins, implied Content-Type) and
// the body bytes of raw / form bodies.
func TestPrepareMatchesSend(t *testing.T) {
	h := func(k, v string) Header { return Header{Key: k, Value: v, Enabled: true} }
	specs := []RequestSpec{
		{Method: "get", URL: " https://x.test/a?b=1 ", QueryParams: []Header{h("q", "a b"), h("q", "ü&"), {Key: "off", Value: "x"}}},
		{Method: "POST", URL: "https://x.test/p", Headers: []Header{h(" X-A ", "1"), h("x-a", "2")},
			Body: Body{Type: BodyRaw, ContentType: "application/json", Content: "{\"a\": \"it's\"}\n"},
			Auth: &Auth{Type: AuthBearer, BearerToken: "t"}},
		{Method: "PUT", URL: "https://x.test/p", Headers: []Header{h("Content-Type", "text/csv"), h("Authorization", "mine")},
			Body: Body{Type: BodyRaw, Content: "a,b"}, Auth: &Auth{Type: AuthBearer, BearerToken: "ignored"}},
		{Method: "POST", URL: "https://x.test/f", Body: Body{Type: BodyForm, Fields: []Header{h(" k ", "v w"), h("k", "&=")}},
			Auth: &Auth{Type: AuthAPIKey, APIKeyName: "key", APIKeyValue: "s", APIKeyIn: "query"}},
		{Method: "DELETE", URL: "https://x.test/d", Body: Body{Type: BodyRaw}},
	}
	for i, spec := range specs {
		p, err := Prepare(spec)
		if err != nil {
			t.Fatal(err)
		}
		req, err := buildRequest(context.Background(), ApplyAuth(spec))
		if err != nil {
			t.Fatal(err)
		}
		if p.Method != req.Method || p.URL != req.URL.String() {
			t.Errorf("%d: %s %s vs %s %s", i, p.Method, p.URL, req.Method, req.URL)
		}
		got := map[string][]string{}
		for _, x := range p.Headers {
			got[canonical(x.Key)] = append(got[canonical(x.Key)], x.Value)
		}
		for k, v := range req.Header {
			if strings.Join(got[k], "|") != strings.Join(v, "|") {
				t.Errorf("%d: header %s = %v, Send sends %v", i, k, got[k], v)
			}
			delete(got, k)
		}
		if len(got) != 0 {
			t.Errorf("%d: extra headers %v", i, got)
		}
		var sent string
		if req.Body != nil {
			b, _ := io.ReadAll(req.Body)
			sent = string(b)
		}
		if p.Body.Raw != sent {
			t.Errorf("%d: body %q, Send sends %q", i, p.Body.Raw, sent)
		}
	}
}

func canonical(k string) string { return textproto.CanonicalMIMEHeaderKey(strings.TrimSpace(k)) }
