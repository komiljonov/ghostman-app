package engine

import (
	"context"
	"net/http"
	"net/http/httptest"
	"reflect"
	"testing"
	"time"
)

// The derivation table — frontend/src/pathVars.test.ts has the same cases.
func TestPathVarKeys(t *testing.T) {
	cases := []struct {
		url  string
		want []string
	}{
		{"https://api.test/users/:id", []string{"id"}},
		{"https://api.test/users/:id/posts/:post_id", []string{"id", "post_id"}},
		{"{{BASE_URL}}/users/:id?x=:q", []string{"id"}}, // the query is not the path
		{"https://api.test:8080/:_a1", []string{"_a1"}}, // a port is not a variable
		{"https://api.test/:id/:id", []string{"id"}},    // once
		{"https://api.test/:", nil},
		{"https://api.test/:1d", nil},
		{"https://api.test/:id.json", nil},
		{"https://api.test/x:id", nil},
		{"https://api.test/:id-x", nil},
		{"https://api.test/{{:id}}", nil},
		{":id", []string{"id"}},
		{"", nil},
	}
	for _, c := range cases {
		if got := PathVarKeys(c.url); !reflect.DeepEqual(got, c.want) {
			t.Errorf("PathVarKeys(%q) = %v, want %v", c.url, got, c.want)
		}
	}
}

func TestPathVarSubstitution(t *testing.T) {
	spec := RequestSpec{
		URL: "{{BASE}}/users/:id/files/:name?q=:id",
		PathParams: []PathParam{
			{Key: "id", Value: "{{USER}}"},
			{Key: "name", Value: "a/b c?.txt"}, // one segment: "/" becomes %2F
			{Key: "gone", Value: "x"},          // no longer in the URL: ignored
		},
	}
	out, unresolved := ResolveSpec(spec, map[string]string{"BASE": "https://api.test", "USER": "u 1"})
	if want := "https://api.test/users/u%201/files/a%2Fb%20c%3F.txt?q=:id"; out.URL != want {
		t.Fatalf("url = %q, want %q", out.URL, want)
	}
	if len(unresolved) != 0 {
		t.Fatalf("unresolved = %v", unresolved)
	}
	if spec.URL != "{{BASE}}/users/:id/files/:name?q=:id" {
		t.Fatal("the template must not change")
	}
}

// An empty value (or no row) is sent literally and reported as ":key"; an
// unresolved {{var}} inside a value is reported by its key.
func TestPathVarEmptyIsLiteral(t *testing.T) {
	spec := RequestSpec{URL: "https://api.test/:a/:b/:c/:a", PathParams: []PathParam{{Key: "a"}, {Key: "c", Value: "{{nope}}"}}}
	out, unresolved := ResolveSpec(spec, nil)
	if out.URL != "https://api.test/:a/:b/%7B%7Bnope%7D%7D/:a" {
		t.Fatalf("url = %q", out.URL)
	}
	if !reflect.DeepEqual(unresolved, []string{"nope", ":a", ":b"}) {
		t.Fatalf("unresolved = %v", unresolved)
	}
}

// What the server receives: the escaped segment arrives as one segment.
func TestPathVarSend(t *testing.T) {
	var raw, path string
	srv := httptest.NewServer(http.HandlerFunc(func(_ http.ResponseWriter, r *http.Request) {
		raw, path = r.URL.EscapedPath(), r.URL.Path
	}))
	defer srv.Close()
	for _, c := range []struct{ value, raw, path string }{
		{"a/b", "/files/a%2Fb/x", "/files/a/b/x"},
		{"", "/files/:name/x", "/files/:name/x"},
		{"{{$uuid}}", "", ""},
	} {
		spec, _ := ResolveSpec(RequestSpec{Method: "GET", URL: srv.URL + "/files/:name/x", PathParams: []PathParam{{Key: "name", Value: c.value}}}, nil)
		if _, err := New(5*time.Second).Send(context.Background(), spec, SendOptions{FollowRedirects: true}); err != nil {
			t.Fatal(err)
		}
		if c.raw == "" { // generated value: a UUID segment
			if len(path) != len("/files//x")+36 {
				t.Fatalf("path = %q", path)
			}
			continue
		}
		if raw != c.raw || path != c.path {
			t.Fatalf("%q: raw %q path %q, want %q %q", c.value, raw, path, c.raw, c.path)
		}
	}
}
