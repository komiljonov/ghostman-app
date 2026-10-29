package api

import (
	"bytes"
	"context"
	"encoding/base64"
	"encoding/json"
	"errors"
	"io"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
)

// exampleServer records each call and answers like the server (body as base64).
type exampleServer struct {
	calls  []string          // "METHOD path"
	bodies []json.RawMessage // request bodies, in order
	stored []byte            // the last body written
}

func (s *exampleServer) start(t *testing.T) *APIClient {
	t.Helper()
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		b, _ := io.ReadAll(r.Body)
		s.calls = append(s.calls, r.Method+" "+r.URL.Path)
		s.bodies = append(s.bodies, b)
		var in struct {
			Body *string `json:"body"`
		}
		_ = json.Unmarshal(b, &in)
		if in.Body != nil {
			raw, err := base64.StdEncoding.DecodeString(*in.Body)
			if err != nil {
				w.WriteHeader(http.StatusBadRequest)
				_, _ = io.WriteString(w, `{"error":{"code":"bad_request","message":"body must be base64 (standard alphabet, padded)"}}`)
				return
			}
			s.stored = raw
		}
		switch {
		case r.Method == http.MethodGet && strings.HasSuffix(r.URL.Path, "/examples"):
			_, _ = io.WriteString(w, `[{"id":"e1","name":"200 response","status":200,"content_type":"application/json","body_size":2,"sort_order":0,"updated_at":"t"}]`)
		case r.Method == http.MethodDelete || r.Method == http.MethodPut:
			w.WriteHeader(http.StatusNoContent)
		default:
			body, _ := json.Marshal(s.stored) // []byte → base64, nil → null
			_, _ = io.WriteString(w, `{"id":"e1","request_id":"r1","name":"n","status":201,"headers":null,"content_type":"image/png","body":`+
				string(body)+`,"body_size":`+itoa(len(s.stored))+`,"sort_order":0,"created_at":"t","updated_at":"t2"}`)
		}
	}))
	t.Cleanup(srv.Close)
	return New(srv.URL)
}

func itoa(n int) string { b, _ := json.Marshal(n); return string(b) }

func TestExampleEndpointsAndBase64RoundTrip(t *testing.T) {
	s := &exampleServer{}
	c := s.start(t)
	ctx := context.Background()
	png := []byte{0x89, 'P', 'N', 'G', 0, 0xff, 0xfe, '\n', 0}

	created, err := c.CreateExample(ctx, "r1", NewExample{Name: "n", Status: 201, ContentType: "image/png", Body: png})
	if err != nil {
		t.Fatal(err)
	}
	if !bytes.Equal(s.stored, png) || !bytes.Equal(created.Body, png) {
		t.Fatalf("binary body did not round-trip: stored %v, got %v", s.stored, created.Body)
	}
	if created.Headers == nil {
		t.Error("null headers must come back as an empty list")
	}
	// The wire form is standard padded base64, and headers are always a list.
	if !strings.Contains(string(s.bodies[0]), `"body":"`+base64.StdEncoding.EncodeToString(png)+`"`) ||
		!strings.Contains(string(s.bodies[0]), `"headers":[]`) {
		t.Errorf("create body = %s", s.bodies[0])
	}

	got, err := c.GetExample(ctx, "e1")
	if err != nil || !bytes.Equal(got.Body, png) {
		t.Fatalf("get = %v %v", got.Body, err)
	}
	list, err := c.ListExamples(ctx, "r1")
	if err != nil || len(list) != 1 || list[0].BodySize != 2 || list[0].Status != 200 {
		t.Fatalf("list = %+v %v", list, err)
	}

	// A patch sends only what is set; an emptied body is "" (clears), not null.
	name := "renamed"
	if _, err := c.UpdateExample(ctx, "e1", ExamplePatch{Name: &name}); err != nil {
		t.Fatal(err)
	}
	if string(s.bodies[len(s.bodies)-1]) != `{"name":"renamed"}` {
		t.Errorf("name patch = %s", s.bodies[len(s.bodies)-1])
	}
	var none []byte
	if _, err := c.UpdateExample(ctx, "e1", ExamplePatch{Body: &none}); err != nil {
		t.Fatal(err)
	}
	if string(s.bodies[len(s.bodies)-1]) != `{"body":""}` {
		t.Errorf("clear patch = %s", s.bodies[len(s.bodies)-1])
	}

	if err := c.ReorderExamples(ctx, "r1", []string{"e2", "e1"}); err != nil {
		t.Fatal(err)
	}
	if string(s.bodies[len(s.bodies)-1]) != `{"request_id":"r1","example_ids":["e2","e1"]}` {
		t.Errorf("reorder = %s", s.bodies[len(s.bodies)-1])
	}
	if err := c.DeleteExample(ctx, "e1"); err != nil {
		t.Fatal(err)
	}
	want := []string{"POST /api/v1/requests/r1/examples", "GET /api/v1/examples/e1", "GET /api/v1/requests/r1/examples",
		"PATCH /api/v1/examples/e1", "PATCH /api/v1/examples/e1", "PUT /api/v1/examples/order", "DELETE /api/v1/examples/e1"}
	if strings.Join(s.calls, "|") != strings.Join(want, "|") {
		t.Errorf("calls = %v", s.calls)
	}
}

func TestExampleCapIsRefusedBeforeSending(t *testing.T) {
	s := &exampleServer{}
	c := s.start(t)
	big := bytes.Repeat([]byte("x"), MaxExampleBody+1)
	if _, err := c.CreateExample(context.Background(), "r1", NewExample{Name: "n", Body: big}); !errors.Is(err, ErrExampleTooLarge) {
		t.Fatalf("create err = %v", err)
	}
	if _, err := c.UpdateExample(context.Background(), "e1", ExamplePatch{Body: &big}); !errors.Is(err, ErrExampleTooLarge) {
		t.Fatalf("update err = %v", err)
	}
	if len(s.calls) != 0 {
		t.Fatalf("an over-cap body reached the server: %v", s.calls)
	}
	// Exactly the cap is fine, and a full-size body reads back (over the default read cap).
	exact := bytes.Repeat([]byte("y"), MaxExampleBody)
	got, err := c.CreateExample(context.Background(), "r1", NewExample{Name: "n", Body: exact})
	if err != nil || len(got.Body) != MaxExampleBody {
		t.Fatalf("1 MB body: %d %v", len(got.Body), err)
	}
}

func TestExampleServerErrorSurfaces(t *testing.T) {
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, _ *http.Request) {
		w.WriteHeader(http.StatusBadRequest)
		_, _ = io.WriteString(w, `{"error":{"code":"bad_request","message":"example body must be at most 1MB"}}`)
	}))
	t.Cleanup(srv.Close)
	_, err := New(srv.URL).CreateExample(context.Background(), "r1", NewExample{Name: "n", Body: []byte("x")})
	var apiErr *APIError
	if !errors.As(err, &apiErr) || apiErr.Message != "example body must be at most 1MB" {
		t.Fatalf("err = %v", err)
	}
}

// The project request list carries each request's example count (the sidebar tree
// shows a chevron for > 0); GET keeps it through the embedded summary.
func TestRequestListAndGetCarryExampleCount(t *testing.T) {
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.URL.Path == "/api/v1/projects/p1/requests" {
			_, _ = io.WriteString(w, `[{"id":"r1","name":"a","example_count":2},{"id":"r2","name":"b","example_count":0}]`)
			return
		}
		_, _ = io.WriteString(w, `{"id":"r1","name":"a","example_count":3}`)
	}))
	t.Cleanup(srv.Close)
	c := New(srv.URL)
	list, err := c.ListRequests(context.Background(), "p1")
	if err != nil || len(list) != 2 || list[0].ExampleCount != 2 || list[1].ExampleCount != 0 {
		t.Fatalf("list = %+v, err %v", list, err)
	}
	req, err := c.GetRequest(context.Background(), "r1")
	if err != nil || req.ExampleCount != 3 {
		t.Fatalf("get = %+v, err %v", req, err)
	}
}
