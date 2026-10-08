package main

import "testing"

func TestFormatJSONBody(t *testing.T) {
	a := &App{}
	res := a.FormatJSONBody(`{"a":{{n}},"b":"{{tok}}"}`)
	if res.Error != nil || res.Data.Formatted != "{\n  \"a\": {{n}},\n  \"b\": \"{{tok}}\"\n}" {
		t.Fatalf("got %+v", res)
	}
	res = a.FormatJSONBody(`{"a":`)
	if res.Data != nil || res.Error == nil || res.Error.Kind != "invalid" ||
		res.Error.Message != "can't format: line 1, col 6: unexpected end of JSON input" {
		t.Fatalf("got %+v", res.Error)
	}
	if res = a.FormatJSONBody("  "); res.Error == nil || res.Error.Message != "can't format: the body is empty" {
		t.Fatalf("empty: %+v", res.Error)
	}
}
