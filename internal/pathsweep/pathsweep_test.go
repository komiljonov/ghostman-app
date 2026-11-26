package pathsweep

import "testing"

func TestRewrite(t *testing.T) {
	cases := []struct {
		url    string
		values map[string]string
		want   string
		change bool
	}{
		// the value is a {{var}} reference (the common case: Postman imports)
		{"{{base_url}}/api/v1/products/:product_id/prices", map[string]string{"product_id": "{{product_id}}"}, "{{base_url}}/api/v1/products/{{product_id}}/prices", true},
		// a literal value is kept as the segment
		{"https://api.test/users/:id", map[string]string{"id": "123"}, "https://api.test/users/123", true},
		// empty value / no row → {{key}}
		{"https://api.test/users/:id/posts/:post_id", map[string]string{"id": ""}, "https://api.test/users/{{id}}/posts/{{post_id}}", true},
		{"https://api.test/:id?x=:q", nil, "https://api.test/{{id}}?x=:q", true}, // the query is not the path
		// not path variables: nothing to do
		{"https://api.test:8080/a:b/:1d/:id.json/:", nil, "https://api.test:8080/a:b/:1d/:id.json/:", false},
		{"", nil, "", false},
	}
	for _, c := range cases {
		got, changed := Rewrite(c.url, c.values)
		if got != c.want || changed != c.change {
			t.Errorf("Rewrite(%q) = %q, %v; want %q, %v", c.url, got, changed, c.want, c.change)
		}
		// idempotent: a rewritten URL is left alone
		if again, ch := Rewrite(got, c.values); again != got || ch {
			t.Errorf("second Rewrite(%q) = %q, %v", got, again, ch)
		}
	}
}
