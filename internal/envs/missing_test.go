package envs

import (
	"reflect"
	"testing"

	"ghostman/internal/api"
)

func TestMissingKeys(t *testing.T) {
	have := []api.Variable{
		{Key: "base_url", Type: api.VarRegular},
		{Key: "password", Type: api.VarSecret}, // a secret counts as present
		{Key: "Token", Type: api.VarRegular},
	}
	used := []string{"access_token", "base_url", "password", "product_id", "token", "$uuid", "product_id", "PRODUCT_ID", " "}
	got := MissingKeys(used, have)
	if want := []string{"access_token", "product_id"}; !reflect.DeepEqual(got, want) {
		t.Fatalf("missing = %v, want %v", got, want)
	}
	if got := MissingKeys(nil, have); got == nil || len(got) != 0 {
		t.Fatalf("none missing must be an empty list, got %#v", got)
	}
}
